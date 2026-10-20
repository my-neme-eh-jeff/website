/**
 * Runs on Aman's desk, between the Cloudflare Tunnel and Ollama. Only
 * POST /api/chat gets through, so the tunnel can't reach the endpoints that
 * pull and delete models. Node's standard library only: nothing to install.
 */
import http from "node:http";
import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 11500);
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const LOG_DIR =
  process.env.LOG_DIR ?? join(homedir(), ".local/share/portfolio-chat");
const MAX_BODY = 64_000;

/**
 * Ollama moves a loaded model's expires_at when a request on it finishes, and
 * on every read while it runs the first request after a load; an idle model's
 * stands still (0.34.4, measured 2026-10-20). So a model whose expires_at
 * moved within IN_USE_MS is in use. In that day's bake-off runs it stood still
 * at most 104s while the eval was busy (591 answers, 5 models).
 */
const PS_POLL_MS = Number(process.env.PS_POLL_MS ?? 10_000);
const IN_USE_MS = Number(process.env.IN_USE_MS ?? 120_000);

/** What the privacy page promises. Change both together. */
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

const COUNTRY_HEADER = "x-visitor-country";
/** DESK_STATE_HEADER in src/worker/relay.ts; verify checks they match. */
const STATE_HEADER = "x-desk-model";

/**
 * A day file goes once its day began RETENTION_DAYS ago, so no entry outlives
 * the promise by more than the hour between runs.
 */
async function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  for (const f of await readdir(LOG_DIR).catch(() => [])) {
    const day = /^chats-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)?.[1];
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

async function record(entry) {
  const day = entry.ts.slice(0, 10);
  await mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
  await appendFile(
    join(LOG_DIR, `chats-${day}.jsonl`),
    JSON.stringify(entry) + "\n",
    { mode: 0o600 },
  );
}

async function relay(req, res) {
  const started = Date.now();
  const raw = await readBody(req);
  const body = JSON.parse(raw);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const turns = messages.filter((m) => m.role !== "system");

  const entry = {
    id: randomUUID(),
    ts: new Date(started).toISOString(),
    country: req.headers[COUNTRY_HEADER] ?? null,
    model: body.model ?? null,
    question: turns.at(-1)?.content ?? "",
    history: turns.slice(0, -1),
    systemPrompt: system
      ? createHash("sha256").update(system).digest("hex").slice(0, 12)
      : null,
    answer: "",
    reasoning: "",
    outcome: "ok",
    firstTokenMs: null,
    totalMs: null,
    stats: null,
  };

  const upstreamAbort = new AbortController();
  // `close` before `finish` means the visitor hung up mid-answer.
  res.on("close", () => {
    if (!res.writableFinished) {
      entry.outcome = "cancelled";
      upstreamAbort.abort();
    }
  });

  try {
    // Ollama sends no headers until the model is loaded, so these go first:
    // then a desk that never answers is down, not loading.
    const state = await deskState(body.model);
    if (state === null) throw new Error("Ollama did not answer /api/ps");
    if (state === "busy") {
      // Not a 200, so the Worker asks Poe straight away.
      entry.outcome = "busy";
      return json(res, 503, { error: "busy" });
    }
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      [STATE_HEADER]: state,
    });
    res.flushHeaders();

    const upstream = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      signal: upstreamAbort.signal,
    });
    // Its error body, `{"error":"..."}`, streams through as the last line.
    if (!upstream.ok) entry.outcome = `upstream_${upstream.status}`;

    const decoder = new TextDecoder();
    let buffer = "";
    const inspect = (line) => {
      if (!line.trim()) return;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        return;
      }
      if (chunk.error) entry.outcome = "error";
      const text = chunk.message?.content;
      if (text) {
        if (entry.firstTokenMs === null)
          entry.firstTokenMs = Date.now() - started;
        entry.answer += text;
      }
      if (chunk.message?.thinking) entry.reasoning += chunk.message.thinking;
      if (chunk.done) {
        entry.stats = {
          loadMs: Math.round((chunk.load_duration ?? 0) / 1e6),
          promptTokens: chunk.prompt_eval_count ?? 0,
          cachedTokens: chunk.prompt_eval_cached_count ?? 0,
          promptMs: Math.round((chunk.prompt_eval_duration ?? 0) / 1e6),
          tokens: chunk.eval_count ?? 0,
          genMs: Math.round((chunk.eval_duration ?? 0) / 1e6),
          doneReason: chunk.done_reason ?? null,
        };
      }
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
    if (entry.outcome === "ok") entry.outcome = "error";
    if (!res.headersSent) json(res, 502, { error: "upstream" });
    else res.destroy();
    if (entry.outcome === "error") console.error("relay failed:", err);
  } finally {
    entry.totalMs = Date.now() - started;
    await record(entry).catch((err) => console.error("log failed:", err));
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
    `chat log proxy on 127.0.0.1:${PORT} -> ${OLLAMA}, logs in ${LOG_DIR}`,
  );
});

// Between questions too, so a move is timed when it happens, not when asked.
await readPs();
setInterval(readPs, PS_POLL_MS);

const pruneSafely = () =>
  prune().catch((err) => console.error("prune failed:", err));
await pruneSafely();
setInterval(pruneSafely, DAY_MS / 24);
