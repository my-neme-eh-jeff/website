import type { Stats } from "../../worker/relay";

export type Turn = { role: "user" | "assistant"; content: string };

export type Outcome =
  | {
      ok: true;
      model: string;
      stats: Stats | null;
      firstTokenMs: number;
      next: string[];
    }
  | { ok: false; code: string };

export type Handlers = {
  /** Before any token: whether the model had to be loaded first. */
  desk: (cold: boolean) => void;
  /** The desk took the question but didn't start an answer; Poe's follows. */
  fallback: () => void;
  token: (text: string) => void;
  /** The answer is whole; its next questions are being written. */
  answered: () => void;
  next: (question: string) => void;
};

// Module scope: an AbortController can't be serialised into a Qwik store.
let inflight: AbortController | null = null;

/** Silence after the first token that counts as a hung answer. */
const STALL_MS = 30_000;

/** Stop the answer being generated, if there is one. */
export function abortChat(): boolean {
  if (!inflight) return false;
  inflight.abort();
  inflight = null;
  return true;
}

export async function sendChat(turns: Turn[], on: Handlers): Promise<Outcome> {
  abortChat();
  const controller = new AbortController();
  inflight = controller;
  const started = performance.now();
  let firstTokenMs = -1;
  let answered = false;
  const landed: string[] = [];
  let stalled = false;
  let stall: ReturnType<typeof setTimeout> | undefined;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: turns }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      // A 404 means no Worker answered: `pnpm dev`, or a deploy without one.
      return {
        ok: false,
        code: res.status === 404 ? "offline" : (body?.error ?? "offline"),
      };
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let done: { model: string; stats: Stats; next?: unknown } | null = null;

    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line) as
          | { type: "desk"; cold: unknown }
          | { type: "fallback" }
          | { type: "token"; text: string }
          | { type: "answered" }
          | { type: "next"; text: unknown }
          | { type: "done"; model: string; stats: Stats; next?: unknown }
          | { type: "error"; code: string };
        if (event.type === "desk") {
          on.desk(event.cold === true);
        } else if (event.type === "fallback") {
          on.fallback();
        } else if (event.type === "token") {
          if (firstTokenMs < 0) firstTokenMs = performance.now() - started;
          on.token(event.text);
        } else if (event.type === "answered") {
          answered = true;
          on.answered();
        } else if (event.type === "next") {
          if (typeof event.text !== "string") continue;
          landed.push(event.text);
          on.next(event.text);
        } else if (event.type === "done") {
          done = event;
        } else if (event.type === "error") {
          return { ok: false, code: event.code };
        }
        // Any other type is from a Worker newer than this page: skipped.
      }
      if (firstTokenMs >= 0) {
        clearTimeout(stall);
        stall = setTimeout(() => {
          stalled = true;
          controller.abort();
        }, STALL_MS);
      }
    }

    return {
      ok: true,
      model: done?.model ?? "",
      stats: done?.stats ?? null,
      firstTokenMs,
      next: Array.isArray(done?.next)
        ? done.next.filter((q): q is string => typeof q === "string")
        : landed,
    };
  } catch (err) {
    // Cut off after the answer was whole: keep it, and what questions came.
    if (answered) {
      return { ok: true, model: "", stats: null, firstTokenMs, next: landed };
    }
    if (stalled) return { ok: false, code: "stalled" };
    return {
      ok: false,
      code:
        err instanceof DOMException && err.name === "AbortError"
          ? "aborted"
          : "offline",
    };
  } finally {
    clearTimeout(stall);
    if (inflight === controller) inflight = null;
  }
}
