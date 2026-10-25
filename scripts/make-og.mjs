/**
 * Social card. Run: `pnpm run og`
 *
 * Renders public/og/home.jpg at 1200x630, the size platforms crop from: an
 * Acme window in the Acme palette, with the home page's desk. JPEG, because
 * grain is PNG's worst case and scrapers fetch the card before they render it.
 * Commit the file before setting `ogImage`: a missing og:image renders an
 * empty card.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GRIDS, rasterize, segments } from "../src/components/desk/desk.ts";
import { PALETTES } from "../src/content/palettes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "og");
const OUT_PNG = join(OUT_DIR, ".home.png");
const OUT = join(OUT_DIR, "home.jpg");

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) {
  throw new Error(
    `No Chromium-based browser found. Looked in:\n  ${CHROMES.join("\n  ")}`,
  );
}

/** Read the real content, so the card can never drift from the page. */
const profileSrc = readFileSync(
  join(ROOT, "src", "content", "profile.ts"),
  "utf8",
);
const pick = (key) => {
  const m = profileSrc.match(
    new RegExp(`${key}:\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`),
  );
  if (!m) throw new Error(`Could not read \`${key}\` from profile.ts`);
  return m[1].replace(/\\"/g, '"');
};

const name = pick("name");
const tagline = pick("tagline");
const jobTitle = pick("jobTitle");
const city = pick("city");

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const acme = PALETTES.find((p) => p.id === "acme")?.light;
if (!acme) throw new Error("No light Acme palette in palettes.ts");

const grid = GRIDS.narrow;
const desk = segments(rasterize(grid.cols, grid.rows))
  .map((s) => s.text)
  .join("")
  .replace(/^(\s*\n)+/, "");

const fontDir = join(ROOT, "public", "fonts");
const sans = "hanken-grotesk-v12-latin.woff2";
const mono = "fira-mono-v16-400-latin.woff2";
for (const f of [sans, mono]) {
  if (!existsSync(join(fontDir, f))) {
    throw new Error(`Missing ${f}. Run \`pnpm run fonts\` first.`);
  }
}

// Data URIs: Chrome's local-file CORS rules block a file:// @font-face, and
// silently, so the card renders in Helvetica and looks almost right.
const dataUri = (f) =>
  `data:font/woff2;base64,${readFileSync(join(fontDir, f)).toString("base64")}`;

const html = `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family: "HG"; src: url("${dataUri(sans)}") format("woff2"); font-weight: 300 800; }
  @font-face { font-family: "FM"; src: url("${dataUri(mono)}") format("woff2"); font-weight: 400; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    position: relative; overflow: hidden;
    background: ${acme.bg};
    font-family: "HG", sans-serif;
    color: ${acme.text};
  }
  /*
   * Grain, and it must stay in step with grain-page in src/global.css.
   *
   * This block previously claimed to be "the same grain as the site" while
   * being a copy of the recipe the site had already abandoned: opacity 0.28,
   * a bare feTurbulence with its noisy alpha channel, and no contrast boost.
   * global.css measured that combination at 1.80 luma levels on the dark wash
   * and 0.013 on light — invisible. The card was shipping it to every link
   * preview for a week after the page stopped using it.
   *
   * It drifted because the grain lives in two places and nothing compared
   * them. \`pnpm run verify\` now does, so a mismatch fails the build instead of
   * the card. Change it here too and re-run \`pnpm run og\`. The reasoning
   * behind each part of the recipe — forced alpha, doubled contrast, why 0.75
   * and not 1.0 — is documented once, there.
   */
  .grain {
    position: absolute; inset: 0; mix-blend-mode: overlay; opacity: 0.38;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n' color-interpolation-filters='sRGB'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='2' intercept='-0.5'/%3E%3CfeFuncG type='linear' slope='2' intercept='-0.5'/%3E%3CfeFuncB type='linear' slope='2' intercept='-0.5'/%3E%3CfeFuncA type='discrete' tableValues='1'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  /* An Acme window: the tag line of commands on top, the scroll bar left. */
  .tag {
    position: absolute; left: 0; right: 0; top: 0; height: 64px;
    display: flex; align-items: center; gap: 18px; padding: 0 28px;
    background: ${acme.surface}; border-bottom: 2px solid #99994c;
    font-family: "FM", monospace; font-size: 21px;
  }
  .box { width: 18px; height: 18px; background: ${acme.accent}; border: 2px solid ${acme.text}; }
  .cmds { color: ${acme.muted}; }
  .scroll { position: absolute; left: 0; top: 66px; bottom: 0; width: 22px; background: #99994c; opacity: 0.55; }
  .thumb {
    position: absolute; left: 0; top: 66px; height: 210px; width: 22px;
    background: ${acme.bg}; border-right: 2px solid #99994c;
  }
  .desk {
    position: absolute; left: 56px; top: calc(64px + (100% - 64px) / 2);
    transform: translateY(-50%); font-family: "FM", monospace;
    font-size: 7.8px; line-height: 1.22; color: ${acme.text}; opacity: 0.85;
  }
  .wrap {
    position: absolute; left: 490px; right: 60px; top: 64px; bottom: 0;
    display: flex; flex-direction: column; justify-content: center;
  }
  .eyebrow {
    font-family: "FM", monospace; font-size: 18px; letter-spacing: 0.12em;
    text-transform: uppercase; color: ${acme.muted}; margin-bottom: 20px;
  }
  h1 {
    font-size: 82px; line-height: 1.02; letter-spacing: -0.03em;
    font-weight: 500; text-wrap: balance;
  }
  p {
    margin-top: 26px; font-size: 27px; line-height: 1.38;
    max-width: 30ch; text-wrap: pretty;
  }
</style>
<div class="grain"></div>
<div class="tag">
  <span class="box"></span><span>/amannambisan.com/</span>
  <span class="cmds">Del Snarf Get | Look</span>
</div>
<div class="scroll"></div><div class="thumb"></div>
<pre class="desk">${esc(desk)}</pre>
<div class="wrap">
  <div class="eyebrow">${esc(jobTitle)} · ${esc(city)}</div>
  <h1>${esc(name)}</h1>
  <p>${esc(tagline).replace(/(^|\s)(\w) /g, "$1$2&nbsp;")}</p>
</div>
`;

mkdirSync(OUT_DIR, { recursive: true });
const htmlPath = join(OUT_DIR, ".card.html");
writeFileSync(htmlPath, html);

execFileSync(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1200,630",
    `--screenshot=${OUT_PNG}`,
    `file://${htmlPath}`,
  ],
  { stdio: "ignore" },
);

const png = readFileSync(OUT_PNG);
// PNG width and height: big-endian, at bytes 16 and 20.
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);
if (w !== 1200 || h !== 630) {
  throw new Error(`Rendered ${w}x${h}, expected 1200x630.`);
}

// macOS `sips`, so no image library is needed.
execFileSync(
  "sips",
  ["-s", "format", "jpeg", "-s", "formatOptions", "82", OUT_PNG, "--out", OUT],
  { stdio: "ignore" },
);
rmSync(OUT_PNG, { force: true });
rmSync(htmlPath, { force: true });

const jpg = readFileSync(OUT);
// A JPEG starts with the SOI marker.
if (jpg[0] !== 0xff || jpg[1] !== 0xd8) {
  throw new Error("Output is not a JPEG.");
}

console.log(
  `wrote public/og/home.jpg  ${w}x${h}  ${jpg.length} B  ` +
    `(PNG was ${png.length} B)`,
);
console.log(
  `\nSet \`ogImage: "/og/home.jpg"\` in src/content/profile.ts to emit it.`,
);
