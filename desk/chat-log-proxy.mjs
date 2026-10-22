/**
 * Runs on Aman's desk, between the Cloudflare Tunnel and Ollama. Only
 * POST /api/chat gets through, so the tunnel can't reach the endpoints that
 * pull and delete models. Node's standard library only: nothing to install.
 *
 * Each exchange is kept as an OpenTelemetry trace: one OTLP/JSON
 * ExportTraceServiceRequest per line, with the GenAI semantic conventions
 * (github.com/open-telemetry/semantic-conventions-genai, 2026-10-22).
 * desk/README.md lists what a trace holds.
 */
import http from "node:http";
import { appendFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 11500);
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const LOG_DIR =
  process.env.LOG_DIR ?? join(homedir(), ".local/share/portfolio-chat");
const MAX_BODY = 64_000;

/**
 * Ollama moves a loaded model's expires_at when a request on it finishes, and
 * on every read while it runs the first request after a load; an idle model's
 * stands still (0.34.4, 2026-10-20; probe-ps.mjs re-checks it after an Ollama
 * upgrade). So a model whose expires_at moved within IN_USE_MS is in use. In
 * that day's bake-off runs it stood still at most 104s while the eval was busy
 * (591 answers, 5 models).
 */
const PS_POLL_MS = Number(process.env.PS_POLL_MS ?? 10_000);
const IN_USE_MS = Number(process.env.IN_USE_MS ?? 120_000);

/** What the privacy page promises. Change both together. */
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

const COUNTRY_HEADER = "x-visitor-country";
/** DESK_STATE_HEADER in src/worker/relay.ts; verify checks they match. */
const STATE_HEADER = "x-desk-model";
/** SENTINEL in src/worker/follow-ups.ts; verify checks they match. */
const SENTINEL = "<<next>>";

/**
 * Traces also go to an OTLP/HTTP endpoint, as JSON, when one is set the
 * standard way. The file is written either way.
 */
