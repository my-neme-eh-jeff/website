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
 * The sentence a visitor actually reads. Four rings say "100" four times; none
 * of them says what that adds up to, and a reader who does not already know
 * Lighthouse has no way to tell a full ring from a lucky one.
 *
 * Derived from the scores rather than written down. A hardcoded "all 100"
 * would keep congratulating itself straight through a regression, and the only
 * thing that makes publishing these numbers mean anything is that they are
 * free to go down.
 */
const headline = (scores: number[]) => {
  const worst = Math.min(...scores);
  return worst === 100
    ? `A straight 100 in all ${scores.length} Lighthouse categories.`
    : `${scores.filter((s) => s >= 90).length} of ${scores.length} Lighthouse ` +
        `categories at 90 or above, lowest ${worst}.`;
};

/**
 * `compact` stacks the block and tightens the gaps. Its only caller is the page
 * footer (`src/routes/layout.tsx`), which is a full-width column, NOT the 13rem
 * left rail an older version of this comment described — that rail was deleted,
 * see the header of layout.tsx. Compact is about not letting four gauges
 * outweigh a copyright line, not about fitting a narrow container.
 *
 * The commit hash is deliberately NOT rendered in either variant. Provenance is
 * shortened, never removed — an unlabelled score implies live telemetry, which
 * these are not — but "496fc87" is provenance only to someone holding this
 * repo. The version, form factor and date are the parts a visitor can weigh.
 * Staleness is a machine's job anyway: `audit.commit` stays in audit.json and
 * verify-build.mjs diffs it against HEAD to catch scores describing a build
 * that no longer exists.
 */
export const ScoreRow = component$<{ compact?: boolean }>(({ compact }) => {
  const entries = Object.entries(audit.scores);
  const line = headline(entries.map(([, score]) => score as number));

  if (compact) {
    return (
      <div>
        <div class="flex flex-wrap gap-x-3 gap-y-2">
          {entries.map(([name, score]) => (
            <Ring key={name} name={name} score={score as number} />
          ))}
        </div>
        <p class="text-text mt-3 mb-0 text-xs">{line}</p>
        <p class="text-muted mt-1 mb-0 font-mono text-[0.625rem] leading-relaxed">
          Lighthouse {audit.lighthouseVersion} · {audit.measuredAt}
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
         The claim and its provenance sit next to the numbers on purpose. These
         are lab scores from one machine on one deploy, not live field data, and
         saying so is what makes publishing them honest.
      */}
      <div class="max-w-56 self-center">
        <p class="text-text mb-1 text-xs">{line}</p>
        <p class="text-muted mb-0 font-mono text-[0.625rem] leading-relaxed">
          Lighthouse {audit.lighthouseVersion} · {audit.formFactor}
          <br />
          {audit.measuredAt}
        </p>
      </div>
    </div>
  );
});
