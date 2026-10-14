import { component$, useSignal } from "@qwik.dev/core";
import { Range } from "../controls";
import { chips, dur, render } from "./model";
import { quiet } from "./scenarios";
import { Terminal } from "./terminal";

const WINDOW = 18000;
const T = 18;

type Plot = {
  p: number;
  spent: number;
  end: { t: number; pct: number } | null;
};

/**
 * Drawn twice, at two widths. Text in an SVG scales with its viewBox, so the
 * 600-wide drawing put 10px labels at about 5px on a phone.
 */
const Chart = ({
  W,
  H,
  L,
  class: cls,
  plot: { p, spent, end },
}: {
  W: number;
  H: number;
  L: number;
  class: string;
  plot: Plot;
}) => {
  const R = W - 16;
  const B = H - 34;
  const x = (t: number) => L + (t / WINDOW) * (R - L);
  const y = (pct: number) => B - (pct / 100) * (B - T);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class={cls} aria-hidden="true">
      <rect
        x={L}
        y={y(60)}
        width={R - L}
        height={y(0) - y(60)}
        class="fill-text opacity-[0.04]"
      />
      {[0, 60, 100].map((v) => (
        <g key={v}>
          <line
            x1={L}
            x2={R}
            y1={y(v)}
            y2={y(v)}
            class={v === 100 ? "stroke-danger" : "stroke-line"}
            stroke-dasharray={v === 100 ? "4 4" : undefined}
          />
          <text
            x={L - 6}
            y={y(v) + 4}
            text-anchor="end"
            class="fill-muted font-mono text-[10px]"
          >
            {v}%
          </text>
        </g>
      ))}
      {[0, 1, 2, 3, 4, 5].map((h) => (
        <text
          key={h}
          x={x(h * 3600)}
          y={H - 14}
          text-anchor="middle"
          class="fill-muted font-mono text-[10px]"
        >
          {h}h
        </text>
      ))}
      <line x1={R} x2={R} y1={T - 6} y2={B} class="stroke-muted" />
      <text
        x={R - 4}
        y={T - 8}
        text-anchor="end"
        class="fill-muted text-[11px]"
      >
        reset
      </text>

      {p >= 100 && (
        <rect
          x={x(spent)}
          y={T}
          width={R - x(spent)}
          height={B - T}
          class="fill-danger opacity-10"
        />
      )}

      <line
        x1={x(spent)}
        x2={x(spent)}
        y1={T}
        y2={B}
        class="stroke-muted"
        stroke-dasharray="2 3"
      />
      <text
        x={x(spent) + (spent > WINDOW * 0.85 ? -6 : 6)}
        y={B - 6}
        text-anchor={spent > WINDOW * 0.85 ? "end" : "start"}
        class="fill-muted text-[11px]"
      >
        now
      </text>

      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(spent)}
        y2={y(Math.min(p, 100))}
        class="stroke-text"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      {end && (
        <>
          <line
            x1={x(spent)}
            y1={y(p)}
            x2={x(end.t)}
            y2={y(end.pct)}
            class="stroke-accent"
            stroke-width="2"
            stroke-dasharray="5 4"
          />
          <circle
            cx={x(end.t)}
            cy={y(end.pct)}
            r={4}
            class={end.pct >= 100 ? "fill-danger" : "fill-accent"}
          />
        </>
      )}
      <circle cx={x(spent)} cy={y(Math.min(p, 100))} r={5} class="fill-text" />
      {/* Last, with a halo: on the narrow chart the burn line crosses it. */}
      <text
        x={L + 8}
        y={y(60) + 16}
        stroke-width="4"
        stroke-linejoin="round"
        class="fill-muted stroke-surface text-[11px] [paint-order:stroke]"
      >
        under 60%: not shown
      </text>
    </svg>
  );
};

export const Forecast = component$(() => {
  const used = useSignal(72);
  const left = useSignal(130);

  const resetsIn = left.value * 60;
  const spent = WINDOW - resetsIn;
  const p = used.value;
  const state = quiet({
    fiveHour: { used: p, resetsIn },
    week: { used: 20, resetsIn: 400001 },
  });
  const chip = chips(state)[0];

  // The script's pace: average burn since the window opened, extrapolated.
  const rate = spent > 0 ? p / spent : 0;
  const hits = rate > 0 ? 100 / rate : Infinity;
  const end =
    p >= 100 || rate === 0
      ? null
      : hits <= WINDOW
        ? { t: hits, pct: 100 }
        : { t: WINDOW, pct: rate * WINDOW };

  const verdict = !chip
    ? "Under 60%: it gets no space on the line at all."
    : chip.blocking
      ? `Spent. Marked ! with the time until it lifts: ${dur(resetsIn) || "now"}.`
      : spent <= 0
        ? "The window has only just opened, so there is no pace to go on yet."
        : chip.eta
          ? `At this pace it hits 100% in ${dur(chip.eta)}, before the reset in ${dur(resetsIn)}. That is worth saying.`
          : `At this pace it ends the window near ${Math.round(end?.pct ?? p)}%. The reset comes first, so there is nothing to say.`;
  const plot = { p, spent, end };

  return (
    <div>
      <Chart
        W={300}
        H={190}
        L={34}
        class="block w-full sm:hidden"
        plot={plot}
      />
      <Chart
        W={600}
        H={250}
        L={40}
        class="hidden w-full sm:block"
        plot={plot}
      />

      <p class="mt-3 mb-4 min-h-[2lh] text-sm" aria-live="polite">
        {verdict}
      </p>

      <Terminal
        lines={render(state).lines}
        label="What the status line shows"
      />

      <div class="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Range
          label="5-hour window used"
          value={used}
          min={0}
          max={100}
          text={`${p}%`}
        />
        <Range
          label="Resets in"
          value={left}
          min={0}
          max={300}
          step={5}
          text={dur(resetsIn) || "now"}
        />
      </div>
    </div>
  );
});
