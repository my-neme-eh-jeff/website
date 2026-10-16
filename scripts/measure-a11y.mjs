/**
 * Accessibility measurements a browser has to make. Run (after `pnpm run build`):
 *
 *   node scripts/measure-a11y.mjs              axe-core on every page
 *   node scripts/measure-a11y.mjs --contrast   also text against rendered pixels
 *
 *   --only <ids>     palette-mode pairs, e.g. wada-light,amber-dark
 *   --widths <list>  default 320,1280 for axe and 390,1280 for --contrast
 *   --dist <dir>     measure another build
 *
 * Exits 1 if anything fails. Neither pass is in `pnpm run verify`, which has no
 * browser; this is what the a11y-ui skill's "what automation does NOT check"
 * points at.
 *
 * AXE runs with the field and grain hidden. Over them it cannot find a
 * background colour and files almost every text node as "incomplete", which
 * hides the real findings; flat, the ground is --sem-bg or a surface.
 *
 * CONTRAST is the half axe cannot do: the field is a gradient, so the ground
 * under each line of text is whatever the wash is doing there. It reads each
 * text run's colour, screenshots the viewport with all text made transparent,
 * and compares against the median pixel under the run. Slow: it scrolls every
 * page in every palette.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTES, modesOf } from "../src/content/palettes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8261;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const CONTRAST = process.argv.includes("--contrast");
const DIST = resolve(arg("dist", join(ROOT, "dist")));
const ONLY = arg("only", "")?.split(",").filter(Boolean);
const widths = (fallback) => arg("widths", fallback).split(",").map(Number);

/* puppeteer-core and axe-core both arrive with lighthouse. */
function fromStore(prefix, entry) {
  const store = join(ROOT, "node_modules", ".pnpm");
  const hit = readdirSync(store).find((d) => d.startsWith(prefix));
  if (!hit) throw new Error(`${prefix}* not found under node_modules/.pnpm`);
  return join(store, hit, "node_modules", entry);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  "/",
  "/blog/",
  ...readdirSync(join(DIST, "blog"), { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && existsSync(join(DIST, "blog", d.name, "index.html")),
    )
    .map((d) => `/blog/${d.name}/`),
  "/privacy/",
  "/404.html",
];

const COMBOS = PALETTES.flatMap((p) =>
  modesOf(p).map((m) => ({ id: `${p.id}-${m}`, palette: p.id, mode: m })),
).filter((c) => !ONLY?.length || ONLY.includes(c.id));

async function open(browser, combo, width, path) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: combo.mode },
  ]);
  await page.evaluateOnNewDocument(
    (p, m) => {
      localStorage.setItem("theme:name", p);
      localStorage.setItem("theme:mode", m);
    },
    combo.palette,
    combo.mode,
  );
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await sleep(1500);
  return page;
}

async function axePass(browser) {
  const source = readFileSync(
    fromStore("axe-core@", "axe-core/axe.min.js"),
    "utf8",
  );
  const found = new Map();
  for (const combo of COMBOS)
    for (const width of widths("320,1280"))
      for (const path of PAGES) {
        const page = await open(browser, combo, width, path);
        await page.addStyleTag({
          content: ".field,.grain-page{display:none!important}",
        });
        await page.addScriptTag({ content: source });
        const violations = await page.evaluate(async () => {
          const r = await window.axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            },
          });
          return r.violations.map((v) => ({
            id: v.id,
            help: v.help,
            targets: v.nodes.map((n) => n.target.join(" ")),
          }));
        });
        for (const v of violations) {
          const seen = found.get(v.id) ?? { help: v.help, where: new Set() };
          for (const t of v.targets)
            seen.where.add(`${combo.id} ${width} ${path}  ${t}`);
          found.set(v.id, seen);
        }
        await page.close();
      }
  console.log(
    `\naxe: ${PAGES.length} pages x ${COMBOS.length} palette modes x ` +
      `${widths("320,1280").length} widths`,
  );
  for (const [id, v] of found) {
    console.log(`  FAIL  ${id}: ${v.help} (${v.where.size})`);
    for (const w of [...v.where].slice(0, 8)) console.log(`        ${w}`);
  }
  if (!found.size) console.log("  ok    no violations");
  return found.size === 0;
}

