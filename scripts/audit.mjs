/**
 * Lighthouse audit. Run: `pnpm run audit` (after `pnpm run build`)
 *
 * Runs Lighthouse against the LIVE site and writes the four category scores to
 * src/content/audit.json, which the footer renders. Pass --local to measure a
 * freshly built ./dist instead.
 *
 * ---------------------------------------------------------------------------
 * WHY LOCAL LIGHTHOUSE AND NOT THE PAGESPEED INSIGHTS API
 *
 * PSI is free of charge but NOT free of a key: the keyless quota is literally
 * zero. Verified 2026-08-23 -- an unauthenticated call returns HTTP 429 with
 * `"quota_limit_value": "0"`. So "live" scores would need a Google Cloud API
 * key, a Worker to hold it, and caching to stop visitors burning the quota.
 *
 * Lighthouse is the same engine PSI runs server-side, so running it here
 * needs no key, no endpoint, no quota, and gives nothing to spam. The trade is
 * that these are lab numbers from whatever machine ran them, which is why the
 * output records the commit and date rather than claiming to be live.
 *
 * WHY IT MEASURES PRODUCTION AND NOT ./dist BY DEFAULT
 *
 * It used to serve dist with `python3 -m http.server` and measure that. That
 * server sends no compression and no cache headers, so Lighthouse charged the
 * site for both: it reported 87-93 with "est. savings 248 KiB" from caching
 * alone. Cloudflare serves the same bytes with brotli (28.8 kB of HTML becomes
 * 7.6 kB) and honours public/_headers, and the real score is 95 on mobile and
 * 100 on desktop.
 *
 * So the local harness was not a pessimistic approximation, it was measuring a
 * different server. Publishing that number would have understated the site by
 * several points and sent someone optimising the wrong thing. --local stays
 * available for before/after comparison on an unpushed change, but it prints a
 * warning, because its absolute numbers are not comparable to production.
 *
 * WHY IT IS COMMITTED RATHER THAN GENERATED AT DEPLOY TIME
 *
 * Deploys run through Cloudflare Workers Builds, which has no Chrome. Having
 * CI generate the file and commit it back would mean a push triggered by a
 * push. So this is a deliberate manual step, like `pnpm run icons` -- the
 * scores only move when the site meaningfully changes.
 *
 * CI still runs Lighthouse, but as a REGRESSION GATE (see ci.yml): it fails
 * the build if any category drops below the threshold, without writing
 * anything.
 * ---------------------------------------------------------------------------
 */

import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8175;
const OUT = join(ROOT, "src", "content", "audit.json");

/** Categories in the order Chrome's own report shows them. */
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

/**
 * `--check` mode: assert and exit non-zero, write nothing. This is what CI
 * runs, so a regression fails a pull request instead of quietly shipping.
 *
 * CI runs `--check --local`, because it must gate the build it just produced
 * rather than whatever is currently deployed. That means the performance floor
 * has to absorb BOTH runner noise and the missing compression and cache headers
 * of the local server — locally the same build measures 87-93 where production
 * measures 95. Hence 80, which still catches a real regression while never
 * flapping. A gate that flaps gets disabled, and then it protects nothing.
 *
 * The other three are absolutes: they measure correctness, not speed, so there
 * is no harness variance to allow for.
 */
const CHECK = process.argv.includes("--check");
const LOCAL = process.argv.includes("--local");
const PROD_URL = "https://amannambisan.com/";
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

/*
 * Only started for --local. python3's http.server has no compression and no
 * cache headers, which is exactly why it is not the default -- see the header.
 */
const server = LOCAL
  ? spawn(
      "python3",
      ["-m", "http.server", String(PORT), "--directory", join(ROOT, "dist")],
      { stdio: "ignore" },
    )
  : null;

/** Poll until the server answers, rather than sleeping a guessed interval. */
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
    const result = await lighthouse(
      url,
      { port: chrome.port, output: "json", logLevel: "error" },
      // Mobile is the default Lighthouse config and the harsher of the two, so
      // it is the honest number to publish.
      undefined,
    );
    if (!result?.lhr) throw new Error("Lighthouse returned no result.");

    const { lhr } = result;
    const scores = {};
    for (const key of CATEGORIES) {
      const cat = lhr.categories[key];
      if (!cat || cat.score == null) {
        throw new Error(`Lighthouse gave no score for "${key}".`);
      }
      scores[key] = Math.round(cat.score * 100);
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
      // Everything needed to say WHEN and WHAT was measured, so the numbers
      // are never mistaken for live telemetry.
      measuredAt: lhr.fetchTime.slice(0, 10),
      // The commit is the local HEAD. When measuring production this is only
      // accurate if HEAD is what is actually deployed, which is why the audit
      // is refreshed right after a push, not before.
      commit,
      target: LOCAL ? "local" : "production",
      lighthouseVersion: lhr.lighthouseVersion,
      formFactor: lhr.configSettings.formFactor,
      scores,
    };

    if (LOCAL) {
      console.log("--local run: not written to audit.json.");
    } else {
      writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
    }

    console.log(`Lighthouse ${lhr.lighthouseVersion} · ${payload.formFactor}`);
    for (const [k, v] of Object.entries(scores)) {
      const bar = "█".repeat(Math.round(v / 5)).padEnd(20, "·");
      console.log(`  ${k.padEnd(15)} ${String(v).padStart(3)}  ${bar}`);
    }
    console.log(`\nwrote src/content/audit.json (commit ${commit})`);
  } finally {
    await chrome.kill();
  }
}

try {
  await main();
} finally {
  server?.kill();
}
