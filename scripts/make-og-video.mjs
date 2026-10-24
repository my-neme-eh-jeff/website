/**
 * Link-preview video. Run: `pnpm run og.video` (after `pnpm run build`)
 *
 * Records the built home page in a 1200x630 headless Chrome window: the
 * pointer sweeps the desk and the lamp follows it, then a question is typed
 * and the lamp follows the caret. Writes public/og/home.mp4, H.264 with no
 * audio and the moov box first; `pnpm run verify` checks all three.
 *
 * /api/ and anything off the local server are refused, so recording never
 * reaches the desk or sends analytics. Needs ffmpeg on PATH.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "public", "og", "home.mp4");
const PORT = 8264;
const BASE = `http://127.0.0.1:${PORT}`;
const W = 1200;
const H = 630;
const FPS = 30;
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** page.mouse.move's steps run as fast as they can; this one takes `ms`. */
async function glide(page, from, to, ms) {
  const t0 = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - t0) / ms);
    const k = ease(t);
    await page.mouse.move(
      from[0] + (to[0] - from[0]) * k,
      from[1] + (to[1] - from[1]) * k,
    );
    if (t === 1) return to;
    await sleep(16);
  }
}

const server = spawn(
  "python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: DIST, stdio: "ignore" },
);
const work = mkdtempSync(join(tmpdir(), "og-video-"));
const pp = (
  await import(
    fromStore("puppeteer-core@", "puppeteer-core/lib/puppeteer/puppeteer-core.js")
  )
).default;

let browser;
try {
  await waitFor(`${BASE}/`);
  browser = await pp.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
    { name: "prefers-reduced-motion", value: "no-preference" },
  ]);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(`${BASE}/cdn-cgi/`))
      return r.respond({ status: 200, contentType: "text/plain", body: "" });
    if (!u.startsWith(BASE) || u.startsWith(`${BASE}/api/`)) return r.abort();
    return r.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 });

  const field = await page.$("#term-input");
  if (!field) throw new Error("No #term-input on the home page.");
  const art = await page.$$eval("[data-desk-grid]", (els) => {
    const r = els.find((e) => e.offsetParent)?.getBoundingClientRect();
    return r && { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!art) throw new Error("No visible desk grid on the home page.");

  const OFF = [W + 40, -40];
  await page.mouse.move(...OFF);
  await sleep(2500);

  const cdp = await page.createCDPSession();
  let n = 0;
  const stamps = [];
  let recording = true;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (!recording) return;
    const i = n++;
    stamps[i] = metadata.timestamp;
    writeFileSync(
      join(work, `f${String(i).padStart(5, "0")}.png`),
      Buffer.from(data, "base64"),
    );
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  const start = Date.now() / 1000;

  // It starts and ends the same way, pointer off the shell and field empty,
  // so the preview loops without a jump.
  const cx = art.x + art.w / 2;
  const cy = art.y + art.h / 2;
  let at = OFF;
  await sleep(700);
  at = await glide(page, at, [cx + art.w * 0.3, cy - art.h * 0.3], 900);
  at = await glide(page, at, [cx - art.w * 0.35, cy + art.h * 0.2], 1600);
  at = await glide(page, at, OFF, 700);
  // light.ts hands the lamp to the caret once the mouse is 2 s still.
  await field.focus();
  await sleep(2100);
  const q = "What is he working on?";
  await page.keyboard.type(q, { delay: 85 });
  await sleep(800);
  for (let i = 0; i < q.length; i++) {
    await page.keyboard.press("Backspace");
    await sleep(25);
  }
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(1400);

  const end = Date.now() / 1000;
  recording = false;
  await cdp.send("Page.stopScreencast");
  if (errors.length) throw new Error(`Page errors:\n  ${errors.join("\n  ")}`);
  if (n < (end - start) * 10)
    throw new Error(`Only ${n} frames in ${(end - start).toFixed(1)}s.`);

  // Screencast frames arrive only on repaint, so each lasts until the next.
  const name = (i) => join(work, `f${String(i).padStart(5, "0")}.png`);
  const list = stamps.map((t, i) => {
    const next = i + 1 < n ? stamps[i + 1] : end;
    return `file '${name(i)}'\nduration ${Math.max(0, next - t).toFixed(4)}`;
  });
  list.push(`file '${name(n - 1)}'`);
  writeFileSync(join(work, "list.txt"), list.join("\n"));

  mkdirSync(dirname(OUT), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      ["-y", "-hide_banner", "-loglevel", "error"],
      ["-f", "concat", "-safe", "0", "-i", join(work, "list.txt")],
      ["-vf", `fps=${FPS},format=yuv420p`],
      ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow"],
      ["-crf", "22", "-movflags", "+faststart", "-an", OUT],
    ].flat(),
    { stdio: "inherit" },
  );

  const mp4 = readFileSync(OUT);
  console.log(
    `wrote public/og/home.mp4  ${W}x${H}  ${(end - start).toFixed(1)}s  ` +
      `${n} frames  ${mp4.length} B`,
  );
} finally {
  await browser?.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
