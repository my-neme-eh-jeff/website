import {
  DESK_REQUEST,
  MAX_ASSISTANT_CHARS,
  MAX_TURNS,
  MAX_USER_CHARS,
  SYSTEM_PROMPT,
} from "../content/chat";
import { callPoe, fromPoe } from "./poe";
import { DESK_STATE_HEADER, deskEvent, relay, untilAnswer } from "./relay";

/**
 * `POST /api/chat`, streamed back as NDJSON events:
 *
 *   {"type":"desk","cold":true}      first, from the desk: must the model load?
 *   {"type":"fallback"}              the desk took it but didn't start; Poe answers
 *   {"type":"token","text":"..."}
 *   {"type":"answered"}              the answer is whole; questions follow
 *   {"type":"next","text":"...?"}    one per question, as its line ends
 *   {"type":"done","model":"...","stats":{...},"next":["...?"]}
 *   {"type":"error","code":"..."}
 *
 * `done.next` repeats every `next` event, in order.
 *
 * Errors before the stream starts are a JSON body with a non-200 status. The
 * visitor controls only message text; path, model, sampling and prompt are
 * fixed here.
 */

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

interface Env {
  /** Workers VPC binding to the desk's log proxy, through a Cloudflare Tunnel. */
  DESK: { fetch(input: Request): Promise<Response> };
  CHAT_LIMIT: RateLimit;
  DESK_MODEL: string;
  /** A secret. Unset, a desk that can't answer is reported as offline. */
  POE_API_KEY?: string;
  POE_LIMIT: RateLimit;
  POE_MODEL: string;
}

type Turn = { role: "user" | "assistant"; content: string };

const MAX_BODY_BYTES = 16_000;

/**
 * For response headers only. The desk's proxy sends them before Ollama loads
 * anything (0.2-0.3s through the tunnel, 2026-10-19), so a desk that hasn't
 * answered by now is down, not cold. The stream itself is not timed out.
 */
const HEADERS_TIMEOUT_MS = 5_000;

/**
 * From the desk's headers to its first answer text. Its log has 22 cold starts
 * at 12.2-23.2s (2026-10-14 to 2026-10-20); one queued behind an eval's
 * answers took 52.9s.
 */
const ANSWER_START_TIMEOUT_MS = 30_000;

/** Poe's first byte came after about 2s (2026-10-19). */
const POE_HEADERS_TIMEOUT_MS = 15_000;

const encoder = new TextEncoder();
const line = (event: object) => encoder.encode(JSON.stringify(event) + "\n");

const stream = (body: ReadableStream<Uint8Array>) =>
  // A fresh Response, so none of the upstream's headers reach the browser.
  new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const json = (body: unknown, status: number, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

function parseTurns(body: unknown): Turn[] | null {
  if (typeof body !== "object" || body === null) return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const turns: Turn[] = [];
  for (const m of messages.slice(-MAX_TURNS)) {
    if (typeof m !== "object" || m === null) return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    const cap = role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    if (content.length > cap) return null;
    turns.push({ role, content });
  }
  if (turns.at(-1)?.role !== "user" || !turns.at(-1)?.content.trim()) {
    return null;
  }
  return turns;
}

/** The only visitor fact the desk's log gets. /privacy/ promises exactly this. */
function visitorHeaders(request: Request): Record<string, string> {
  const country = (request as { cf?: { country?: string } }).cf?.country;
  return country ? { "x-visitor-country": country } : {};
}

function callDesk(
  env: Env,
  turns: Turn[],
  signal: AbortSignal,
  visitor: Record<string, string>,
) {
  return env.DESK.fetch(
    // The VPC service, not this URL, decides where it goes: the desk's log
    // proxy. The host only fills the Host header.
    new Request("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...visitor },
      body: JSON.stringify({
        model: env.DESK_MODEL,
        ...DESK_REQUEST,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
      }),
      signal,
    }),
  );
}

