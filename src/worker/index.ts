import {
  DESK_REQUEST,
  MAX_ASSISTANT_CHARS,
  MAX_TURNS,
  MAX_USER_CHARS,
  SYSTEM_PROMPT,
} from "../content/chat";
import { callPoe, fromPoe } from "./poe";
import { DESK_STATE_HEADER, deskEvent, relay, untilAnswer } from "./relay";

// Wrangler finds Durable Object classes among the main module's exports.
export { PoeBudget } from "./poe-budget";

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
  PING_LIMIT: RateLimit;
  DESK_MODEL: string;
  /** A secret. Unset, a desk that can't answer is reported as offline. */
  POE_API_KEY?: string;
  POE_LIMIT: RateLimit;
  POE_MODEL: string;
  /** Poe answers a UTC day, all locations together; counted by POE_BUDGET. */
  POE_DAILY_CAP: string;
  POE_BUDGET: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(input: string): Promise<Response> };
  };
}

type Turn = { role: "user" | "assistant"; content: string };

// The longest conversation the terminal sends, in bytes: turns at their caps,
// half of them answers, 3 UTF-8 bytes per UTF-16 unit (Hindi, CJK), plus the
// JSON around them. A 16 KB cap refused a long Hindi chat (2026-10-25).
const MAX_BODY_BYTES =
  3 * (MAX_TURNS / 2) * (MAX_USER_CHARS + MAX_ASSISTANT_CHARS) + 1_000;

/** The body as text, or null once it passes `max` bytes, read no further. */
async function readCapped(
  request: Request,
  max: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * For response headers only. The desk's proxy sends them before Ollama loads
 * anything (0.2-0.3s through the tunnel, 2026-10-19), so a desk that hasn't
 * answered by now is down, not cold. The stream itself is not timed out.
 */
const HEADERS_TIMEOUT_MS = 5_000;

/**
 * From the desk's headers to its first answer text. In its log (2026-10-14 to
 * 2026-10-20), 60 warm answers started within 8.5s unless queued behind other
 * questions, and 25 cold starts within 25.0s: that one first swapped out an
 * idle 30B eval model, and loading took 15.9s. One queued behind an eval's
 * answers took 52.9s.
 */
const WARM_START_MS = 30_000;
const COLD_START_MS = 45_000;

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
  // Content-Length can be absent, so count what actually arrives.
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return json({ error: "too_large" }, 413);

  let turns: Turn[] | null = null;
  try {
    turns = parseTurns(JSON.parse(raw));
  } catch {
    // Falls through to the 400 below.
  }
  if (!turns) return json({ error: "bad_request" }, 400);

  const asked = turns.filter((t) => t.role === "user").map((t) => t.content);
  const upstream = await withTimeout("desk", HEADERS_TIMEOUT_MS, (signal) =>
    callDesk(env, turns, signal, visitorHeaders(request)),
  );
  if (!upstream) {
    const poe = await askPoe(env, turns, asked);
    return poe ? stream(poe) : json({ error: "offline" }, 503);
  }

  const first = deskEvent(upstream.headers.get(DESK_STATE_HEADER));
  // No header is an older proxy, which may be loading too.
  const hold = first?.cold === false ? WARM_START_MS : COLD_START_MS;
  return stream(deskOrPoe(env, turns, asked, upstream.body, first, hold));
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
  hold: number,
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
        const answer = await untilAnswer(desk, hold, gone.signal);
        let picked = answer?.pipeThrough(relay(asked)) ?? null;
        if (!picked && !gone.signal.aborted) {
          console.log(`desk: no answer text after ${Date.now() - since}ms`);
          picked = await askPoe(
            env,
            turns,
            asked,
            { type: "fallback" },
            gone.signal,
          );
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
 * POE_LIMIT or POE_DAILY_CAP, or Poe didn't start.
 */
async function askPoe(
  env: Env,
  turns: Turn[],
  asked: string[],
  first: object | null = null,
  hangUp?: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  const key = env.POE_API_KEY;
  if (!key) return null;
  // One key for everyone: a cap on the points the public can spend.
  if (!(await env.POE_LIMIT.limit({ key: "poe" })).success) {
    console.log("poe: over POE_LIMIT");
    return null;
  }
  if (!(await takeFromDailyCap(env))) return null;

  const res = await withTimeout(
    "poe",
    POE_HEADERS_TIMEOUT_MS,
    (signal) => callPoe(key, env.POE_MODEL, turns, signal),
    hangUp,
  );
  if (!res) return null;
  return res.body
    .pipeThrough(fromPoe())
    .pipeThrough(relay(asked, { first, stats: false }));
}

/**
 * Counts one Poe answer against today's POE_DAILY_CAP. False once it's spent,
 * and also if the count can't be made: a cap on money fails closed.
 */
async function takeFromDailyCap(env: Env): Promise<boolean> {
  try {
    const budget = env.POE_BUDGET.get(env.POE_BUDGET.idFromName("poe"));
    const cap = encodeURIComponent(env.POE_DAILY_CAP);
    const res = await budget.fetch(`https://poe-budget/take?cap=${cap}`);
    if (res.status === 204) return true;
    console.log(`poe: over POE_DAILY_CAP (${res.status})`);
  } catch (err) {
    console.log(`poe budget: ${err instanceof Error ? err.name : "failed"}`);
  }
  return false;
}

/**
 * An ok response with a body, or null, logged with why: the status, or the
 * error's name, never its message. The timeout, and `hangUp`, cover headers
 * only.
 */
async function withTimeout(
  label: string,
  ms: number,
  call: (signal: AbortSignal) => Promise<Response>,
  hangUp?: AbortSignal,
): Promise<(Response & { body: ReadableStream<Uint8Array> }) | null> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, ms);
  hangUp?.addEventListener("abort", stop);
  if (hangUp?.aborted) stop();
  let res: Response;
  try {
    res = await call(controller.signal);
  } catch (err) {
    console.log(`${label}: ${err instanceof Error ? err.name : "failed"}`);
    return null;
  } finally {
    clearTimeout(timer);
    hangUp?.removeEventListener("abort", stop);
  }
  if (res.ok && res.body) {
    return res as Response & { body: ReadableStream<Uint8Array> };
  }
  console.log(`${label}: ${res.status}`);
  await res.body?.cancel();
  return null;
}

