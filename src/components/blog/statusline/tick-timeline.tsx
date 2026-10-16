import { component$, useSignal } from "@qwik.dev/core";
import { Range } from "../controls";
import { quiet } from "./scenarios";
import { Statusline, Terminal } from "./terminal";

const REFRESH = 5000;
const SPAN = 60000;
const TICKS = SPAN / REFRESH;

const RUNS = [
  { ms: 18, label: "18 ms" },
  { ms: 600, label: "0.6 s" },
  { ms: 2500, label: "2.5 s" },
  { ms: 4800, label: "4.8 s" },
  { ms: 7000, label: "7 s" },
  { ms: 40000, label: "40 s" },
];

/** Drawn at two widths: SVG text scales with the viewBox, so one is unreadable on a phone. */
const Chart = ({
  W,
  every,
  ms,
  class: cls,
}: {
  W: number;
  every: number;
  ms: number;
  class: string;
}) => {
  const x = (t: number) => 12 + (t / SPAN) * (W - 24);
  const finishes = ms < REFRESH;
  return (
    <svg viewBox={`0 0 ${W} 92`} class={cls} aria-hidden="true">
      {Array.from({ length: TICKS + 1 }, (_, i) => {
        const t = i * REFRESH;
        return (
          <g key={i}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={20}
              y2={66}
              class="stroke-line"
              stroke-dasharray="2 3"
            />
            {i % every === 0 && (
              <text
                x={x(t)}
                y={84}
                text-anchor="middle"
                class="fill-muted font-mono text-[10px]"
              >
                {t / 1000}s
              </text>
            )}
          </g>
        );
      })}
      <text x={x(0)} y={12} class="fill-muted font-mono text-[10px]">
        refresh every 5 s
      </text>
      {Array.from({ length: TICKS }, (_, i) => {
        const t = i * REFRESH;
        const end = t + Math.min(ms, REFRESH);
        return (
          <g key={i}>
            <rect
              x={x(t)}
              y={34}
              width={Math.max(2, x(end) - x(t) - (finishes ? 0 : 3))}
              height={16}
              rx={2}
              class={finishes ? "fill-accent" : "fill-muted opacity-40"}
            />
            {finishes ? (
              <circle cx={x(end) + 4} cy={42} r={2.5} class="fill-accent" />
            ) : (
              <path
                d={`M${x(end) - 4} 37 l6 10 m0 -10 l-6 10`}
                class="stroke-danger"
                stroke-width="2"
                stroke-linecap="round"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

export const TickTimeline = component$(() => {
  const step = useSignal(RUNS.length - 1);
  const run = RUNS[step.value] ?? { ms: 18, label: "18 ms" };
  const finishes = run.ms < REFRESH;

  return (
    <div>
      <Chart W={300} every={4} ms={run.ms} class="block w-full sm:hidden" />
      <Chart W={600} every={2} ms={run.ms} class="hidden w-full sm:block" />

      <p class="mt-3 mb-4 text-sm" aria-live="polite">
        {finishes
          ? `${TICKS} of ${TICKS} runs finish, so the line redraws every 5 s.`
          : `0 of ${TICKS} runs finish. Each is cancelled when the next refresh fires, so the line never draws.`}
      </p>

      {finishes ? (
        <Statusline
          state={quiet({ title: "api retry budget" })}
          label="What the session shows"
        />
      ) : (
        <Terminal
          lines={[]}
          label="What the session shows"
          empty="(nothing — the line is blank)"
        />
      )}

      <div class="mt-5 max-w-sm">
        <Range
          label="One run of the script takes"
          value={step}
          min={0}
          max={RUNS.length - 1}
          text={run.label}
        />
      </div>
    </div>
  );
});