async function chat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }

  // Browsers always send Origin on a cross-site POST. Requiring JSON also
  // forces a CORS preflight, which this endpoint never answers.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden" }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await env.CHAT_LIMIT.limit({ key: ip })).success) {
    return json({ error: "rate_limited" }, 429);
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);

  let turns: Turn[] | null = null;
  try {
    turns = parseTurns(JSON.parse(raw));
  } catch {
    // Falls through to the 400 below.
  }
  if (!turns) return json({ error: "bad_request" }, 400);

  const asked = turns.filter((t) => t.role === "user").map((t) => t.content);
  const upstream = await withTimeout(HEADERS_TIMEOUT_MS, (signal) =>
    callDesk(env, turns, signal, visitorHeaders(request)),
  );
  if (!upstream) {
    const poe = await askPoe(env, turns, asked);
    return poe ? stream(poe) : json({ error: "offline" }, 503);
  }

  const first = deskEvent(upstream.headers.get(DESK_STATE_HEADER));
  return stream(deskOrPoe(env, turns, asked, upstream.body, first));
}

/**
 * The desk's `desk` event at once, so a cold start shows, then its answer.
 * If no answer text comes (see `untilAnswer`), Poe answers instead. Once the
 * desk's text is out nothing switches: an answer cut off midway isn't asked
 * again.
 */
function deskOrPoe(
  env: Env,
  turns: Turn[],
  asked: string[],
  desk: ReadableStream<Uint8Array>,
  first: object | null,
): ReadableStream<Uint8Array> {
  const gone = new AbortController();
  let source: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream({
    start(out) {
      if (first) out.enqueue(line(first));
    },
    async pull(out) {
      if (!source) {
        const since = Date.now();
        const answer = await untilAnswer(
          desk,
          ANSWER_START_TIMEOUT_MS,
          gone.signal,
        );
        let picked = answer?.pipeThrough(relay(asked)) ?? null;
        if (!picked && !gone.signal.aborted) {
          console.log(`desk: no answer text after ${Date.now() - since}ms`);
          picked = await askPoe(env, turns, asked, { type: "fallback" });
        }
        // The visitor hung up while this waited.
        if (gone.signal.aborted) {
          await picked?.cancel();
          return;
        }
        if (!picked) {
          out.enqueue(line({ type: "error", code: "offline" }));
          out.close();
          return;
        }
        source = picked.getReader();
      }
      const { value, done } = await source.read();
      if (gone.signal.aborted) return;
      if (done) out.close();
      else out.enqueue(value);
    },
    cancel(reason) {
      gone.abort();
      return source?.cancel(reason);
    },
  });
}

/**
 * Poe's answer as the shell's events, after `first`, or null: no key, over
 * POE_LIMIT, or Poe didn't start.
 */
async function askPoe(
  env: Env,
  turns: Turn[],
  asked: string[],
  first: object | null = null,
): Promise<ReadableStream<Uint8Array> | null> {
  const key = env.POE_API_KEY;
  if (!key) return null;
  // One key for everyone: a cap on the points the public can spend.
  if (!(await env.POE_LIMIT.limit({ key: "poe" })).success) {
    console.log("poe: over POE_LIMIT");
    return null;
  }

  const res = await withTimeout(POE_HEADERS_TIMEOUT_MS, (signal) =>
    callPoe(key, env.POE_MODEL, turns, signal),
  );
  if (!res) {
    console.log("poe: no answer");
    return null;
  }
  return res.body
    .pipeThrough(fromPoe())
    .pipeThrough(relay(asked, { first, stats: false }));
}

/** An ok response with a body, or null; the timeout covers headers only. */
async function withTimeout(
  ms: number,
  call: (signal: AbortSignal) => Promise<Response>,
): Promise<(Response & { body: ReadableStream<Uint8Array> }) | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let res: Response;
  try {
    res = await call(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (res.ok && res.body) {
    return res as Response & { body: ReadableStream<Uint8Array> };
  }
  await res.body?.cancel();
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/chat") return chat(request, env);
    return json({ error: "not_found" }, 404);
  },
};
