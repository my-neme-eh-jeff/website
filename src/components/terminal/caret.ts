/**
 * Where the caret sits in the prompt's <textarea>, which has no API for it: a
 * hidden copy with the same box and type lays out the text before the caret,
 * and a marker after it lands where the caret is.
 */
let mirror: HTMLDivElement | null = null;
const ZERO_WIDTH = String.fromCharCode(0x200b);

const COPY = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

function lay(el: HTMLTextAreaElement, at: number) {
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    Object.assign(mirror.style, {
      position: "absolute",
      top: "0",
      left: "-9999px",
      visibility: "hidden",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      boxSizing: "border-box",
    });
    document.body.append(mirror);
  }
  const s = getComputedStyle(el);
  for (const k of COPY) mirror.style[k] = s[k];
  mirror.style.width = `${el.clientWidth}px`;
  mirror.textContent = el.value.slice(0, at);
  const mark = document.createElement("span");
  // The rest of the text wraps the caret's word as the field does; at the
  // end, a zero-width mark, since a visible one wraps off a full line.
  mark.textContent = el.value.slice(at) || ZERO_WIDTH;
  mirror.append(mark);
  return {
    x: mark.offsetLeft,
    y: mark.offsetTop,
    lh: parseFloat(s.lineHeight),
  };
}

/** The caret's line, counting wrapped lines, from 0. */
export function caretLine(el: HTMLTextAreaElement, at: number) {
  const { y, lh } = lay(el, at);
  return Math.round(y / lh);
}

/** The middle of the caret's line, in client pixels, held inside the field's scrolled view. */
export function caretPoint(el: HTMLTextAreaElement): [number, number] {
  const { x, y, lh } = lay(el, el.selectionEnd);
  const r = el.getBoundingClientRect();
  const top = Math.max(0, Math.min(el.clientHeight - lh, y - el.scrollTop));
  return [Math.min(r.right, r.left + x), r.top + top + lh / 2];
}

/**
 * Grows the field a line at a time up to its max-height, then it scrolls. The
 * shell's `--grow` is how far past one line, so the desk keeps its size.
 */
export function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  el.closest<HTMLElement>("[data-shell]")?.style.setProperty(
    "--grow",
    `${Math.max(0, el.offsetHeight - lh)}px`,
  );
}

/** Sets the field's text from code, which fires no `input`, and fits it. */
export function setField(el: HTMLTextAreaElement, text: string) {
  el.value = text;
  grow(el);
}
