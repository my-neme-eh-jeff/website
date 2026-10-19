import { finished, loopGuard, parse, splitter } from "./follow-ups.ts";

type Chunk = {
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

/** Ollama's NDJSON lines in, the shell's events out. Reasoning is dropped. */
export function events(asked: readonly string[]) {
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
          stats: {
            loadMs: Math.round((chunk.load_duration ?? 0) / 1e6),
            promptTokens: chunk.prompt_eval_count ?? 0,
            cachedTokens: chunk.prompt_eval_cached_count ?? 0,
            promptMs: Math.round((chunk.prompt_eval_duration ?? 0) / 1e6),
            tokens: chunk.eval_count ?? 0,
            genMs: Math.round((chunk.eval_duration ?? 0) / 1e6),
          },
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

export function relay(
  asked: readonly string[],
  first: object | null = null,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const ev = events(asked);
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
