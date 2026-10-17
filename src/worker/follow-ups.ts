export const SENTINEL = "<<next>>";

// gpt-oss-16k:20b has written "<<next<|message|>" in place of the sentinel
// (2026-10-16), so the block starts at "<<next" and `parse` drops the token.
const MARK = SENTINEL.slice(0, -2);

export const MAX_FOLLOW_UPS = 3;

/** Splits a streamed reply into the answer and the block after the sentinel. */
export function splitter() {
  let held = "";
  let block: string | null = null;

  return {
    /** Text that is safe to show now. */
    push(text: string): string {
      if (block !== null) {
        block += text;
        return "";
      }
      held += text;
      const at = held.indexOf(MARK);
      if (at >= 0) {
        block = held.slice(at + MARK.length);
        const shown = held.slice(0, at).trimEnd();
        held = "";
        return shown;
      }
      let keep = 0;
      for (let k = Math.min(held.length, MARK.length - 1); k > 0; k--) {
        if (MARK.startsWith(held.slice(-k))) {
          keep = k;
          break;
        }
      }
      let cut = held.length - keep;
      while (cut > 0 && /\s/.test(held[cut - 1]!)) cut--;
      const shown = held.slice(0, cut);
      held = held.slice(cut);
      return shown;
    },
    /** The block so far, or null until the answer has ended. */
    block(): string | null {
      return block;
    },
    /** Whatever is still held, and the block, or null if none came. */
    end(): { text: string; block: string | null } {
      const text = block === null ? held : "";
      held = "";
      return { text, block };
    },
  };
}

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Up to MAX_FOLLOW_UPS lines of `block` that are questions and appear nowhere
 * in what the visitor wrote, so a visitor cannot dictate one.
 */
export function parse(block: string, asked: readonly string[]): string[] {
  const said = asked.map(key);
  const seen = new Set<string>();
  const out: string[] = [];
  const lines = block
    .replace(/^>>/, "")
    .replace(/<\|[^|]*\|>/g, "\n")
    .split(/\n|(?<=\?)\s+/);
  for (const line of lines) {
    const q = line
      .replace(/\s+/g, " ")
      .replace(/\p{C}/gu, "")
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "")
      .replace(/[*_`"“”]/g, "")
      .trim();
    if (q.length < 8 || q.length > 60 || !q.endsWith("?")) continue;
    if (/:\/\/|www\.|@/i.test(q)) continue;
    const k = key(q);
    if (seen.has(k) || said.some((s) => s.includes(k))) continue;
    seen.add(k);
    out.push(q);
    if (out.length === MAX_FOLLOW_UPS) break;
  }
  return out;
}

/**
 * The questions on the finished lines of a block still being written. Each
 * call's list begins with the last's, and all of them begin `parse(block)`.
 */
export function finished(block: string, asked: readonly string[]): string[] {
  return parse(/^[\s\S]*(?:\n|\?\s)/.exec(block)?.[0] ?? "", asked);
}
