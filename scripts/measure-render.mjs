/**
 * Rendered-pixel measurements. Run: `node scripts/measure-render.mjs`
 * (after `pnpm run build`)
 *
 *   1. Grain: how visible the film grain is. Its opacity can't say: overlay
 *      compresses toward the backdrop at both ends, so on a near-black or
 *      near-white ground even opacity 1 can be invisible.
 *   2. Field: whether the field's drift moves the ground under the text
 *      column enough to change body-text contrast.
 *
 * The grain metric is the mean absolute luma difference between horizontally
 * adjacent pixels over a flat region, which separates high-frequency noise
 * from the slow gradient. The page renders with the layer on and forced off,
 * and the difference is the grain, since gradient dithering also registers.
 * It screenshots the built dist/, so there is no second copy of the recipe.
 *
 * Rough guide: below ~2 is invisible, 6-10 reads as film grain, above ~20 as
 * a broken display. A light ground may sit a little higher (Weber's law).
 */

import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DEFAULT_PALETTE, PALETTES } from "../src/content/palettes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = 8241;
const W = 1440;
const H = 900;

/** Must hold no text: glyph edges would swamp the neighbour delta. */
const REGION = { x0: 40, y0: 180, x1: 460, y1: 760 };

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const work = join(tmpdir(), `grain-${process.pid}`);

function findSharp() {
  // sharp is transitive; resolved from the pnpm store, not a dependency.
  const store = join(ROOT, "node_modules", ".pnpm");
  const hit = readdirSync(store).find((d) => d.startsWith("sharp@"));
  if (!hit) throw new Error("sharp not found under node_modules/.pnpm");
  return join(store, hit, "node_modules", "sharp", "lib", "index.js");
}

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Read the body: left unread, Node 24's fetch asserts when python's
      // server closes the socket under it, and the run dies.
      const res = await fetch(url);
      await res.arrayBuffer();
      if (res.ok) return;
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
      // Otherwise the display profile converts the screenshot and shifts the
      // low-amplitude noise being measured.
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

/** Should be the ground body text sits on, at 1440 wide. */
const TEXT_REGION = { x0: 620, y0: 200, x1: 1400, y1: 820 };

/** Median, not mean: glyphs are a minority, so it lands on the ground. */
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
 * Dark-mode text colours. Headless Chrome follows the OS appearance, so on a
 * machine in light mode the contrast columns use the wrong pair.
 */
const darkOf = PALETTES.find((x) => x.id === DEFAULT_PALETTE).dark;
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const TEXT_ON_DARK = rgbOf(darkOf.text);
const MUTED_ON_DARK = rgbOf(darkOf.muted);

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
 * Paused at a negative delay, so the capture lands on an exact keyframe
 * progress rather than wherever the clock happens to be.
 */
const freezeAt = (pct) =>
  `\n.field{animation:field-shift 10s linear both!important;` +
  `animation-timeline:auto!important;animation-delay:${-(10 * pct) / 100}s!important;` +
  `animation-play-state:paused!important}\n`;

// Into the page: the stylesheet is inlined, so editing dist/assets changes
// nothing.
function inject(dir, cssText) {
  const page = join(dir, "index.html");
  const html = readFileSync(page, "utf8");
  if (!html.includes("</head>")) throw new Error(`no </head> in ${page}`);
  writeFileSync(
    page,
    html.replace("</head>", `<style>${cssText}</style></head>`),
  );
}

async function main() {
  const sharp = (await import(findSharp())).default;

  rmSync(work, { recursive: true, force: true });
  cpSync(DIST, work, { recursive: true });
  inject(work, ".grain-page{display:none!important}");

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

    // A reading, not a gate: it depends on the machine's light/dark setting.
    if (visible < 2) {
      console.log(
        "\n  Below 2 — that is invisible. See the note on grain-page in src/global.css.",
      );
    } else if (Math.abs(haze) > 2) {
      console.log(
        "\n  The layer is shifting mean brightness, not just adding texture.",
      );
    }

    console.log(
      `\nField morph, ground under the text column ${JSON.stringify(TEXT_REGION)}`,
    );
    console.log("  at    ground rgb          luma    body text   muted text");

    const seen = [];
    for (const pct of [0, 55, 100]) {
      const dir = join(work, `f${pct}`);
      rmSync(dir, { recursive: true, force: true });
      cpSync(DIST, dir, { recursive: true });
      inject(dir, freezeAt(pct));
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

    // WCAG AA body text. Muted is the lowest-contrast text, so it fails first.
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
