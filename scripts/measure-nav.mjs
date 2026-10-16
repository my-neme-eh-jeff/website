/**
 * Navigation measurements. Run: `node scripts/measure-nav.mjs`
 * (after `pnpm run build`)
 *
 * Loads --from, waits for the idle preloads, clicks the header link to --to
 * over a simulated round trip, and times click -> view transition ready. Also
 * reports the JS the start page fetched before the click.
 *
 *   --rtt <ms>       simulated round trip, default 40; 150 is a slow phone
 *   --runs <n>       median of n cold runs, default 3
 *   --from <path>    default /
 *   --to <path>      default /blog/ — must be a link in the header
 *   --frames <dir>   also write <dir>/strip.png, one transition slowed 10x
 *   --motion reduce  emulate reduced motion; exits 1 if any view-transition
 *                    animation runs
 *   --scheme <s>     light or dark; headless Chrome otherwise follows the OS
 *   --dist <dir>     measure another build, e.g. a copy saved before a change
 *
 * python's http.server sends no compression, so the brotli figure is computed
 * from the files. Compare runs with each other, not with production.
 */

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8251;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const RTT = Number(arg("rtt", "40"));
const RUNS = Number(arg("runs", "3"));
const FROM = arg("from", "/");
const TO = arg("to", "/blog/");
const FRAMES = arg("frames", "");
const REDUCE = arg("motion", "") === "reduce";
const SCHEME = arg("scheme", "");
const DIST = resolve(arg("dist", join(ROOT, "dist")));

// puppeteer-core and sharp are transitive; resolved from the pnpm store rather
// than added as dependencies for a script outside the build.
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

/** Runs in the page: log when the router starts the transition and when it is ready. */
function instrument() {
  window.__nav = [];
  const log = (ev) => window.__nav.push({ ev, t: performance.now() });
  const start = document.startViewTransition?.bind(document);
  if (start) {
    document.startViewTransition = (arg) => {
      log("start");
      const tr = start(arg);
      tr.ready.then(
        () => log("ready"),
        () => log("skipped"),
      );
      tr.finished.then(() => log("finished"));
      return tr;
    };
  }
  document.addEventListener("pointerdown", () => log("click"), true);
  window.__vtAnims = new Set();
  window.__poll = setInterval(() => {
    for (const a of document.getAnimations()) {
      const pe = a.effect?.pseudoElement ?? "";
      if (pe.includes("view-transition")) window.__vtAnims.add(pe);
    }
  }, 16);
}

async function navigate(browser, { slow = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: RTT,
    downloadThroughput: 1.6e6,
    uploadThroughput: 750e3,
  });
  await page.emulateMediaFeatures([
    {
      name: "prefers-reduced-motion",
      value: REDUCE ? "reduce" : "no-preference",
    },
    ...(SCHEME ? [{ name: "prefers-color-scheme", value: SCHEME }] : []),
  ]);

  await page.goto(BASE + FROM, { waitUntil: "load" });
  await sleep(4000); // the preloader starts after load plus an idle slot
  const idle = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => new URL(e.name).pathname)
      .filter((p) => p.startsWith("/build/") && p.endsWith(".js")),
  );

  await page.evaluate(instrument);
  const frames = [];
  if (slow) {
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
    cdp.on("Page.screencastFrame", (f) => {
      frames.push(f.data);
      cdp
        .send("Page.screencastFrameAck", { sessionId: f.sessionId })
        .catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await sleep(300);
  }

  const box = await page.evaluate((to) => {
    const a = [...document.querySelectorAll("header a")].find(
      (el) => new URL(el.href).pathname === to,
    );
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, TO);
  if (!box) throw new Error(`no header link to ${TO} on ${FROM}`);
  await page.mouse.click(box.x, box.y);
  await sleep(slow ? 7000 : 2500);
  if (slow) await cdp.send("Page.stopScreencast");

  const result = await page.evaluate(() => {
    clearInterval(window.__poll);
    const at = (ev) => window.__nav.find((e) => e.ev === ev)?.t;
    const click = at("click");
    const since = (ev) => (at(ev) == null ? null : Math.round(at(ev) - click));
    return {
      path: location.pathname,
      start: since("start"),
      ready: since("ready"),
      finished: since("finished"),
      vtAnimations: [...window.__vtAnims],
    };
  });
  await ctx.close();
  return { idle, frames, ...result };
}

async function strip(frames, dir) {
  const sharp = (await import(fromStore("sharp@", "sharp/lib/index.js")))
    .default;
  mkdirSync(dir, { recursive: true });
  const W = 480;
  const H = 300;
  const n = Math.min(10, frames.length);
  const picks = Array.from({ length: n }, (_, i) =>
    Math.round((i * (frames.length - 1)) / Math.max(1, n - 1)),
  );
  const tiles = await Promise.all(
    picks.map((i) =>
      sharp(Buffer.from(frames[i], "base64")).resize(W, H).png().toBuffer(),
    ),
  );
  await sharp({
    create: {
      width: W * 2,
      height: H * Math.ceil(n / 2),
      channels: 3,
      background: "#808080",
    },
  })
    .composite(
      tiles.map((input, i) => ({
        input,
        left: (i % 2) * W,
        top: Math.floor(i / 2) * H,
      })),
    )
    .png()
    .toFile(join(dir, "strip.png"));
  return join(dir, "strip.png");
}

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

const brotli = (path) =>
  brotliCompressSync(readFileSync(join(DIST, path)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

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
let failed = false;
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
    args: ["--hide-scrollbars", "--no-first-run"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
  try {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await navigate(browser));
    const idle = runs[0].idle;
    const raw = idle.reduce(
      (s, f) => s + readFileSync(join(DIST, f)).length,
      0,
    );
    const br = idle.reduce((s, f) => s + brotli(f), 0);
    console.log(`${FROM} -> ${TO}, ${RTT} ms RTT, median of ${RUNS} cold runs`);
    console.log(
      `  JS fetched on ${FROM} before the click   ${idle.length} requests, ` +
        `${(raw / 1024).toFixed(1)} kB raw, ${(br / 1024).toFixed(1)} kB brotli`,
    );
    for (const k of ["start", "ready", "finished"]) {
      console.log(
        `  click -> transition ${k.padEnd(8)}       ${median(runs.map((r) => r[k]))} ms`,
      );
    }
    const lost = runs.filter((r) => r.path !== TO);
    if (lost.length) {
      failed = true;
      console.error(`  FAIL  ${lost.length} run(s) did not reach ${TO}`);
    }
    if (REDUCE) {
      const seen = [...new Set(runs.flatMap((r) => r.vtAnimations))];
      if (seen.length) {
        failed = true;
        console.error(
          `  FAIL  reduced motion still animated: ${seen.join(", ")}`,
        );
      } else console.log("  reduced motion: no view-transition animation ran");
    }
    if (FRAMES) {
      const { frames } = await navigate(browser, { slow: true });
      console.log(
        `  filmstrip (${frames.length} frames, 10x slow): ${await strip(frames, FRAMES)}`,
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
