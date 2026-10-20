import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DESK_REQUEST,
  NUM_PREDICT,
  SYSTEM_PROMPT,
} from "../src/content/chat.ts";
import { FALLBACK_PROMPT, callPoe, poeLine } from "../src/worker/poe.ts";
import { events } from "../src/worker/relay.ts";
import { EXTRA, PROVIDERS, makerOf } from "./models.mjs";

const wrangler = readFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
const varOf = (name) =>
  new RegExp(`"${name}":\\s*"([^"]+)"`).exec(wrangler)?.[1] ?? null;

/** sha256, first 12 hex: the label the desk's log gives each prompt. */
export const hash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

/** Rules and facts hashed apart, so a fact edit doesn't look like a rule change. */
export function promptHashes(prompt) {
  const parts = prompt.split("\nFacts:\n");
  if (parts.length !== 2)
    throw new Error("the prompt has no single Facts: line");
  return { full: hash(prompt), rules: hash(parts[0]), facts: hash(parts[1]) };
}

async function* lines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Feeds Ollama-format lines through the Worker's relay, as a visitor sees them. */
function reader(turns, stats) {
  const asked = turns.filter((t) => t.role === "user").map((t) => t.content);
  const ev = events(asked, { stats });
  const t0 = performance.now();
  const r = {
    answer: "",
    next: [],
    raw: "",
    tokPerSec: null,
    looped: false,
    doneReason: null,
    thinkingChars: 0,
    firstTokenMs: null,
    totalMs: null,
  };
  const take = (list) => {
    for (const e of list) {
      if (e.type === "token") {
        r.firstTokenMs ??= Math.round(performance.now() - t0);
        r.answer += e.text;
      } else if (e.type === "done") {
        r.next = e.next;
        r.tokPerSec = e.stats?.tokPerSec ?? null;
      } else if (e.type === "error") {
        throw new Error(`upstream error: ${JSON.stringify(e)}`);
      }
    }
  };
  return {
    r,
    line: (l) => take(ev.line(l)),
    get stopped() {
      return ev.stopped;
    },
    end() {
      take(ev.end());
      r.looped = ev.stopped;
      r.totalMs = Math.round(performance.now() - t0);
      return r;
    },
  };
}

function desk({ host, think, extra = {} }, model = varOf("DESK_MODEL")) {
  return {
    name: model === varOf("DESK_MODEL") ? "desk" : `desk:${model}`,
    model,
    maker: makerOf(model),
    onDesk: true,
    prompt: SYSTEM_PROMPT,
    async warm() {
      await this.ask([{ role: "user", content: "Hi" }]);
    },
    async ask(turns) {
      const rd = reader(turns, true);
      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          ...DESK_REQUEST,
          ...(think === undefined ? {} : { think }),
          ...extra,
          options: { ...DESK_REQUEST.options, ...extra.options },
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      for await (const l of lines(res.body)) {
        try {
          const chunk = JSON.parse(l);
          rd.r.raw += chunk.message?.content ?? "";
          rd.r.thinkingChars += chunk.message?.thinking?.length ?? 0;
          if (chunk.done) rd.r.doneReason = chunk.done_reason ?? null;
        } catch {
          // A partial line; the relay skips it too.
        }
        rd.line(l);
        if (rd.stopped) break;
      }
      return rd.end();
    },
  };
}

/** An OpenAI-style stream, through the converter the Worker uses for Poe. */
async function streamed(rd, res, controller) {
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  for await (const l of lines(res.body)) {
    if (l.startsWith("data:")) {
      try {
        const reason = JSON.parse(l.slice(5)).choices?.[0]?.finish_reason;
        if (reason) rd.r.doneReason = reason;
      } catch {
        // "[DONE]" and partial lines.
      }
    }
    for (const o of poeLine(l)) {
      rd.r.raw += o.message?.content ?? "";
      rd.line(JSON.stringify(o));
    }
    if (rd.stopped) {
      controller.abort();
      break;
    }
  }
  return rd.end();
}

function fallback() {
  const model = varOf("POE_MODEL");
  return {
    name: "fallback",
    model,
    maker: makerOf(model),
    onDesk: false,
    prompt: FALLBACK_PROMPT,
    async warm() {},
    async ask(turns) {
      const key = process.env.POE_API_KEY;
      if (!key) throw new Error("POE_API_KEY is not set");
      const controller = new AbortController();
      const rd = reader(turns, false);
      return streamed(
        rd,
        await callPoe(key, model, turns, controller.signal),
        controller,
      );
    },
  };
}

/** Any model behind an API in PROVIDERS, with the fallback's prompt: it isn't on the desk. */
function hosted(provider, model, extra = {}) {
  const p = PROVIDERS[provider];
  return {
    name: `${provider}:${model}`,
    model,
    maker: makerOf(model),
    onDesk: false,
    prompt: FALLBACK_PROMPT,
    async warm() {},
    async ask(turns) {
      const key = p.key ? process.env[p.key] : null;
      if (p.key && !key) throw new Error(`${p.key} is not set`);
      const controller = new AbortController();
      const rd = reader(turns, false);
      const res = await fetch(`${p.url}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          stream: true,
          max_tokens: NUM_PREDICT,
          ...EXTRA[`${provider}:${model}`],
          ...extra,
          messages: [{ role: "system", content: FALLBACK_PROMPT }, ...turns],
        }),
        signal: controller.signal,
      });
      return streamed(rd, res, controller);
    },
  };
}

/**
 * `desk`, `fallback` (the Worker's Poe model), `desk:<ollama model>` for
 * another model on the desk, or `<provider>:<model>` for any in PROVIDERS.
 */
export function target(name, options) {
  if (name === "desk") return desk(options);
  if (name === "fallback") return fallback(options);
  const [head, ...rest] = name.split(":");
  const model = rest.join(":");
  if (head === "desk" && model) return desk(options, model);
  if (PROVIDERS[head] && model) return hosted(head, model, options.extra);
  throw new Error(
    `unknown target ${name}: use desk, fallback, desk:<model> or one of ${Object.keys(PROVIDERS).join(", ")} as <provider>:<model>`,
  );
}
