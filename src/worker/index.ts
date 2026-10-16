import {
  MAX_ASSISTANT_CHARS,
  MAX_TURNS,
  MAX_USER_CHARS,
  SYSTEM_PROMPT,
} from "../content/chat";

/**
 * The only server code on the site: `POST /api/chat`.
 *
 * wrangler.jsonc routes `/api/*` here and nothing else, so page views never
 * invoke this. It relays a conversation to a model running on Aman's desk and
 * streams the answer back as NDJSON events:
 *
 *   {"type":"token","text":"..."}
 *   {"type":"done","model":"...","stats":{...}}
 *   {"type":"error","code":"..."}
 *
 * Errors before streaming starts are a JSON body with a non-200 status instead.
 *
 * The visitor controls only message text. The path, model, sampling and
 * prompt are fixed here. The desk's proxy also refuses every path but
 * /api/chat (desk/chat-log-proxy.mjs), so Ollama's pull and delete endpoints
 * are unreachable twice over.
 *
 * The desk logs each chat for 30 days. The only fact about the visitor sent
 * with it is their country: /privacy/ promises exactly that, so adding a
 * header here means changing that page too.
 */

interface Env {
  /** Workers VPC binding to Ollama on the desk, via Cloudflare Tunnel. */
  DESK: { fetch(input: Request): Promise<Response> };
  CHAT_LIMIT: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  DESK_MODEL: string;
}

type Turn = { role: "user" | "assistant"; content: string };

const MAX_BODY_BYTES = 16_000;

/**
 * How long to wait for Ollama's response headers. They arrive only after the
 * model is loaded and the prompt is read: a cold start measured 13.6 s of
 * loading alone on 2026-10-13, and a queued request waits for the one ahead.
 * The stream itself is not timed out.
 */
const HEADERS_TIMEOUT_MS = 90_000;

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
  // The model answers the last message, so it has to be the visitor's.
  if (turns.at(-1)?.role !== "user" || !turns.at(-1)?.content.trim()) {
    return null;
  }
  return turns;
}

/** What the desk's log is told about the visitor: the country, nothing else. */
function visitorHeaders(request: Request): Record<string, string> {
  const country = (request as { cf?: { country?: string } }).cf?.country;
  return country ? { "x-visitor-country": country } : {};
}

/**
 * The single place that knows how the desk is reached. Swapping transport
 * (VPC binding today) touches only this function.
 */
function callDesk(
  env: Env,
  turns: Turn[],
  signal: AbortSignal,
  visitor: Record<string, string>,
) {
  return env.DESK.fetch(
    // The VPC service decides where this goes: the log proxy on the desk,
    // which forwards to Ollama itself. The host only fills the Host header.
    new Request("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...visitor },
      body: JSON.stringify({
        model: env.DESK_MODEL,
        stream: true,
        think: "low",
        keep_alive: "30m",
        options: { num_predict: 700 },
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
      }),
      signal,
    }),
  );
}

/** Ollama NDJSON in, the shell's NDJSON events out. Reasoning is dropped. */
function relay(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const emit = (
    line: string,
    out: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (!line.trim()) return;
    let chunk: {
      error?: unknown;
      done?: boolean;
      model?: string;
      message?: { content?: string };
      total_duration?: number;
      load_duration?: number;
      prompt_eval_count?: number;
      prompt_eval_cached_count?: number;
      prompt_eval_duration?: number;
      eval_count?: number;
      eval_duration?: number;
    };
    try {
      chunk = JSON.parse(line);
    } catch {
      return;
    }
    const send = (event: unknown) =>
      out.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

    if (chunk.error) {
      send({ type: "error", code: "upstream" });
      return;
    }
    const text = chunk.message?.content;
    if (text) send({ type: "token", text });
    if (chunk.done) {
      send({
        type: "done",
        model: chunk.model,
        stats: {
          loadMs: Math.round((chunk.load_duration ?? 0) / 1e6),
          promptTokens: chunk.prompt_eval_count ?? 0,
          cachedTokens: chunk.prompt_eval_cached_count ?? 0,
          promptMs: Math.round((chunk.prompt_eval_duration ?? 0) / 1e6),
          tokens: chunk.eval_count ?? 0,
          genMs: Math.round((chunk.eval_duration ?? 0) / 1e6),
        },
      });
    }
  };

  return new TransformStream({
    transform(bytes, out) {
      buffer += decoder.decode(bytes, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        emit(buffer.slice(0, nl), out);
        buffer = buffer.slice(nl + 1);
      }
    },
    flush(out) {
      buffer += decoder.decode();
      emit(buffer, out);
    },
  });
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
    // Tunnel down, desk off, or the wait above ran out. Which one is not the
    // visitor's business, and the internals are not either.
    return json({ error: "offline" }, 503);
  } finally {
    clearTimeout(timer);
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return json({ error: "offline" }, 503);
  }

  // A fresh Response, so none of the desk's headers reach the browser.
  return new Response(upstream.body.pipeThrough(relay()), {
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
