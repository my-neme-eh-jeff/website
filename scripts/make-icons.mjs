/**
 * Icon pipeline. Run: `pnpm run icons`
 *
 * Regenerates public/favicon.svg, public/favicon.ico and
 * public/apple-touch-icon.png from the geometry below. Never hand-edit those
 * outputs: edit the geometry and re-run.
 *
 * METHOD
 *
 * 1. Judge small icons at a true 1x pixel grid; a 3x screenshot flatters them.
 *    Screenshot at scale factor 1, view it with `image-rendering: pixelated`.
 * 2. Render each ICO size at 4x and downscale by 4. Native 16px fights
 *    Chrome's window floor; one 512px master turns to mush.
 * 3. Style the SVG with plain CSS rules, not custom properties: WebKit can
 *    drop `var()` in a presentation attribute, and `stroke` falls back to none.
 * 4. apple-touch-icon must be full-bleed and opaque: iOS applies its own mask
 *    and renders transparency as black.
 * 5. Chrome's --screenshot background is white unless
 *    --default-background-color=00000000. Check alpha over a garish colour.
 * 6. A .ico may wrap PNGs (Vista+), which spares BMP padding and the AND-mask.
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const INK = "#16150f";
const PAPER = "#fbfaf8";
const CREAM = "#f2f0e9";
const CLAY = "#d97757";

// 32x32 viewBox, tuned on the 1x grid (METHOD 1).
const APEX = { x: 16, y: 6.4 };
const FOOT = 7.4;
const Y_FOOT = 26;
const BAR_Y = 18.4;
const SW = 3.7;
const RX = 7;

const xAt = (y) =>
  APEX.x + ((FOOT - APEX.x) * (y - APEX.y)) / (Y_FOOT - APEX.y);
// Inset the crossbar so its round caps land inside the legs, never outside them.
const BX1 = xAt(BAR_Y) + SW * 0.19;
const BX2 = 2 * APEX.x - BX1;

const markPaths = `<path d="M${FOOT} ${Y_FOOT} L${APEX.x} ${APEX.y} L${(2 * APEX.x - FOOT).toFixed(1)} ${Y_FOOT}"/>
    <path d="M${BX1.toFixed(2)} ${BAR_Y} H${BX2.toFixed(2)}"/>`;

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="A">
  <style>
    /*
     * Plain CSS rules, not custom properties — see METHOD 3 in the header.
     *
     * The theme swap matters because a ${INK} tile disappears into a dark tab
     * strip. Chrome and Firefox honour prefers-color-scheme in a favicon;
     * favicon.ico covers whatever does not.
     */
    .tile { fill: ${INK} }
    .mark { stroke: ${PAPER} }
    @media (prefers-color-scheme: dark) {
      .tile { fill: ${CREAM} }
      .mark { stroke: ${INK} }
    }
  </style>
  <rect class="tile" width="32" height="32" rx="${RX}"/>
  <g class="mark" fill="none" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">
    ${markPaths}
  </g>
</svg>
`;

/** Fixed colours for favicon.ico: no media query survives rasterisation. */
const icoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${RX}" fill="${INK}"/>
  <g fill="none" stroke="${PAPER}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">
    ${markPaths}
  </g>
</svg>
`;

const touchSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${INK}"/>
  <g fill="none" stroke="${PAPER}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">
    ${markPaths}
  </g>
</svg>
`;

/**
 * An alternate mark: the A as a 3-node DAG, the apex circle its source node.
 * Reads from about 64px up; too fine for a favicon (METHOD 1).
 */
export function dagMark({ tile = INK, glyph = PAPER, node = CLAY } = {}) {
  const R = 3.2,
    ax = 16,
    ay = 9;
  const edge = (fx, fy) => {
    const dx = fx - ax,
      dy = fy - ay,
      l = Math.hypot(dx, dy);
    return `M${(ax + (dx / l) * R).toFixed(2)} ${(ay + (dy / l) * R).toFixed(2)} L${fx} ${fy}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${RX}" fill="${tile}"/>
  <g fill="none" stroke="${glyph}" stroke-width="2.9" stroke-linecap="round">
    <path d="${edge(8.6, 25)}"/><path d="${edge(23.4, 25)}"/><path d="M12.15 18.4 H19.85"/>
  </g>
  <circle cx="${ax}" cy="${ay}" r="${R}" fill="${node}"/>
