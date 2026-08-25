/**
 * Low-poly triangle mesh, generated at build time. Run: `pnpm run mesh`
 *
 * Writes src/components/terminal/mesh.ts — a generated module holding the
 * backdrop the terminal's glass panel refracts. Glass only reads as glass when
 * there is structure behind it; over a flat colour `backdrop-filter` has
 * nothing to do.
 *
 * ---------------------------------------------------------------------------
 * WHY A MODULE AND NOT public/mesh.svg
 *
 * It lives next to the component that uses it, so the backdrop is part of the
 * terminal rather than a loose asset referenced by URL that nothing links back
 * to. It also costs no extra request.
 *
 * WHY A SMALL RASTER RATHER THAN THE SVG ITSELF
 *
 * Because it is only ever seen through a 22px backdrop blur. Resolution is
 * irrelevant by construction — the blur destroys every detail the vectors
 * would preserve — so shipping 26 kB of path data to be immediately smeared is
 * paying for precision that is thrown away. A small JPEG blurs identically at a
 * fraction of the bytes.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * WHY NOT TRIANGLIFY, WHICH IS THE OBVIOUS ANSWER
 *
 * Two reasons, and the first is disqualifying:
 *
 *   1. trianglify@4.1.1 hard-depends on `canvas` — node-canvas, a NATIVE module
 *      that needs a cairo/pango toolchain and a postinstall script to build.
 *      This repo blocks dependency postinstall scripts (an empty
 *      `pnpm.onlyBuiltDependencies`), because a postinstall runs arbitrary code
 *      from a transitive dependency at install time. Adding trianglify means
 *      punching a hole in that for a decoration.
 *
 *   2. It was last published in 2020 and is unmaintained.
 *
 * And the geometry is not the hard part. Trianglify's default pattern is a
 * jittered point grid with each cell split into two triangles — which is what
 * this does, in one file, with no dependency and no native build.
 *
 * WHY BUILD TIME AND NOT RUNTIME
 *
 * The terminal's whole selling point is that the page fetches zero JavaScript
 * until someone interacts. Generating this in the browser would spend a canvas,
 * a library and a paint on decoration, on load — and a <canvas> cannot be
 * painted without running JS at all, which is why that route is closed here
 * regardless of how neat it would be. Baked at build time, it renders before
 * hydration and costs nothing.
 *
 * DETERMINISM IS A REPO INVARIANT, not a preference. SSG runs at build time, so
 * `Math.random()` would rewrite the file on every build and churn the diff. The
 * PRNG below is seeded, so the same seed always yields the same bytes.
 * ---------------------------------------------------------------------------
 */

import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src", "components", "terminal");
const OUT = join(OUT_DIR, "mesh.ts");
/*
 * Small on purpose: the blur is 22px, so anything beyond a few hundred pixels
 * is detail nobody can see. Rendered at 2x this and downscaled, so the facet
 * edges are smooth rather than aliased before the blur even touches them.
 */
const RASTER_W = 440;

/** Mulberry32 — small, fast, and enough for positional jitter. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260825;
const W = 1200;
const H = 700;
const CELL = 92; // Triangle scale. Smaller = busier; this reads as facets.
const JITTER = 0.62; // Fraction of a cell a vertex may wander. 0 = flat grid.

/**
 * The ember ramp, same family as the page gradient so the terminal does not
 * look pasted on from another site. Sampled along a diagonal, so the mesh has
 * a direction rather than being noise.
 *
 * Deliberately DIM. The first version used the page's full-strength ember and
 * the result was a bright slab: it read as the subject rather than as something
 * the glass refracts, and it lifted the panel enough to threaten the contrast of
 * the terminal text sitting on it. A backdrop has to lose that fight.
 */
const RAMP = [
  [0.0, [124, 66, 36]], // muted amber
  [0.32, [104, 44, 26]], // ember, dimmed
  [0.62, [78, 30, 24]], // deep red
  [0.84, [50, 22, 36]], // bruise
  [1.0, [20, 14, 13]], // near-black
];

const lerp = (a, b, t) => a + (b - a) * t;

function sample(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    const [p0, c0] = RAMP[i - 1];
    const [p1, c1] = RAMP[i];
    if (x <= p1) {
      const k = (x - p0) / (p1 - p0);
      return c0.map((c, j) => Math.round(lerp(c, c1[j], k)));
    }
  }
  return RAMP.at(-1)[1];
}

const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

// --- Build the jittered lattice -------------------------------------------

