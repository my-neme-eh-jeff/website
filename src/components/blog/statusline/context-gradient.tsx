import { component$, useSignal } from "@qwik.dev/core";
import { Range } from "../controls";
import { gradCss, render } from "./model";
import { quiet } from "./scenarios";
import { Segment, Terminal } from "./terminal";

const SAMPLES = [8, 30, 52, 74, 93];

// grad() is linear in red up to 50% and in green after it, so three stops
// draw it exactly.
const STRIP = `linear-gradient(to right, ${gradCss(0)}, ${gradCss(50)}, ${gradCss(100)})`;

const brain = (n: number) =>
  render(quiet({ context: n })).lines[0]?.filter((g) => g.part === "context") ??
  [];

export const ContextGradient = component$(() => {
  const pct = useSignal(64);

  return (
    <div>
      <Terminal
        lines={[
          render(quiet({ context: pct.value, cost: 2.4 })).lines[0] ?? [],
        ]}
        label="Status line"
      />

      <div class="bg-term border-term-fg/10 mt-3 rounded-xl border px-4 pt-4 pb-3">
        <div class="relative h-2 rounded-full" style={{ background: STRIP }}>
          <span
            class="border-term bg-term-fg absolute top-1/2 size-4 -translate-1/2 rounded-full border-2"
            style={{ left: `${pct.value}%` }}
            aria-hidden="true"
          />
        </div>
        <div class="mt-3 flex justify-between font-mono text-[0.75rem]">
          {SAMPLES.map((n) => (
            <span key={n} class="whitespace-pre">
              {brain(n).map((g, j) => Segment(g, j))}
            </span>
          ))}
        </div>
      </div>

      <div class="mt-5 max-w-sm">
        <Range
          label="Context used"
          value={pct}
          min={0}
          max={100}
          text={`${pct.value}%`}
        />
      </div>
    </div>
  );
});
