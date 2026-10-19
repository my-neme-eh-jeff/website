import { NUM_PREDICT, SYSTEM_PROMPT } from "../content/chat.ts";

/** Answers when the desk can't. OpenAI-compatible; billed to Aman's Poe points. */
const POE_URL = "https://api.poe.com/v1/chat/completions";

type Turn = { role: "user" | "assistant"; content: string };

export const DESK_LINE =
  "- If asked how you work, or about the desktop, box or computer on his desk: that is you, a language model running on its GPU at his home, reached through a Cloudflare tunnel.";

/** Poe's model isn't on the desk, so it mustn't say it is. */
export const FALLBACK_PROMPT = SYSTEM_PROMPT.replace(
  DESK_LINE,
  "- If asked how you work: you are a language model answering from a fixed set of facts about him.",
);

export function callPoe(
  key: string,
  model: string,
  turns: Turn[],
  signal: AbortSignal,
) {
  return fetch(POE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: NUM_PREDICT,
      // A bot parameter on Poe; ds-v4.1-flash-1017 thinks by default.
      enable_thinking: false,
      messages: [{ role: "system", content: FALLBACK_PROMPT }, ...turns],
    }),
    signal,
  });
}

type Chunk = {
  error?: unknown;
  model?: string;
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
};

/** One `data:` line of Poe's stream as the lines Ollama would have sent. */
export function poeLine(line: string): object[] {
  if (!line.startsWith("data:")) return [];
  const data = line.slice(5).trim();
  if (data === "[DONE]") return [];
  let chunk: Chunk;
  try {
    chunk = JSON.parse(data);
  } catch {
    return [];
  }
  if (chunk.error) return [{ error: "poe" }];
  const choice = chunk.choices?.[0];
  const out: object[] = [];
  const text = choice?.delta?.content;
  if (text) out.push({ model: chunk.model, message: { content: text } });
  if (choice?.finish_reason) {
    out.push({ model: chunk.model, message: { content: "" }, done: true });
  }
  return out;
}

/** Poe's server-sent events in, Ollama's NDJSON out, so `relay` reads both. */
export function fromPoe(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const send = (
    lines: object[],
    out: TransformStreamDefaultController<Uint8Array>,
  ) => {
    for (const l of lines)
      out.enqueue(encoder.encode(JSON.stringify(l) + "\n"));
  };

  return new TransformStream({
    transform(bytes, out) {
      buffer += decoder.decode(bytes, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        send(poeLine(buffer.slice(0, nl).trimEnd()), out);
        buffer = buffer.slice(nl + 1);
      }
    },
    flush(out) {
      buffer += decoder.decode();
      send(poeLine(buffer.trimEnd()), out);
    },
  });
}