/** Runs of visible text in the viewport, with their colour and box. */
function textRuns() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (c) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    return [...cx.getImageData(0, 0, 1, 1).data];
  };
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) {
    const el = n.parentElement;
    if (!/\S/.test(n.data) || !el) continue;
    if (el.closest("[aria-hidden=true],.sr-only,[hidden],:disabled")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible") continue;
    let opacity = 1;
    for (let a = el; a; a = a.parentElement)
      opacity *= +getComputedStyle(a).opacity;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      // Clip to the viewport and to every ancestor that clips its overflow,
      // so text scrolled out of a box is not measured against the page.
      let [x0, y0, x1, y1] = [r.left, r.top, r.right, r.bottom];
      x0 = Math.max(x0, 0);
      y0 = Math.max(y0, 0);
      x1 = Math.min(x1, innerWidth);
      y1 = Math.min(y1, innerHeight);
      for (
        let a = el.parentElement;
        a && a !== document.body;
        a = a.parentElement
      ) {
        const o = getComputedStyle(a);
        if (o.overflowX === "visible" && o.overflowY === "visible") continue;
        const b = a.getBoundingClientRect();
        [x0, y0, x1, y1] = [
          Math.max(x0, b.left),
          Math.max(y0, b.top),
          Math.min(x1, b.right),
          Math.min(y1, b.bottom),
        ];
      }
      if (x1 - x0 < 3 || y1 - y0 < 5) continue;
      const hit = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el)))
        continue;
      const px = parseFloat(cs.fontSize);
      out.push({
        box: [x0, y0, x1, y1].map(Math.round),
        fg: rgba(el instanceof SVGElement ? cs.fill : cs.color),
        opacity,
        large: px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700),
        text: n.data.trim().slice(0, 40),
      });
    }
  }
  return out;
}

const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

async function contrastPass(browser) {
  const sharp = (await import(fromStore("sharp@", "sharp/lib/index.js")))
    .default;
  const worst = new Map();
  let runs = 0;
  for (const combo of COMBOS)
    for (const width of widths("390,1280"))
      for (const path of PAGES) {
        const page = await open(browser, combo, width, path);
        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        for (let y = 0; y < height; y += 700) {
          await page.evaluate((y) => scrollTo(0, y), y);
          await sleep(200);
          const found = await page.evaluate(textRuns);
          if (!found.length) continue;
          const hide = await page.addStyleTag({
            content:
              "*,*::before,*::after{color:transparent!important;" +
              "-webkit-text-fill-color:transparent!important;" +
              "text-shadow:none!important;text-decoration-color:transparent!important}" +
              "svg text,svg tspan{fill:transparent!important;stroke:transparent!important}",
          });
          await sleep(100);
          const shot = await page.screenshot({ type: "png" });
          await hide.evaluate((n) => n.remove());
          const { data, info } = await sharp(shot)
            .raw()
            .toBuffer({ resolveWithObject: true });
          for (const t of found) {
            const px = [];
            const [x0, y0, x1, y1] = t.box;
            for (let yy = y0; yy < y1; yy++)
              for (let xx = x0; xx < x1; xx++) {
                const i = (yy * info.width + xx) * info.channels;
                px.push([data[i], data[i + 1], data[i + 2]]);
              }
            // Median, so the grain's speckle does not decide the result.
            px.sort((a, b) => lum(a) - lum(b));
            const ground = px[Math.floor(px.length / 2)];
            const a = (t.fg[3] / 255) * t.opacity;
            const fg = ground.map((g, i) => t.fg[i] * a + g * (1 - a));
            const r = ratio(fg, ground);
            runs++;
            const bar = t.large ? 3 : 4.5;
            const key = `${combo.id} ${width}`;
            if (r < bar && r < (worst.get(key)?.r ?? Infinity))
              worst.set(key, { r, text: t.text, path, ground });
          }
        }
        await page.close();
      }
  console.log(
    `\ncontrast: ${runs} text runs against rendered pixels, worst per ` +
      `palette mode and width`,
  );
  for (const combo of COMBOS)
    for (const width of widths("390,1280")) {
      const w = worst.get(`${combo.id} ${width}`);
      console.log(
        w
          ? `  FAIL  ${combo.id} ${width}: ${w.r.toFixed(2)}:1 "${w.text}" ` +
              `on ${w.path}, ground rgb(${w.ground.join(" ")})`
          : `  ok    ${combo.id} ${width}`,
      );
    }
  return worst.size === 0;
}

const server = spawn(
  "python3",
  [
    "-m",
    "http.server",
    String(PORT),
    "--bind",
    "127.0.0.1",
    "--directory",
    DIST,
  ],
  { stdio: "ignore" },
);
let ok = true;
try {
  await waitFor(`${BASE}/`);
  const pp = (
    await import(
      fromStore(
        "puppeteer-core@",
        "puppeteer-core/lib/puppeteer/puppeteer-core.js",
      )
    )
  ).default;
  const browser = await pp.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--hide-scrollbars", "--no-first-run", "--force-color-profile=srgb"],
  });
  try {
    ok = (await axePass(browser)) && ok;
    if (CONTRAST) ok = (await contrastPass(browser)) && ok;
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
process.exit(ok ? 0 : 1);
