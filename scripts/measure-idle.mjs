/**
 * What does a page cost while nobody touches it? Run:
 * `node scripts/measure-idle.mjs` (after `pnpm run build`)
 *
 * Loads every sitemap page at phone width (4x CPU throttle) and desktop width,
 * waits for the preloader's idle work to finish, then traces 5s and reports
 * CPU ms per second, median of 3: the page's main thread, and every thread of
 * the page and the GPU process (compositor, workers, raster). A main-thread
 * animation (a custom property, a gradient, a JS loop) shows up in both
 * columns, a canvas redrawn in a
 * worker or a compositor animation only in the second. Both depend on the
 * machine, so compare builds on one machine in one sitting: running on
 * battery roughly doubled the phone column (2026-10-17).
 *
 *   --url <base>   a deployed site; analytics and /api/ are answered locally,
 *                  so nothing is sent
 *   --dist <dir>   another build
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8253;
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
/** Lighthouse's mobile profile, and a retina laptop. Paint cost scales with dpr. */
const PROFILES = [
  { name: "phone 4x", width: 412, height: 823, dpr: 1.75, cpu: 4 },
  { name: "desktop", width: 1440, height: 900, dpr: 2, cpu: 1 },
];
const RUNS = 3;
const SECONDS = 5;

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

async function cpuPerSecond(browser, path, profile) {
  const page = await browser.newPage();
  await page.setViewport({
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.dpr,
  });
  const cdp = await page.createCDPSession();
  if (profile.cpu > 1)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(`${BASE}/cdn-cgi/trace`))
      return r.respond({ status: 200, contentType: "text/plain", body: "" });
    if (!u.startsWith(BASE) || u.startsWith(`${BASE}/api/`)) return r.abort();
    return r.continue();
  });
  await page.goto(BASE + path, { waitUntil: "load" });
  await page
    .waitForNetworkIdle({ idleTime: 1500, timeout: 30000 })
    .catch(() => {});
  await page.tracing.start({
    categories: ["toplevel", "disabled-by-default-devtools.timeline"],
  });
  await sleep(SECONDS * 1000);
  const trace = JSON.parse(Buffer.from(await page.tracing.stop()).toString());
  await page.close();

  const names = new Map();
  for (const e of trace.traceEvents)
    if (e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
  const pids = new Set(
    [...names]
      .filter(([, n]) => n === "CrRendererMain" || n === "CrGpuMain")
      .map(([k]) => k.split(":")[0]),
  );
  // Top-level tasks only: a task can nest inside another on the same thread.
  const tasks = trace.traceEvents
    .filter(
      (e) =>
        e.ph === "X" &&
        (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") &&
        pids.has(String(e.pid)),
    )
    .sort((a, b) => a.ts - b.ts);
  const end = new Map();
  let main = 0;
  let all = 0;
  for (const e of tasks) {
    const thread = `${e.pid}:${e.tid}`;
    if (e.ts < (end.get(thread) ?? 0)) continue;
    end.set(thread, e.ts + e.dur);
    const cpu = e.tdur ?? e.dur;
    all += cpu;
    if (names.get(thread) === "CrRendererMain") main += cpu;
  }
  return { main: main / 1000 / SECONDS, all: all / 1000 / SECONDS };
}

const server = URL_ARG
  ? null
  : spawn(
      "python3",
      ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
      { cwd: DIST, stdio: "ignore" },
    );
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
    args: ["--no-first-run"],
  });
  try {
    console.log(
      `${BASE}: idle CPU ms per second, median of ${RUNS}: main thread / all\n\n` +
        `  ${"".padEnd(34)} ${PROFILES.map((p) => p.name.padStart(13)).join(" ")}`,
    );
    for (const path of paths) {
      const cells = [];
      for (const profile of PROFILES) {
        const runs = [];
        for (let i = 0; i < RUNS; i++)
          runs.push(await cpuPerSecond(browser, path, profile));
        const median = (k) =>
          Math.round(runs.map((r) => r[k]).sort((a, b) => a - b)[RUNS >> 1]);
        cells.push(`${median("main")} / ${median("all")}`);
      }
      console.log(
        `  ${path.padEnd(34)} ${cells.map((c) => c.padStart(13)).join(" ")}`,
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  server?.kill();
}
