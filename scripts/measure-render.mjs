/**
 * Rendered-pixel measurements. Run: `node scripts/measure-render.mjs`
 * (after `pnpm run build`)
 *
 * Two questions that only the rasteriser can answer, so neither is checkable
 * by reading the CSS:
 *
 *   1. GRAIN — can you actually see the film grain, and by how much.
 *   2. FIELD — as the scroll morph runs, does the background under the text
 *      column move enough to change body-text contrast.
 *
 * Both exist because a plausible-sounding CSS value was measurably wrong. See
 * each section's note.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GRAIN SECTION EXISTS
 *
 * The grain layer's opacity tells you nothing about whether the grain is
 * visible. It is composited with `mix-blend-mode: overlay`, and overlay is a
 * conditional blend — multiply below mid-grey, screen above — so its output is
 * compressed toward the backdrop at both ends of the range. On a near-black or
 * near-white ground the layer can be at opacity 1 and still be invisible.
 *
 * That is not hypothetical. `grain-page` sat at `opacity: 0.28` with a comment
 * claiming it "makes it actually read", and measured 1.80 luma levels on the
 * dark wash and 0.013 on light. Both are below what an eye can find. The
 * comment was written from the value in the CSS rather than from the pixels.
 *
 * So: measure the pixels.
 *
 * THE METRIC
 *
 * Mean absolute luma difference between horizontally adjacent pixels, over a
 * flat region of the page. Grain is high-frequency by definition, so a
 * neighbour delta isolates it from the gradient underneath, which varies
 * slowly and contributes almost nothing to this number. Plain standard
 * deviation does not work — it is dominated by the wash.
 *
 * Rendered twice, once with the layer and once with it forced off, because the
 * absolute number means little on its own: dithering in the gradient ramp
 * shows up as a neighbour delta too. The DIFFERENCE between the two runs is
 * the grain.
 *
 * WHY IT SCREENSHOTS THE REAL BUILT PAGE
 *
 * An isolated harness gets this wrong in ways that are hard to notice. Two
 * that bit during development, both of which silently produced "no grain"
 * rather than an error:
 *
 *   - `width='100%'` inside a data: URI. The `%` starts a percent-escape, the
 *     SVG never parses, and the layer renders as nothing.
 *   - `url("data:...")` interpolated into a double-quoted HTML style
 *     attribute. The inner quote closes the attribute.
 *
 * Measuring the shipped dist/ avoids inventing a second copy of the recipe
 * that can be wrong on its own.
 *
 * ROUGH GUIDE TO THE NUMBERS
 *
 * Below ~2 is invisible. 6-10 reads as film grain. Above ~20 reads as noise on
 * a broken display. Weber's law applies, so the same delta is less visible on
 * a light ground than a dark one; the light wash is allowed to sit a little
 * higher than the dark one for that reason.
 * ---------------------------------------------------------------------------
 */

