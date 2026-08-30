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
 * free to go down. The sub-100 branch is phrased as a floor so it stays true
 * whatever the spread is.
 */
const headline = (scores: number[]) => {
  const worst = Math.min(...scores);
  const n = scores.length;
  return worst === 100
    ? `This website has a straight 100 in all ${n} Lighthouse categories.`
    : `This website has ${worst} or better in all ${n} Lighthouse categories.`;
};

/**
 * Written out rather than passed to `Intl`: SSG bakes this string into the HTML
 * at build time, so a locale-aware formatter would let the builder's machine
 * decide what the page says. Same reasoning as the seeded geometry rule.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const humanDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month} ${y}` : iso;
};

/**
 * Rings left, claim right. One layout, not two: this used to carry a `compact`
 * prop that stacked the block for the footer, but the footer is the only caller
 * and it wanted the side-by-side form anyway, so the variants had converged
 * into near-duplicates with one of them dead.
 *
 * What is NOT rendered, and why:
 *
 * - The commit hash. "496fc87" is provenance only to someone holding this repo.
 *   It stays in audit.json, where verify-build.mjs asserts it and diffs it
 *   against HEAD — catching scores that describe a build which no longer
 *   exists is a machine's job, not a footer's.
 * - The Lighthouse version. Reproducibility detail, and the reader is not
 *   reproducing. Still in audit.json for whoever is.
 *
 * What survives is the pair a reader can actually weigh: the form factor and
 * the date. Provenance is shortened, never removed — an unlabelled score
 * implies live telemetry, and these are lab runs from one machine on one
 * deploy. The form factor earns its place by making the claim stronger, not
 * merely more honest: mobile is the harder test.
 */
export const ScoreRow = component$(() => {
  const entries = Object.entries(audit.scores);
  const line = headline(entries.map(([, score]) => score as number));

  return (
    <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div class="flex flex-wrap gap-x-3 gap-y-2">
        {entries.map(([name, score]) => (
          <Ring key={name} name={name} score={score as number} />
        ))}
      </div>

      {/* Wraps below the rings rather than beside them once the column narrows. */}
      <div class="max-w-80">
        <p class="text-text mb-0 text-xs">{line}</p>
        <p class="text-muted mt-1 mb-0 font-mono text-[0.625rem]">
          Measured on {audit.formFactor}, {humanDate(audit.measuredAt)}
        </p>
      </div>
    </div>
  );
});
