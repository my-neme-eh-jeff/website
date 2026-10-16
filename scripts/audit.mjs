/**
 * Lighthouse audit. Run: `pnpm run audit`
 *
 * Runs Lighthouse `RUNS` times against the live site and writes the median
 * category scores to tmp/audit.json (gitignored). Performance moves with CPU
 * load on the measuring machine, so one run says little.
 *
 *   --local   measure ./dist instead, for before/after on an unpushed change
 *   --check   assert FLOOR and write nothing
 *
 * Local Lighthouse, not the PageSpeed Insights API: PSI's keyless quota is
 * zero (verified 2026-08-23: HTTP 429, `"quota_limit_value": "0"`), so it
 * would need an API key and somewhere to hold it.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8175;
const OUT = join(ROOT, "tmp", "audit.json");

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

const CHECK = process.argv.includes("--check");
/** Odd, so the median is an actual observation rather than an interpolation. */
const RUNS = 3;
const LOCAL = process.argv.includes("--local");
const PROD_URL = "https://amannambisan.com/";
/**
 * Performance allows for `--check --local`: runner noise, plus the local
 * server's missing compression and caching. The rest measure correctness,
 * which doesn't vary.
 */
const FLOOR = {
  performance: 80,
  accessibility: 100,
  "best-practices": 95,
  seo: 100,
};

const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
})();

// No compression or cache headers, which is why --local isn't the default.
const server = LOCAL
  ? spawn(
      "python3",
      ["-m", "http.server", String(PORT), "--directory", join(ROOT, "dist")],
      { stdio: "ignore" },
    )
  : null;

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start on ${url}`);
}

async function main() {
  const url = LOCAL ? `http://localhost:${PORT}/` : PROD_URL;
  if (LOCAL) {
    console.warn(
      "--local: no compression, no cache headers. Useful for A/B on an " +
        "unpushed change; NOT comparable to production. Do not commit these.\n",
    );
    await waitForServer(url);
  }

  const lighthouse = (await import("lighthouse")).default;
  const chromeLauncher = await import("chrome-launcher");

  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless", "--disable-gpu", "--no-sandbox"],
  });

  try {
    // Mobile: Lighthouse's default, and the harsher form factor.
    const opts = { port: chrome.port, output: "json", logLevel: "error" };

    const runs = [];
    let lhr;
    for (let i = 0; i < RUNS; i++) {
      const result = await lighthouse(url, opts, undefined);
      if (!result?.lhr) throw new Error("Lighthouse returned no result.");
      lhr = result.lhr;
      const one = {};
      for (const key of CATEGORIES) {
        const cat = lhr.categories[key];
        if (!cat || cat.score == null) {
          throw new Error(`Lighthouse gave no score for "${key}".`);
        }
        one[key] = Math.round(cat.score * 100);
      }
      runs.push(one);
      if (!CHECK) console.log(`  run ${i + 1}: ${JSON.stringify(one)}`);
    }

    const median = (nums) =>
      [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)];
    const scores = {};
    const spread = {};
    for (const key of CATEGORIES) {
      const vals = runs.map((r) => r[key]);
      scores[key] = median(vals);
      spread[key] = Math.max(...vals) - Math.min(...vals);
    }

    if (CHECK) {
      const failed = CATEGORIES.filter((k) => scores[k] < FLOOR[k]);
      for (const k of CATEGORIES) {
        const ok = scores[k] >= FLOOR[k];
        console.log(
          `  ${ok ? "ok  " : "FAIL"} ${k.padEnd(15)} ${String(scores[k]).padStart(3)}  (floor ${FLOOR[k]})`,
        );
      }
      if (failed.length) {
        console.error(
          `\n${failed.length} category(ies) below floor. Lighthouse ` +
            `${lhr.lighthouseVersion}, ${lhr.configSettings.formFactor}.`,
        );
        process.exitCode = 1;
      } else {
        console.log("\nAll categories at or above floor.");
      }
      return;
    }

    const payload = {
      measuredAt: lhr.fetchTime.slice(0, 10),
      // Local HEAD, so it names production only once HEAD is deployed: run
      // this after a push.
      commit,
      target: LOCAL ? "local" : "production",
      lighthouseVersion: lhr.lighthouseVersion,
      formFactor: lhr.configSettings.formFactor,
      runs: RUNS,
      scores,
    };

    /*
     * A median of three cancels one bad run, not a set where every run is
     * depressed. Runs that disagree by more than SPREAD_LIMIT measured the
     * machine, so nothing is written. 1-2 points is normal rounding wobble.
     * Not applied with --check, which gates on FLOOR alone.
     */
    const SPREAD_LIMIT = 3;
    const unstable = CATEGORIES.filter((k) => spread[k] > SPREAD_LIMIT);

    if (LOCAL) {
      console.log("--local run: not written to tmp/audit.json.");
    } else if (unstable.length) {
      const load = loadavg()
        .map((n) => n.toFixed(2))
        .join(" ");
      console.error(
        `\nNOT WRITTEN. ${unstable
          .map((k) => `${k} spread ${spread[k]}`)
          .join(", ")} — above the limit of ${SPREAD_LIMIT}.\n` +
          `Load average ${load} on ${cpus().length} cores. These runs measured ` +
          `this machine as much as the site.\nRe-run when it is quiet; ` +
          `tmp/audit.json still holds the last stable measurement.`,
      );
      process.exitCode = 1;
    } else {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
    }

    console.log(
      `\nLighthouse ${lhr.lighthouseVersion} · ${payload.formFactor} · median of ${RUNS}`,
    );
    for (const [k, v] of Object.entries(scores)) {
      const bar = "█".repeat(Math.round(v / 5)).padEnd(20, "·");
      const noise = spread[k] > 0 ? `  ±${spread[k]}` : "";
      console.log(`  ${k.padEnd(15)} ${String(v).padStart(3)}  ${bar}${noise}`);
    }
    if (!LOCAL && !unstable.length) {
      console.log(`\nwrote tmp/audit.json (commit ${commit})`);
    }
  } finally {
    await chrome.kill();
  }
}

try {
  await main();
} finally {
  server?.kill();
}
