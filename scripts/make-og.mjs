/**
 * Social card. Run: `pnpm run og`
 *
 * Renders public/og/home.jpg at 1200x630 — the size every platform crops from.
 *
 * JPEG, not PNG. The card is a smooth gradient, which is the worst case for
 * PNG's lossless compression: the first version came out at 882 kB. The same
 * image as JPEG is an order of magnitude smaller with no visible difference,
 * and a social preview that a scraper has to fetch before it can render the
 * card is exactly where size matters.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * Without it the site emits `twitter:card: summary` and no og:image, so a link
 * shared to LinkedIn, X or Slack renders as a bare text row. That is the single
 * most-seen surface of a portfolio that people share, and it was blank.
 *
 * WHY NOT REFERENCE ONE THAT DOES NOT EXIST
 *
 * `src/content/seo.ts` deliberately emits no image tags when `profile.ogImage`
 * is empty, because a referenced-but-404 og:image renders an EMPTY card, which
 * is worse than none — the platform reserves the space and shows nothing. So
 * this script has to run and the file has to be committed before ogImage is set.
 *
 * WHY HEADLESS CHROME
 *
 * Same reason as the icons: no SVG or image CLI is assumed present, and adding
 * one as a dependency needs review under the repo's dependency policy. Chrome
 * is already here, and it renders the exact CSS the site uses — the gradient
 * and the grain are the same declarations, not an approximation of them.
 *
 * Fonts are referenced from the built output rather than by family name. A
 * headless Chrome has no idea what "Hanken Grotesk" is; without the @font-face
 * it silently falls back to Helvetica and the card is off-brand in a way that
 * is easy to miss.
 * ---------------------------------------------------------------------------
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

const fontDir = join(ROOT, "public", "fonts");
const sans = "hanken-grotesk-v12-latin.woff2";
const mono = "fira-mono-v16-400-latin.woff2";
for (const f of [sans, mono]) {
  if (!existsSync(join(fontDir, f))) {
    throw new Error(`Missing ${f}. Run \`pnpm run fonts\` first.`);
  }
}

/*
 * Fonts inlined as data URIs. file:// + @font-face with a relative path is
 * blocked by Chrome's local-file CORS rules, and the failure is silent — the
 * card renders in Helvetica and looks almost right.
 */
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
    background-color: #12110d;
    background-image:
      radial-gradient(70rem 55rem at 8% 12%, color-mix(in oklab, #ff8a3d 30%, transparent), transparent 66%),
      radial-gradient(55rem 48rem at 26% 68%, color-mix(in oklab, #d0341f 24%, transparent), transparent 64%),
      radial-gradient(50rem 44rem at 4% 96%, color-mix(in oklab, oklch(52% 0.19 318) 22%, transparent), transparent 62%),
      radial-gradient(44rem 40rem at 34% 4%, color-mix(in oklab, oklch(72% 0.15 78) 16%, transparent), transparent 60%);
    font-family: "HG", sans-serif;
    color: #f2f0e9;
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
   * It drifted because the grain lives in two places and only one of them is
   * checked. Nothing here can catch it: this file renders through headless
   * Chrome to a JPEG, so pnpm run verify sees a picture, not a stylesheet.
   * If you change the grain in global.css, change it here too and re-run
   * pnpm run og. The reasoning behind each part of the recipe — forced
   * alpha, doubled contrast, why 0.75 and not 1.0 — is documented once, there.
   */
  .grain {
    position: absolute; inset: 0; mix-blend-mode: overlay; opacity: 0.38;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n' color-interpolation-filters='sRGB'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='2' intercept='-0.5'/%3E%3CfeFuncG type='linear' slope='2' intercept='-0.5'/%3E%3CfeFuncB type='linear' slope='2' intercept='-0.5'/%3E%3CfeFuncA type='discrete' tableValues='1'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  /* Content sits right, matching the page's own composition. */
  .wrap {
    position: relative; height: 100%;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 76px 0 460px;
  }
  .eyebrow {
    font-family: "FM", monospace; font-size: 18px; letter-spacing: 0.12em;
    text-transform: uppercase; color: rgb(242 240 233 / 0.62); margin-bottom: 20px;
  }
  h1 {
    font-size: 82px; line-height: 1.02; letter-spacing: -0.03em;
    font-weight: 500; text-wrap: balance;
  }
  p {
    margin-top: 26px; font-size: 27px; line-height: 1.38;
    color: rgb(242 240 233 / 0.74); max-width: 30ch;
  }
  .domain {
    position: absolute; right: 76px; bottom: 48px;
    font-family: "FM", monospace; font-size: 19px;
    color: rgb(242 240 233 / 0.5);
  }
</style>
<div class="grain"></div>
<div class="wrap">
  <div class="eyebrow">${esc(jobTitle)} · ${esc(city)}</div>
  <h1>${esc(name)}</h1>
  <p>${esc(tagline)}</p>
</div>
<div class="domain">amannambisan.com</div>
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
// PNG dimensions live at bytes 16-24, big-endian. Check before converting, so a
// wrong-sized render fails here rather than shipping a cropped card.
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);
if (w !== 1200 || h !== 630) {
  throw new Error(`Rendered ${w}x${h}, expected 1200x630.`);
}

// macOS `sips`, so no image library is needed — same reasoning as make-icons.
execFileSync(
  "sips",
  ["-s", "format", "jpeg", "-s", "formatOptions", "82", OUT_PNG, "--out", OUT],
  { stdio: "ignore" },
);
rmSync(OUT_PNG, { force: true });
rmSync(htmlPath, { force: true });

const jpg = readFileSync(OUT);
// JPEG must start with the SOI marker, or sips wrote something unexpected.
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