const rand = prng(SEED);
const cols = Math.ceil(W / CELL) + 2;
const rows = Math.ceil(H / CELL) + 2;

/**
 * One vertex per lattice node, displaced within its cell. Edge nodes are pushed
 * a full cell beyond the viewBox so no triangle edge lands on the border — a
 * seam along the frame is the giveaway that a mesh was tiled.
 */
const pts = [];
for (let r = 0; r < rows; r++) {
  const row = [];
  for (let c = 0; c < cols; c++) {
    row.push([
      (c - 1) * CELL + (rand() - 0.5) * CELL * JITTER,
      (r - 1) * CELL + (rand() - 0.5) * CELL * JITTER,
    ]);
  }
  pts.push(row);
}

const tris = [];
for (let r = 0; r < rows - 1; r++) {
  for (let c = 0; c < cols - 1; c++) {
    const a = pts[r][c];
    const b = pts[r][c + 1];
    const d = pts[r + 1][c];
    const e = pts[r + 1][c + 1];
    // Split each cell on the same diagonal, as trianglify does.
    tris.push([a, b, d], [b, e, d]);
  }
}

const paths = tris
  .map((t) => {
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
    const cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
    // Diagonal position drives the ramp, so colour flows corner to corner.
    const pos = (cx / W) * 0.55 + (cy / H) * 0.45;
    const fill = hex(sample(pos));
    const d = `M${t.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
    /*
     * A hairline stroke in the fill colour, not `shape-rendering: crispEdges`.
     * Adjacent antialiased triangles otherwise leave sub-pixel seams that read
     * as a grid of pale lines — the classic low-poly artefact.
     */
    return `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="1"/>`;
  })
  .join("");

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
  `preserveAspectRatio="xMidYMid slice" role="presentation">` +
  paths +
  `</svg>\n`;

// --- Rasterise via headless Chrome, same rationale as the icons and og card:
// no image library is assumed present, and adding one would need review.

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome)
  throw new Error(
    `No Chromium-based browser found:\n  ${CHROMES.join("\n  ")}`,
  );

const tmp = mkdtempSync(join(tmpdir(), "mesh-"));
const rasterH = Math.round((RASTER_W * H) / W);
try {
  writeFileSync(join(tmp, "m.svg"), svg);
  writeFileSync(
    join(tmp, "p.html"),
    `<!doctype html><meta charset=utf-8>` +
      `<style>html,body{margin:0}img{display:block;width:${RASTER_W * 2}px;height:${rasterH * 2}px}</style>` +
      `<img src="m.svg">`,
  );
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${RASTER_W * 2},${rasterH * 2}`,
      `--screenshot=${join(tmp, "m.png")}`,
      `file://${join(tmp, "p.html")}`,
    ],
    { stdio: "ignore" },
  );
  // Downscale then JPEG: sips does both, and no image library is needed.
  execFileSync(
    "sips",
    [
      "-z",
      String(rasterH),
      String(RASTER_W),
      join(tmp, "m.png"),
      "--out",
      join(tmp, "s.png"),
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "sips",
    [
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "72",
      join(tmp, "s.png"),
      "--out",
      join(tmp, "m.jpg"),
    ],
    { stdio: "ignore" },
  );

  const jpg = readFileSync(join(tmp, "m.jpg"));
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8)
    throw new Error("sips did not produce a JPEG.");

  const dataUri = `data:image/jpeg;base64,${jpg.toString("base64")}`;
  const module =
    `// GENERATED by scripts/make-mesh.mjs — do not edit. Run \`pnpm run mesh\`.\n` +
    `//\n` +
    `// A seeded low-poly triangle mesh, rasterised small because it is only\n` +
    `// ever seen through the terminal's backdrop blur. ${tris.length} triangles,\n` +
    `// seed ${SEED}, ${RASTER_W}x${rasterH}, ${jpg.length} B before base64.\n` +
    `export const MESH_BACKDROP =\n  "${dataUri}";\n`;

  const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
  writeFileSync(OUT, module);

  console.log(
    `wrote src/components/terminal/mesh.ts\n` +
      `  ${tris.length} triangles, seed ${SEED}\n` +
      `  svg ${svg.length} B  ->  jpeg ${jpg.length} B (${RASTER_W}x${rasterH})\n` +
      `  module ${module.length} B`,
  );
  if (prev !== null) {
    console.log(
      prev === module
        ? "  byte-identical to the previous run (deterministic)"
        : "  CHANGED — expected only if seed or geometry constants moved",
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
