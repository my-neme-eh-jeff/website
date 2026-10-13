/**
 * The browser half of `chat`: POST /api/chat, read the NDJSON events back.
 *
 * Imported only from terminal handlers, so like commands.ts it downloads the
 * first time someone uses it. The in-flight request lives at module scope
 * because an AbortController cannot be serialised into a Qwik store.
 */

export type Turn = { role: "user" | "assistant"; content: string };

export type Stats = {
  loadMs: number;
  promptTokens: number;
  cachedTokens: number;
  promptMs: number;
  tokens: number;
  genMs: number;
};

export type Outcome =
  | { ok: true; model: string; stats: Stats | null; firstTokenMs: number }
  | { ok: false; code: string };

let inflight: AbortController | null = null;

/** Stop the answer being generated, if there is one. */
export function abortChat(): boolean {
  if (!inflight) return false;
  inflight.abort();
  inflight = null;
  return true;
}

export async function sendChat(
  turns: Turn[],
  onToken: (text: string) => void,
): Promise<Outcome> {
  abortChat();
  const controller = new AbortController();
  inflight = controller;
  const started = performance.now();
  let firstTokenMs = -1;

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
    let done: { model: string; stats: Stats } | null = null;

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
          | { type: "token"; text: string }
          | { type: "done"; model: string; stats: Stats }
          | { type: "error"; code: string };
        if (event.type === "token") {
          if (firstTokenMs < 0) firstTokenMs = performance.now() - started;
          onToken(event.text);
        } else if (event.type === "done") {
          done = event;
        } else {
          return { ok: false, code: event.code };
        }
      }
    }

    return {
      ok: true,
      model: done?.model ?? "",
      stats: done?.stats ?? null,
      firstTokenMs,
    };
  } catch (err) {
    return {
      ok: false,
      code:
        err instanceof DOMException && err.name === "AbortError"
          ? "aborted"
          : "offline",
    };
  } finally {
    if (inflight === controller) inflight = null;
  }
}