import { execFileSync, spawn } from "node:child_process";
import { cpSync, rmSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = 8241;
const W = 1440;
const H = 900;

/**
 * Sample region: left of the viewport, below the header, above the fold.
 * This is the part of the page that is deliberately empty — the artwork —
 * so no glyph edges pollute a metric built on adjacent-pixel differences.
 */
const REGION = { x0: 40, y0: 180, x1: 460, y1: 760 };

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const work = join(tmpdir(), `grain-${process.pid}`);

function findSharp() {
  // sharp arrives transitively; resolve it out of the pnpm store rather than
  // adding a dependency for a script that is not part of the build.
  const store = join(ROOT, "node_modules", ".pnpm");
  const hit = readdirSync(store).find((d) => d.startsWith("sharp@"));
  if (!hit) throw new Error("sharp not found under node_modules/.pnpm");
  return join(store, hit, "node_modules", "sharp", "lib", "index.js");
}

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start on ${url}`);
}

function shoot(url, out) {
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      // Without this the screenshot is converted through the display profile
      // and the low-amplitude noise this script measures shifts under it.
      "--force-color-profile=srgb",
      `--window-size=${W},${H}`,
      "--virtual-time-budget=4000",
      `--screenshot=${out}`,
      url,
    ],
    { stdio: "ignore" },
  );
}

async function grain(sharp, png) {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  let sum = 0;
  let n = 0;
  let adj = 0;
  let adjn = 0;
  const lum = (i) =>
    0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  for (let y = REGION.y0; y < REGION.y1; y++) {
    for (let x = REGION.x0; x < REGION.x1; x++) {
      const i = (y * width + x) * channels;
      sum += lum(i);
      n++;
      if (x + 1 < REGION.x1) {
        adj += Math.abs(lum(i + channels) - lum(i));
        adjn++;
      }
    }
  }
  return { mean: sum / n, delta: adj / adjn };
}

/* --- the field morph ------------------------------------------------------ */

/**
 * The region behind the content column at 1440 wide. The layout is a
 * right-aligned max-w-[52rem] column, so this is the ground body text sits on.
 * If the blob geometry in `field-shift` ever moves right, this is what tells
 * you before a visitor does.
 */
const TEXT_REGION = { x0: 620, y0: 200, x1: 1400, y1: 820 };

/**
 * Median, not mean. Glyphs are a minority of the pixels in this region, so the
 * median lands on the background between them; a mean would be dragged toward
 * the text colour and report a ground that is not there.
 */
async function groundUnderText(sharp, png) {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rows = [];
  for (let y = TEXT_REGION.y0; y < TEXT_REGION.y1; y++) {
    for (let x = TEXT_REGION.x0; x < TEXT_REGION.x1; x++) {
      const i = (y * info.width + x) * info.channels;
      rows.push([
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2],
        data[i],
        data[i + 1],
        data[i + 2],
      ]);
    }
  }
  rows.sort((a, b) => a[0] - b[0]);
  const m = rows[Math.floor(rows.length / 2)];
  return { luma: m[0], rgb: [m[1], m[2], m[3]] };
}

/**
 * Dark-theme text colours, from the `prefers-color-scheme: dark` block in
 * src/global.css: --sem-text is --cream, --sem-muted is #a4a096. Headless
 * Chrome follows the host OS appearance, so if this machine is in light mode
 * the contrast columns below are measured against the wrong pair — the numbers
 * are still a reading of the ground, but the ratios will not mean much.
 */
const TEXT_ON_DARK = [0xf2, 0xf0, 0xe9];
const MUTED_ON_DARK = [0xa4, 0xa0, 0x96];

const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const relLum = ([r, g, b]) =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const x = relLum(a);
  const y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/**
 * Freeze the scroll-driven animation at a chosen progress.
 *
 * `animation-timeline: scroll()` cannot be sampled by a screenshot, because a
 * headless capture has no scroll position to drive it. Swapping the timeline
 * back to `auto` with a paused, negatively-delayed time-based animation lands
 * on exactly the same computed keyframe, and does it deterministically.
 */
const freezeAt = (pct) =>
  `\n.field{animation:field-shift 10s linear both!important;` +
  `animation-timeline:auto!important;animation-delay:${-(10 * pct) / 100}s!important;` +
  `animation-play-state:paused!important}\n`;

async function main() {
  const sharp = (await import(findSharp())).default;

  // A copy of dist with the grain layer forced off, to subtract the gradient's
  // own dithering from the result.
  rmSync(work, { recursive: true, force: true });
  cpSync(DIST, work, { recursive: true });
  const css = readdirSync(join(work, "assets")).find((f) =>
    f.endsWith("style.css"),
  );
  if (!css) throw new Error("no stylesheet in dist/assets");
  appendFileSync(
    join(work, "assets", css),
    "\n.grain-page{display:none!important}\n",
  );

  const on = spawn(
    "python3",
    ["-m", "http.server", String(PORT), "--directory", DIST],
    { stdio: "ignore" },
  );
  const off = spawn(
    "python3",
    ["-m", "http.server", String(PORT + 1), "--directory", work],
    { stdio: "ignore" },
  );

  try {
    await waitFor(`http://localhost:${PORT}/`);
    await waitFor(`http://localhost:${PORT + 1}/`);

    shoot(`http://localhost:${PORT}/`, join(work, "on.png"));
    shoot(`http://localhost:${PORT + 1}/`, join(work, "off.png"));

    const a = await grain(sharp, join(work, "on.png"));
    const b = await grain(sharp, join(work, "off.png"));

    const visible = a.delta - b.delta;
    const haze = a.mean - b.mean;

    console.log(`\nGrain, ${W}x${H}, region ${JSON.stringify(REGION)}`);
    console.log(
      `  layer on   neighbour delta ${a.delta.toFixed(2)}   mean luma ${a.mean.toFixed(2)}`,
    );
    console.log(
      `  layer off  neighbour delta ${b.delta.toFixed(2)}   mean luma ${b.mean.toFixed(2)}`,
    );
    console.log(`\n  grain      ${visible.toFixed(2)} luma levels`);
    console.log(
      `  haze       ${haze >= 0 ? "+" : ""}${haze.toFixed(2)} luma levels (should be near 0)`,
    );

    // Not a hard gate: this measures whichever theme the machine running it is
    // set to, so the absolute figure is not comparable across machines the way
    // a build invariant has to be. It is a reading, and it says so.
    if (visible < 2) {
      console.log(
        "\n  Below 2 — that is invisible. See the note on grain-page in src/global.css.",
      );
    } else if (Math.abs(haze) > 2) {
      console.log(
        "\n  The layer is shifting mean brightness, not just adding texture.",
      );
    }

    /* --- field morph ----------------------------------------------------- */

    console.log(
      `\nField morph, ground under the text column ${JSON.stringify(TEXT_REGION)}`,
    );
    console.log("  at    ground rgb          luma    body text   muted text");

    const seen = [];
    for (const pct of [0, 55, 100]) {
      const dir = join(work, `f${pct}`);
      rmSync(dir, { recursive: true, force: true });
      cpSync(DIST, dir, { recursive: true });
      appendFileSync(join(dir, "assets", css), freezeAt(pct));
      const srv = spawn(
        "python3",
        ["-m", "http.server", String(PORT + 2), "--directory", dir],
        { stdio: "ignore" },
      );
      try {
        await waitFor(`http://localhost:${PORT + 2}/`);
        const png = join(work, `f${pct}.png`);
        shoot(`http://localhost:${PORT + 2}/`, png);
        const g = await groundUnderText(sharp, png);
        const body = ratio(TEXT_ON_DARK, g.rgb);
        const muted = ratio(MUTED_ON_DARK, g.rgb);
        seen.push({ pct, ...g, body, muted });
        console.log(
          `  ${String(pct + "%").padStart(4)}  rgb(${g.rgb.join(" ").padEnd(11)})  ` +
            `${g.luma.toFixed(1).padStart(5)}   ${body.toFixed(2).padStart(6)}:1   ${muted.toFixed(2).padStart(6)}:1`,
        );
      } finally {
        srv.kill();
      }
    }

    const lumaSwing =
      Math.max(...seen.map((s) => s.luma)) -
      Math.min(...seen.map((s) => s.luma));
    const worstMuted = Math.min(...seen.map((s) => s.muted));
    console.log(
      `\n  ground luma swing under text  ${lumaSwing.toFixed(1)} levels`,
    );
    console.log(`  worst muted-text contrast     ${worstMuted.toFixed(2)}:1`);

    // 4.5:1 is WCAG AA for body text. --sem-muted is the smallest, lowest
    // contrast text on the page, so it is the one that would fail first.
    if (worstMuted < 4.5) {
      console.log(
        "\n  BELOW AA. A blob in field-shift has drifted under the text column.",
      );
    }
    console.log("");
  } finally {
    on.kill();
    off.kill();
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
