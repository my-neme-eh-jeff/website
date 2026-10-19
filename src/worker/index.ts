import {
  MAX_ASSISTANT_CHARS,
  MAX_TURNS,
  MAX_USER_CHARS,
  NUM_PREDICT,
  SYSTEM_PROMPT,
} from "../content/chat";
import { DESK_STATE_HEADER, deskEvent, relay } from "./relay";

/**
 * `POST /api/chat`, streamed back as NDJSON events:
 *
 *   {"type":"desk","cold":true}      first: whether the model must load
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

interface Env {
  /** Workers VPC binding to the desk's log proxy, through a Cloudflare Tunnel. */
  DESK: { fetch(input: Request): Promise<Response> };
  CHAT_LIMIT: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  DESK_MODEL: string;
}

type Turn = { role: "user" | "assistant"; content: string };

const MAX_BODY_BYTES = 16_000;

/**
 * For response headers only. The desk's proxy sends them before Ollama loads
 * anything, so a desk that hasn't answered by now is down, not cold. The
 * stream itself is not timed out.
 */
const HEADERS_TIMEOUT_MS = 8_000;

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
        stream: true,
        think: "low",
        keep_alive: "30m",
        options: { num_predict: NUM_PREDICT },
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await callDesk(
      env,
      turns,
      controller.signal,
      visitorHeaders(request),
    );
  } catch {
    return json({ error: "offline" }, 503);
  } finally {
    clearTimeout(timer);
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return json({ error: "offline" }, 503);
  }

  const asked = turns.filter((t) => t.role === "user").map((t) => t.content);
  const first = deskEvent(upstream.headers.get(DESK_STATE_HEADER));
  // A fresh Response, so none of the desk's headers reach the browser.
  return new Response(upstream.body.pipeThrough(relay(asked, first)), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/chat") return chat(request, env);
    return json({ error: "not_found" }, 404);
  },
};
