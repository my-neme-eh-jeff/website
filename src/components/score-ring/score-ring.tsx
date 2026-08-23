import { component$ } from "@qwik.dev/core";
import audit from "~/content/audit.json";

/**
 * Lighthouse scores, in the ring form Chrome's own report uses.
 *
 * ---------------------------------------------------------------------------
 * Chrome's exact score palette is NOT used, deliberately.
 *
 * Its green (#0cce6b) measures 2.00:1 on this site's light background and its
 * amber (#ffa400) 1.91:1 — both far under the 3:1 that WCAG 1.4.11 asks of a
 * graphic carrying meaning. Chrome gets away with it inside a dark devtools
 * panel; a page that has to work on cream does not.
 *
 * The colours below clear 3:1 on BOTH grounds, so they are single values
 * rather than a per-theme pair. The score NUMBER is drawn in --sem-text
 * regardless, so the reading never depends on the band colour at all — the
 * ring is reinforcement, not the only signal.
 * ---------------------------------------------------------------------------
 */
const BANDS = [
  { min: 90, color: "#0e8f4c", label: "good" },
  { min: 50, color: "#9a6600", label: "needs work" },
  { min: 0, color: "#c62828", label: "poor" },
] as const;

const band = (score: number) =>
  BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]!;

const LABELS: Record<string, string> = {
  performance: "perf",
  accessibility: "a11y",
  "best-practices": "best",
  seo: "seo",
};

/** r=15 in a 36-box: circumference 2*pi*15, used for the arc dash length. */
const R = 15;
const C = 2 * Math.PI * R;

const Ring = component$<{ name: string; score: number }>(({ name, score }) => {
  const b = band(score);
  return (
    <div class="flex flex-col items-center gap-1">
      <svg
        viewBox="0 0 36 36"
        class="h-9 w-9"
        role="img"
        aria-label={`${name}: ${score} out of 100, ${b.label}`}
      >
        {/* Track. Decorative, so it takes the same line token as every border. */}
        <circle
          cx="18"
          cy="18"
          r={R}
          fill="none"
          stroke="var(--sem-line)"
          stroke-width="2.5"
        />
        {/*
         * The arc. Rotated -90deg so it starts at twelve o'clock, which is
         * where a reader expects a gauge to begin.
         */}
        <circle
          cx="18"
          cy="18"
          r={R}
          fill="none"
          stroke={b.color}
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-dasharray={`${(C * score) / 100} ${C}`}
          transform="rotate(-90 18 18)"
        />
        <text
          x="18"
          y="18"
          text-anchor="middle"
          dominant-baseline="central"
          fill="var(--sem-text)"
          font-size="11"
          font-weight="500"
          font-family="var(--font-mono)"
        >
          {score}
        </text>
      </svg>
      <span class="text-muted font-mono text-[0.625rem] tracking-wide">
        {LABELS[name] ?? name}
      </span>
    </div>
  );
});

/**
 * `compact` drops the provenance paragraph to a single line and tightens the
 * gaps, so the row fits a 13rem rail. The provenance is shortened, never
 * removed — an unlabelled score implies live telemetry, which these are not.
 */
export const ScoreRow = component$<{ compact?: boolean }>(({ compact }) => {
  const entries = Object.entries(audit.scores);

  if (compact) {
    return (
      <div>
        <div class="flex flex-wrap gap-x-3 gap-y-2">
          {entries.map(([name, score]) => (
            <Ring key={name} name={name} score={score as number} />
          ))}
        </div>
        <p class="text-muted mt-3 mb-0 font-mono text-[0.625rem] leading-relaxed">
          Lighthouse {audit.lighthouseVersion}
          <br />
          {audit.commit} · {audit.measuredAt}
        </p>
      </div>
    );
  }

  return (
    <div class="flex flex-wrap items-start gap-x-5 gap-y-3">
      {entries.map(([name, score]) => (
        <Ring key={name} name={name} score={score as number} />
      ))}

      {/*
         Provenance sits next to the numbers on purpose. These are lab scores
         from one machine at one commit, not live field data, and saying so is
         what makes publishing them honest.
      */}
      <p class="text-muted mb-0 max-w-56 self-center font-mono text-[0.625rem] leading-relaxed">
        Lighthouse {audit.lighthouseVersion} · {audit.formFactor}
        <br />
        {audit.commit} · {audit.measuredAt}
      </p>
    </div>
  );
});
