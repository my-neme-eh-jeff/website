/**
 * Does anything wake Qwik before the reader acts? Run:
 * `node scripts/measure-wake.mjs` (after `pnpm run build`)
 *
 * Reads <html q:container> on every sitemap page, at phone and desktop width,
 * after load and an idle wait, then after scrolling to the bottom in steps.
 * Hovering is not tried: a <Link> prefetches on pointerenter, which wakes Qwik
 * by design. Judge by q:container, not by which scripts ran: the preloader and
 * the router's scroll memory run code on any scroll and resume nothing.
 *
 *   --url <base>   a deployed site; analytics and /api/ are answered locally,
 *                  so nothing is sent
 *   --dist <dir>   another build
 *
 * Exits 1 if scrolling wakes a page, or a page throws. Waking on load is
 * reported, not failed.
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8252;
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const URL_ARG = arg("url", "");
const DIST = resolve(arg("dist", join(ROOT, "dist")));
const BASE = (URL_ARG || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const WIDTHS = [
  [390, 844],
  [1440, 900],
];

/* puppeteer-core comes with lighthouse; resolved from the pnpm store. */
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

async function measure(browser, path, [width, height]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(`${BASE}/cdn-cgi/trace`))
      return r.respond({ status: 200, contentType: "text/plain", body: "" });
    if (!u.startsWith(BASE) || u.startsWith(`${BASE}/api/`)) return r.abort();
    return r.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  const state = () =>
    page.evaluate(() => document.documentElement.getAttribute("q:container"));

  await page.goto(BASE + path, { waitUntil: "load" });
  await page
    .waitForNetworkIdle({ idleTime: 2000, timeout: 30000 })
    .catch(() => {});
  const load = await state();
  const end = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= end; y += Math.round(height * 0.8)) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await sleep(120);
  }
  await sleep(800);
  const scroll = await state();
  await page.close();
  return { load, scroll, errors };
}

const server = URL_ARG
  ? null
  : spawn(
      "python3",
      ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
      { cwd: DIST, stdio: "ignore" },
    );
let failed = false;
try {
  await waitFor(`${BASE}/sitemap.xml`);
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]).pathname,
  );
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
    // In CI, without the sandbox, the way audit.mjs launches Chrome there.
    args: ["--no-first-run", ...(process.env.CI ? ["--no-sandbox"] : [])],
  });
  try {
    console.log(`${BASE}: q:container after load, then after scrolling\n`);
    for (const path of paths) {
      for (const size of WIDTHS) {
        const { load, scroll, errors } = await measure(browser, path, size);
        const woke = load === "paused" && scroll !== "paused";
        if (woke || errors.length) failed = true;
        console.log(
          `  ${path.padEnd(34)} ${String(size[0]).padStart(4)}px  ` +
            `${load.padEnd(8)} -> ${scroll}` +
            (woke ? "   FAIL  scrolling woke Qwik" : "") +
            (errors.length ? `   FAIL  ${errors.join("; ")}` : ""),
        );
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server?.kill();
}
process.exit(failed ? 1 : 0);