</svg>
`;
}

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function findChrome() {
  const hit = CHROMES.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(
      `No Chromium-based browser found. Looked in:\n  ${CHROMES.join("\n  ")}\n` +
        `Headless Chrome is the rasteriser because no SVG CLI tool (rsvg-convert, ` +
        `ImageMagick, Inkscape) is assumed present, and adding one as an npm ` +
        `dependency would need review under the repo's dependency policy.`,
    );
  }
  return hit;
}

function rasterise(chrome, dir, svgName, px, outName) {
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}img{display:block}</style><img src="${svgName}" width="${px}" height="${px}">`;
  const htmlName = `page-${outName}.html`;
  writeFileSync(join(dir, htmlName), html);
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--default-background-color=00000000", // METHOD 5
      "--force-device-scale-factor=1", // METHOD 1
      `--window-size=${px},${px}`,
      `--screenshot=${join(dir, outName)}`,
      `file://${join(dir, htmlName)}`,
    ],
    { stdio: "ignore" },
  );
}

/** macOS `sips`, so no image library is needed. */
const downscale = (from, to, px) =>
  execFileSync("sips", ["-z", String(px), String(px), from, "--out", to], {
    stdio: "ignore",
  });

/** A multi-entry .ico wrapping PNGs (METHOD 6). */
function buildIco(pngs) {
  const HEADER = 6,
    ENTRY = 16;
  const head = Buffer.alloc(HEADER);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // 1 = icon
  head.writeUInt16LE(pngs.length, 4); // image count

  let offset = HEADER + ENTRY * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(ENTRY);
    e.writeUInt8(size === 256 ? 0 : size, 0); // 0 encodes 256 here
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size; 0 = truecolour
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)]);
}

const ICO_SIZES = [16, 32, 48];
const TOUCH_SIZE = 180;

const chrome = findChrome();
const dir = mkdtempSync(join(tmpdir(), "make-icons-"));

try {
  writeFileSync(join(dir, "ico.svg"), icoSvg);
  writeFileSync(join(dir, "touch.svg"), touchSvg);

  const pngs = ICO_SIZES.map((size) => {
    rasterise(chrome, dir, "ico.svg", size * 4, `ico-${size}-4x.png`); // METHOD 2
    downscale(
      join(dir, `ico-${size}-4x.png`),
      join(dir, `ico-${size}.png`),
      size,
    );
    return { size, data: readFileSync(join(dir, `ico-${size}.png`)) };
  });

  rasterise(chrome, dir, "touch.svg", TOUCH_SIZE, "touch.png");

  writeFileSync(join(PUBLIC, "favicon.svg"), faviconSvg);
  writeFileSync(join(PUBLIC, "favicon.ico"), buildIco(pngs));
  writeFileSync(
    join(PUBLIC, "apple-touch-icon.png"),
    readFileSync(join(dir, "touch.png")),
  );

  // No alpha channel (METHOD 4). PNG colour type is byte 25: 2 RGB, 6 RGBA.
  const touch = readFileSync(join(PUBLIC, "apple-touch-icon.png"));
  const colourType = touch[25];
  if (colourType === 6) {
    console.warn(
      "WARNING: apple-touch-icon.png has an alpha channel. iOS renders " +
        "transparency as black. Check the source SVG is full-bleed and opaque.",
    );
  }

  console.log("wrote:");
  console.log(`  public/favicon.svg            ${faviconSvg.length} B`);
  console.log(
    `  public/favicon.ico            ${pngs.reduce((n, p) => n + p.data.length, 0) + 6 + 16 * pngs.length} B  (${ICO_SIZES.join("/")})`,
  );
  console.log(
    `  public/apple-touch-icon.png   ${touch.length} B  (${TOUCH_SIZE}px, colour type ${colourType})`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
