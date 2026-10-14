import { component$, useSignal } from "@qwik.dev/core";
import { Choice } from "../controls";

const COLS = 64;
const MARGIN = 5;
const TITLE = "api retry budget";
const LINE = ["Opus 5.5 | ", "🧠", " 91% | $11.07 | ", "🔋", " 5h 100% !"];

const EMOJI = new Set(["🧠", "🔋"]);
const chars = LINE.flatMap((p) => (EMOJI.has(p) ? [p] : [...p]));
const measured = chars.length;
const drawn = chars.reduce((n, c) => n + (EMOJI.has(c) ? 2 : 1), 0);
const target = COLS - MARGIN - TITLE.length;

const OPTIONS = [
  { value: "chars", label: "${#LINE1}" },
  { value: "twin", label: "the plain twin" },
] as const;

export const WidthTwin = component$(() => {
  const how = useSignal<string>("chars");
  const twin = how.value === "twin";
  const pad = COLS - (twin ? drawn : measured) - TITLE.length - MARGIN;
  const start = drawn + pad;
  const off = start - target;

  return (
    <div>
      <Choice legend="Measure the line with" options={OPTIONS} value={how} />

      <div class="scroll-cue mt-5 overflow-x-auto pb-1">
        <div
          class="grid w-max font-mono text-[0.6875rem] leading-6"
          style={{ gridTemplateColumns: `repeat(${COLS}, 0.6rem)` }}
          aria-hidden="true"
        >
          {Array.from({ length: COLS }, (_, i) => (
            <span key={`r${i}`} class="text-muted text-center text-[0.5625rem]">
              {i % 10 === 0 ? i : ""}
            </span>
          ))}
          {chars.map((c, i) => (
            <span
              key={`c${i}`}
              class={[
                "bg-text/5 text-center",
                EMOJI.has(c) ? "col-span-2" : "",
              ]}
            >
              {c}
            </span>
          ))}
          {Array.from({ length: pad }, (_, i) => (
            <span key={`p${i}`} />
          ))}
          {[...TITLE].map((c, i) => (
            <span
              key={`t${i}`}
              class={[
                "text-center font-medium",
                start + i >= target + TITLE.length
                  ? "bg-danger/15 text-danger"
                  : "bg-accent/15",
              ]}
            >
              {c}
            </span>
          ))}
          {Array.from({ length: COLS - start - TITLE.length }, (_, i) => (
            <span key={`f${i}`} />
          ))}
          {Array.from({ length: COLS }, (_, i) => (
            <span
              key={`z${i}`}
              class={[
                "mt-1 h-1",
                i >= target && i < target + TITLE.length ? "bg-accent" : "",
                i >= COLS - MARGIN ? "bg-line" : "",
              ]}
            />
          ))}
        </div>
      </div>

      <p class="mt-3 text-sm" aria-live="polite">
        {twin
          ? `The twin writes each emoji as "oo", so it measures ${drawn}: the same ${drawn} columns the terminal draws. The title lands where it should.`
          : `\${#LINE1} counts ${measured} characters, but the terminal draws ${drawn} columns. The title lands ${off} columns right of where it should, one for each emoji.`}
      </p>
      <p class="text-muted mt-1 text-xs">
        A {COLS}-column terminal. The accent bar is where the title belongs; the
        last {MARGIN} columns are the margin the script keeps free.
      </p>
    </div>
  );
});