const OTLP_URL =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
  (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces`
    : null);
const OTLP_HEADERS = Object.fromEntries(
  (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "")
    .split(",")
    .filter((kv) => kv.indexOf("=") > 0)
    .map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)])
    .map((kv) => kv.map((s) => decodeURIComponent(s.trim()))),
);

const VERSION = createHash("sha256")
  .update(await readFile(import.meta.filename))
  .digest("hex")
  .slice(0, 12);
const OLLAMA_HOST = new URL(OLLAMA);

/**
 * A day file goes once its day began RETENTION_DAYS ago, so no entry outlives
 * the promise by more than the hour between runs. chats-*.jsonl is the log's
 * format before traces (until 2026-10-22).
 */
async function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  for (const f of await readdir(LOG_DIR).catch(() => [])) {
    const day = /^(?:chats|traces)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)?.[1];
    if (day && Date.parse(`${day}T00:00:00Z`) < cutoff) {
      await unlink(join(LOG_DIR, f));
      console.log(`deleted ${f} (older than ${RETENTION_DAYS} days)`);
    }
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Each loaded model's last expires_at, and when the proxy saw it move. */
const seen = new Map();
/** Each loaded model's digest: which weights a name pointed at. */
const digests = new Map();
let primed = false;

/** Ollama's loaded models, noting which moved; null if it didn't answer. */
async function readPs() {
  try {
    const res = await fetch(`${OLLAMA}/api/ps`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const { models } = await res.json();
    const loaded = Array.isArray(models) ? models : [];
    const now = Date.now();
    const names = new Set();
    for (const m of loaded) {
      const name = m?.name ?? m?.model;
      const was = seen.get(name);
      names.add(name);
      if (m?.digest) digests.set(name, m.digest);
      if (was?.expiresAt === m?.expires_at) continue;
      // One loaded before the proxy started may be idle; one loaded since
      // was loaded by a request.
      const movedAt = !was && !primed ? -Infinity : now;
      seen.set(name, { expiresAt: m?.expires_at, movedAt });
    }
    for (const name of seen.keys()) if (!names.has(name)) seen.delete(name);
    primed = true;
    return loaded;
  } catch {
    return null;
  }
}

/**
 * `warm` if Ollama has `model` loaded, `busy` if not and another model is in
 * use, `cold` otherwise, or null if Ollama didn't answer. Busy is an eval, say:
 * a question would queue behind its requests, then a load (on 2026-10-20 one
 * waited 53s). A model left loaded but idle is cold: Ollama swaps it out.
 */
async function deskState(model) {
  const loaded = await readPs();
  if (!loaded) return null;
  if (loaded.some((m) => m?.name === model || m?.model === model)) {
    return "warm";
  }
  const now = Date.now();
  const inUse = (m) =>
    now - (seen.get(m?.name ?? m?.model)?.movedAt ?? -Infinity) < IN_USE_MS;
  return loaded.some(inUse) ? "busy" : "cold";
}

const hex = (bytes) => randomBytes(bytes).toString("hex");
const hash12 = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);
/** Nanoseconds since the epoch, as a string: OTLP/JSON writes int64 so. */
const nowNs = () =>
  String(
    BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e3)) *
      1000n,
  );

/** A number the conventions type as double, even when it comes out whole. */
class Double {
  constructor(value) {
    this.value = value;
  }
}
const double = (v) => (typeof v === "number" ? new Double(v) : null);
const int = (v) => (Number.isInteger(v) ? v : null);
const seconds = (ms) =>
  ms == null ? null : new Double(Math.round(ms * 1000) / 1e6);

/** OTLP/JSON's AnyValue: proto3 JSON, so an int64 is a decimal string. */
function anyValue(v) {
  if (v instanceof Double) return { doubleValue: v.value };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(anyValue) } };
  return { kvlistValue: { values: attributes(v) } };
}
const attributes = (o) =>
  Object.entries(o)
    .filter(([, v]) => v != null)
    .map(([key, v]) => ({ key, value: anyValue(v) }));

/** A message as the GenAI input and output message schemas have it. */
const message = (role, text, reasoning) => ({
  role,
  parts: [
    ...(reasoning ? [{ type: "reasoning", content: reasoning }] : []),
    { type: "text", content: text ?? "" },
  ],
});

/** A W3C traceparent the caller sent, so the desk's spans join its trace. */
function traceparent(header) {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(
    String(header ?? "").trim(),
  );
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null;
  return { traceId: m[1], spanId: m[2] };
}

/**
 * Turns of one conversation, linked without anything new from the browser:
 * the shell sends each earlier answer back as it showed it, which is the
 * desk's answer up to the suggested questions. A restart starts new ids; the
 * earlier turns in each trace still link them.
 */
const LINK_MS = 6 * 3_600_000;
const links = new Map();
const shown = (answer) =>
  answer
    .split(SENTINEL.slice(0, -2))[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
const linkKey = (country, question, answer) =>
  createHash("sha256")
    .update(`${country ?? ""}\n${question}\n${shown(answer)}`)
    .digest("hex");

function conversationOf(country, turns) {
  const [q, a] = turns.slice(-3, -1);
  const found =
    q?.role === "user" &&
    a?.role === "assistant" &&
    links.get(linkKey(country, q.content, a.content));
  return found && Date.now() - found.at < LINK_MS ? found.id : hex(16);
}

function link(country, question, answer, id) {
  const at = Date.now();
  links.set(linkKey(country, question, answer), { id, at });
  for (const [key, v] of links) {
    if (at - v.at < LINK_MS) break;
    links.delete(key);
  }
}

const SERVER = 2;
const CLIENT = 3;
const ERROR = { code: 2 };
const RESOURCE = {
  attributes: attributes({
    "service.name": process.env.OTEL_SERVICE_NAME ?? "portfolio-desk-proxy",
    "service.version": VERSION,
    "host.name": hostname(),
  }),
};
const SCOPE = { name: "portfolio-desk/chat-log-proxy", version: VERSION };

/** One exchange as an ExportTraceServiceRequest: the HTTP span, then the model's. */
function trace(x) {
  const { body, messages } = x;
  const options =
    body.options && typeof body.options === "object" ? body.options : {};
  const failed = x.outcome === "error" || x.outcome.startsWith("upstream_");
  const input = messages.map((m) => message(m.role, m.content, m.thinking));
  const server = {
    traceId: x.parent?.traceId ?? hex(16),
    spanId: hex(8),
    ...(x.parent && { parentSpanId: x.parent.spanId }),
    name: "POST /api/chat",
    kind: SERVER,
    startTimeUnixNano: x.arrived,
    endTimeUnixNano: x.ended,
    attributes: attributes({
      "http.request.method": "POST",
      "url.path": "/api/chat",
      "http.response.status_code": x.status,
      "error.type": x.status >= 500 ? String(x.status) : null,
      "geo.country.iso_code": x.country,
      "desk.state": x.state,
      "desk.outcome": x.outcome,
      // Asked but never sent to Ollama, as when it was busy.
      "gen_ai.input.messages": x.called ? null : input,
    }),
    status: x.status >= 500 || failed ? ERROR : {},
  };
  const spans = [server];
  if (x.called) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const parts = system.split("\nFacts:\n");
    const done = x.done ?? {};
    const ns = (n) => (typeof n === "number" ? new Double(n / 1e9) : null);
    spans.push({
      traceId: server.traceId,
      spanId: hex(8),
      parentSpanId: server.spanId,
      name: `chat ${body.model}`,
      kind: CLIENT,
      startTimeUnixNano: x.called,
      endTimeUnixNano: x.ended,
      attributes: attributes({
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "ollama",
        "gen_ai.request.model": body.model,
        "gen_ai.response.model": x.responseModel,
        "gen_ai.conversation.id": x.conversation,
        "gen_ai.prompt.name": system ? "portfolio-shell" : null,
        "gen_ai.prompt.version": system ? hash12(system) : null,
        "gen_ai.request.stream": body.stream === true || null,
        "gen_ai.request.max_tokens": int(options.num_predict),
        "gen_ai.request.temperature": double(options.temperature),
        "gen_ai.request.top_p": double(options.top_p),
        "gen_ai.request.top_k": int(options.top_k),
        "gen_ai.request.seed": int(options.seed),
        "gen_ai.request.stop_sequences": Array.isArray(options.stop)
          ? options.stop
          : null,
        "gen_ai.request.reasoning.level":
          typeof body.think === "string" ? body.think : null,
        // The conventions' value when no finish reason came: cancelled, failed.
        "gen_ai.response.finish_reasons": [done.done_reason ?? "error"],
        "gen_ai.response.time_to_first_chunk": seconds(x.firstChunkMs),
        "gen_ai.usage.input_tokens": int(done.prompt_eval_count),
        "gen_ai.usage.cache_read.input_tokens":
          int(done.prompt_eval_cached_count) || null,
        "gen_ai.usage.output_tokens": int(done.eval_count),
        "gen_ai.input.messages": input,
        "gen_ai.output.messages": [message("assistant", x.answer, x.reasoning)],
        "server.address": OLLAMA_HOST.hostname,
        "server.port": Number(OLLAMA_HOST.port || 80),
        "error.type": failed
          ? x.upstreamStatus >= 400
            ? String(x.upstreamStatus)
            : "ollama_error"
          : null,
        "desk.outcome": x.outcome,
        "desk.time_to_first_text": seconds(x.firstTextMs),
        "desk.prompt.rules": parts.length === 2 ? hash12(parts[0]) : null,
        "desk.prompt.facts": parts.length === 2 ? hash12(parts[1]) : null,
        "ollama.request.think": body.think,
        "ollama.request.keep_alive": body.keep_alive,
        "ollama.request.options": options,
        "ollama.model.digest": x.digest,
        "ollama.load_duration": ns(done.load_duration),
        "ollama.prompt_eval_duration": ns(done.prompt_eval_duration),
        "ollama.eval_duration": ns(done.eval_duration),
      }),
      status: failed ? ERROR : {},
    });
  }
  return {
    resourceSpans: [
      { resource: RESOURCE, scopeSpans: [{ scope: SCOPE, spans }] },
    ],
  };
}

async function record(x) {
  const line = JSON.stringify(trace(x));
  const day = new Date(Number(BigInt(x.arrived) / 1_000_000n))
    .toISOString()
    .slice(0, 10);
  await mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
  await appendFile(join(LOG_DIR, `traces-${day}.jsonl`), line + "\n", {
    mode: 0o600,
  });
  if (OTLP_URL) {
    fetch(OTLP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...OTLP_HEADERS },
      body: line,
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => r.ok || console.error(`OTLP export: HTTP ${r.status}`))
      .catch((err) => console.error("OTLP export failed:", err.message));
  }
}

async function relay(req, res) {
  const arrived = nowNs();
  const raw = await readBody(req);
  const body = JSON.parse(raw);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const turns = messages.filter((m) => m.role !== "system");

  const x = {
    arrived,
    ended: null,
    parent: traceparent(req.headers.traceparent),
    country: req.headers[COUNTRY_HEADER] ?? null,
    body,
    messages,
    state: null,
    status: 200,
    outcome: "ok",
    // When the request went to Ollama: ns for the span, ms for durations.
    called: null,
    calledMs: null,
    firstChunkMs: null,
    firstTextMs: null,
    upstreamStatus: null,
    responseModel: null,
    answer: "",
    reasoning: "",
    done: null,
    digest: null,
    conversation: null,
  };

  const upstreamAbort = new AbortController();
  // `close` before `finish` means the visitor hung up mid-answer.
  res.on("close", () => {
    if (!res.writableFinished) {
      x.outcome = "cancelled";
      upstreamAbort.abort();
    }
  });

  try {
    // Ollama sends no headers until the model is loaded, so these go first:
    // then a desk that never answers is down, not loading.
    x.state = await deskState(body.model);
    if (x.state === null) throw new Error("Ollama did not answer /api/ps");
    if (x.state === "busy") {
      // Not a 200, so the Worker asks Poe straight away.
      x.outcome = "busy";
      x.status = 503;
      return json(res, 503, { error: "busy" });
    }
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      [STATE_HEADER]: x.state,
    });
    res.flushHeaders();

    x.conversation = conversationOf(x.country, turns);
    x.called = nowNs();
    x.calledMs = performance.now();
    const upstream = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      signal: upstreamAbort.signal,
    });
    x.upstreamStatus = upstream.status;
    // Its error body, `{"error":"..."}`, streams through as the last line.
    if (!upstream.ok) x.outcome = `upstream_${upstream.status}`;

    const decoder = new TextDecoder();
    let buffer = "";
    const since = () => performance.now() - x.calledMs;
    const inspect = (line) => {
      if (!line.trim()) return;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        return;
      }
      if (chunk.error) x.outcome = "error";
      x.responseModel ??= chunk.model ?? null;
      const text = chunk.message?.content;
      const thinking = chunk.message?.thinking;
      if (text || thinking) x.firstChunkMs ??= since();
      if (text) {
        x.firstTextMs ??= since();
        x.answer += text;
      }
      if (thinking) x.reasoning += thinking;
      if (chunk.done) x.done = chunk;
    };

    for await (const bytes of upstream.body) {
      if (!res.write(bytes)) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
      buffer += decoder.decode(bytes, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        inspect(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    inspect(buffer + decoder.decode());
    res.end();
  } catch (err) {
    if (x.outcome === "ok") x.outcome = "error";
    if (!res.headersSent) {
      x.status = 502;
      json(res, 502, { error: "upstream" });
    } else res.destroy();
    if (x.outcome === "error") console.error("relay failed:", err);
  } finally {
    x.ended = nowNs();
    if (x.called) {
      const question = turns.at(-1)?.content ?? "";
      if (x.answer) link(x.country, question, x.answer, x.conversation);
      if (!digests.has(body.model)) await readPs();
      x.digest = digests.get(body.model) ?? null;
    }
    await record(x).catch((err) => console.error("log failed:", err));
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/chat") {
    return json(res, 404, { error: "not_found" });
  }
  relay(req, res).catch((err) => {
    const status = err.message === "too_large" ? 413 : 400;
    if (!res.headersSent) json(res, status, { error: "bad_request" });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `chat log proxy on 127.0.0.1:${PORT} -> ${OLLAMA}, traces in ${LOG_DIR}${OTLP_URL ? ` and ${OTLP_URL}` : ""}`,
  );
});

// Between questions too, so a move is timed when it happens, not when asked.
await readPs();
setInterval(readPs, PS_POLL_MS);

const pruneSafely = () =>
  prune().catch((err) => console.error("prune failed:", err));
await pruneSafely();
setInterval(pruneSafely, DAY_MS / 24);
