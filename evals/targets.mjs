import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DESK_REQUEST, SYSTEM_PROMPT } from "../src/content/chat.ts";
import { FALLBACK_PROMPT, callPoe, poeLine } from "../src/worker/poe.ts";
import { events } from "../src/worker/relay.ts";
import { makerOf } from "./models.mjs";

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

function desk({ host }) {
  const model = varOf("DESK_MODEL");
  return {
    name: "desk",
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
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      for await (const l of lines(res.body)) {
        try {
          const chunk = JSON.parse(l);
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

function fallback() {
  const model = varOf("POE_MODEL");
  const key = process.env.POE_API_KEY;
  return {
    name: "fallback",
    model,
    maker: makerOf(model),
    onDesk: false,
    prompt: FALLBACK_PROMPT,
    async warm() {},
    async ask(turns) {
      if (!key) throw new Error("POE_API_KEY is not set");
      const rd = reader(turns, false);
      const controller = new AbortController();
      const res = await callPoe(key, model, turns, controller.signal);
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
        for (const o of poeLine(l)) rd.line(JSON.stringify(o));
        if (rd.stopped) {
          controller.abort();
          break;
        }
      }
      return rd.end();
    },
  };
}

/** `desk` (Ollama on the desk) or `fallback` (the Worker's Poe model). */
export function target(name, options) {
  if (name === "desk") return desk(options);
  if (name === "fallback") return fallback(options);
  throw new Error(`unknown target ${name}: use desk or fallback`);
}
