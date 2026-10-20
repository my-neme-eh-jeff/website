import { finished, loopGuard, parse, splitter } from "./follow-ups.ts";

type Chunk = {
  error?: unknown;
  done?: boolean;
  model?: string;
  message?: { content?: string };
  load_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};

export type Stats = { tokPerSec: number; loadMs: number };

/**
 * Ollama sends a count and a time, never a rate. This is how its docs
 * (docs/api.md) and `ollama run --verbose` turn them into one (read
 * 2026-10-19, Ollama 0.35).
 */
function statsOf(chunk: Chunk): Stats {
  const ns = chunk.eval_duration ?? 0;
  return {
    tokPerSec: ns > 0 ? ((chunk.eval_count ?? 0) / ns) * 1e9 : 0,
    loadMs: Math.round((chunk.load_duration ?? 0) / 1e6),
  };
}

/** Ollama's NDJSON lines in, the shell's events out. Reasoning is dropped. */
/** `stats: false` sends `done` without timings, so the shell shows none. */
export function events(asked: readonly string[], { stats = true } = {}) {
  const split = splitter();
  const guard = loopGuard();
  let stopped = false;
  let answered = false;
  let sent = 0;

  return {
    line(line: string): object[] {
      if (!line.trim()) return [];
      let chunk: Chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        return [];
      }
      if (stopped) return [];
      if (chunk.error) return [{ type: "error", code: "upstream" }];

      const out: object[] = [];
      const text = chunk.message?.content && split.push(chunk.message.content);
      const rest = chunk.done ? split.end().text : "";
      for (const t of [text, rest]) {
        if (!t) continue;
        const safe = guard.push(t);
        if (safe) out.push({ type: "token", text: safe });
        if (guard.looped) {
          // The answer so far stands; the rest would only repeat it.
          stopped = true;
          out.push({ type: "done", model: chunk.model, stats: null, next: [] });
          return out;
        }
      }

      const block = split.block();
      if (block !== null || chunk.done) {
        const held = guard.flush();
        if (held) out.push({ type: "token", text: held });
      }
      const next =
        block === null
          ? []
          : chunk.done
            ? parse(block, asked)
            : finished(block, asked);
      if (block !== null && !answered) {
        answered = true;
        out.push({ type: "answered" });
      }
      for (const q of next.slice(sent)) out.push({ type: "next", text: q });
      sent = Math.max(sent, next.length);

      if (chunk.done) {
        out.push({
          type: "done",
          model: chunk.model,
          stats: stats ? statsOf(chunk) : null,
          next,
        });
      }
      return out;
    },

    /** The stream closed: whatever text is still held. */
    end(): object[] {
      if (stopped) return [];
      const text = split.end().text + guard.flush();
      return text ? [{ type: "token", text }] : [];
    },

    /** Once true, nothing more is wanted from the desk. */
    get stopped() {
      return stopped;
    },
  };
}

/** Set by desk/chat-log-proxy.mjs to `cold` or `warm` before Ollama answers. */
export const DESK_STATE_HEADER = "x-desk-model";

/** The header as the shell's first event, or null from an older proxy. */
export function deskEvent(
  state: string | null,
): { type: "desk"; cold: boolean } | null {
  return state === "cold" || state === "warm"
    ? { type: "desk", cold: state === "cold" }
    : null;
}

/** Whether a line of Ollama's starts the answer, rules it out, or neither. */
function answerState(line: string): "started" | "failed" | null {
  let chunk: Chunk;
  try {
    chunk = JSON.parse(line);
  } catch {
    return null;
  }
  if (chunk.error) return "failed";
  if (chunk.message?.content?.trim()) return "started";
  return chunk.done ? "failed" : null;
}

/**
 * Holds the desk's stream until its answer text starts, then returns all of
 * it. Null, with the desk's stream cancelled, when an error line, a reply with
 * no text, the stream ending or breaking, `ms` passing or `signal` comes
 * first. Reasoning isn't answer text.
 */
export async function untilAnswer(
  body: ReadableStream<Uint8Array>,
  ms: number,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader();
  const seen: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  let started = false;
  // A pending read() then ends as `done`.
  const stop = () => {
    if (!started) reader.cancel().catch(() => {});
  };
  const timer = setTimeout(stop, ms);
  signal.addEventListener("abort", stop);
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return null;
      seen.push(value);
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const state = answerState(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (state === "failed") return null;
        if (state === "started") {
          started = true;
          return replay(seen, reader);
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    stop();
  }
}

/** What was read, then the rest. Cancelling it cancels the desk. */
function replay(
  seen: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(out) {
      for (const bytes of seen) out.enqueue(bytes);
    },
    async pull(out) {
      const { value, done } = await reader.read();
      if (done) out.close();
      else out.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export function relay(
  asked: readonly string[],
  {
    first = null,
    stats = true,
  }: { first?: object | null; stats?: boolean } = {},
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const ev = events(asked, { stats });
  let buffer = "";

  const send = (
    list: object[],
    out: TransformStreamDefaultController<Uint8Array>,
  ) => {
    for (const e of list) out.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
  };

  return new TransformStream({
    start(out) {
      if (first) send([first], out);
    },
    transform(bytes, out) {
      buffer += decoder.decode(bytes, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        send(ev.line(buffer.slice(0, nl)), out);
        buffer = buffer.slice(nl + 1);
      }
      // Cancels the request to the desk, which stops generating.
      if (ev.stopped) out.terminate();
    },
    flush(out) {
      buffer += decoder.decode();
      send(ev.line(buffer), out);
      send(ev.end(), out);
    },
  });
}