/**
 * `GET /api/ping?count=n`, n from 1 to 3, for the shell's `ping desk` and
 * `traceroute desk`: n round trips through the tunnel to the desk's proxy, a
 * second apart, one NDJSON line each. The proxy answers anything but
 * `POST /api/chat` with a 404 at once and asks Ollama nothing, so that 404 is
 * the desk saying it is up, and the tunnel's reach is unchanged.
 *
 * One request for all n: Cloudflare's rate limiting rule on /api/* let 3
 * requests a 10 s window through per IP and answered the 4th, a chat
 * included, with `429 error code: 1015` (measured 2026-10-29). Re-check: four
 * quick `curl https://amannambisan.com/api/ping`.
 */
async function ping(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await env.PING_LIMIT.limit({ key: ip })).success) {
    return json({ error: "rate_limited" }, 429);
  }
  const asked = Number.parseInt(
    new URL(request.url).searchParams.get("count") ?? "",
    10,
  );
  const count = Math.min(3, Math.max(1, asked || 1));
  const colo = (request as { cf?: { colo?: string } }).cf?.colo ?? "";
  let gone = false;

  return stream(
    new ReadableStream({
      async start(c) {
        for (let seq = 1; seq <= count && !gone; seq++) {
          const started = Date.now();
          const up = await env.DESK.fetch(
            new Request("http://127.0.0.1:11434/ping", {
              signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS),
            }),
          ).then(
            async (res) => {
              await res.body?.cancel();
              return res.status === 404;
            },
            () => false,
          );
          // Workers' clock only moves across I/O, which is all this times.
          const deskMs = up ? Date.now() - started : null;
          if (gone) return;
          c.enqueue(line({ seq, up, colo, deskMs }));
          const wait = 1000 - (Date.now() - started);
          if (seq < count && wait > 0) {
            await new Promise((done) => setTimeout(done, wait));
          }
        }
        if (!gone) c.close();
      },
      cancel() {
        gone = true;
      },
    }),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/chat") return chat(request, env);
    if (pathname === "/api/ping") return ping(request, env);
    return json({ error: "not_found" }, 404);
  },
};
