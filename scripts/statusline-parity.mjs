/**
 * Does the blog's status-line model still render what the real script does?
 *
 *   git clone --depth 1 https://github.com/my-neme-eh-jeff/ai-experiments.git /tmp/aie
 *   node scripts/statusline-parity.mjs /tmp/aie/claude-statusline
 *
 * Runs each scenario through the script's demo/render.sh (a throwaway HOME)
 * and compares the uncoloured lines with model.ts. Needs bash and jq.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { plain, render } from "../src/components/blog/statusline/model.ts";
import {
  calm,
  demo,
  heating,
  quiet,
  wall,
} from "../src/components/blog/statusline/scenarios.ts";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: node scripts/statusline-parity.mjs <claude-statusline dir>",
  );
  process.exit(2);
}

// render.sh's payload(), with its one-second nudge on every reset.
const limits = (five, fiveLeft, wk, wkLeft) => ({
  fiveHour: { used: five, resetsIn: fiveLeft + 1 },
  week: { used: wk, resetsIn: wkLeft + 1 },
});
const limit = (five, fiveLeft, wk = 20, wkLeft = 400000) =>
  quiet(limits(five, fiveLeft, wk, wkLeft));

const scenarios = {
  calm,
  heating,
  wall,
  "limit-under": limit(45, 9000),
  "limit-quiet": limit(68, 1800),
  "limit-forecast": limit(72, 7800),
  "limit-wall": limit(100, 2280),
  "limit-ranked": limit(100, 2280, 83, 200000),
  ...Object.fromEntries(
    [8, 30, 52, 74, 93].map((n) => [
      `ctx-${n}`,
      quiet({ context: n, cost: 2.4, ...limits(20, 9000, 10, 400000) }),
    ]),
  ),
  "session-a": quiet({
    title: "api retry budget",
    context: 41,
    cost: 3.8,
    ...limits(20, 9000, 10, 400000),
    repos: [
      { name: "api", branch: "main", worktreeOf: "fix-retries" },
      { name: "infra", branch: "main", collide: 1 },
    ],
  }),
  "session-b": quiet({
    title: "bump providers",
    context: 23,
    cost: 1.15,
    ...limits(20, 9000, 10, 400000),
    repos: [
      { name: "infra", branch: "main", collide: 1 },
      {
        name: "api",
        branch: "fix-retries",
        ownWorktree: true,
        worktreeOf: "main",
      },
    ],
  }),
  "sso-valid": { ...limit(20, 9000, 10, 400000), kube: demo.kube },
  "sso-expired": {
    ...limit(20, 9000, 10, 400000),
    kube: demo.kube,
    aws: { ...demo.aws, ssoValid: false },
  },
};

let failed = 0;
for (const [name, state] of Object.entries(scenarios)) {
  const out = execFileSync("bash", [join(dir, "demo", "render.sh"), name], {
    encoding: "utf8",
    env: { ...process.env, COLUMNS: "100" },
  })
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter(Boolean);

  // Line 1 ends in the session title, right-aligned with a run of spaces.
  const [left, title = ""] = out[0].split(/ {2,}/);
  const want = [left, ...out.slice(1)];
  const r = render(state);
  const got = plain(r);

  const same =
    want.length === got.length &&
    want.every((l, i) => l === got[i]) &&
    title === r.title;
  if (same) {
    console.log(`  ok    ${name}`);
    continue;
  }
  failed++;
  console.log(`  FAIL  ${name}`);
  console.log(`    script: ${JSON.stringify([...want, title])}`);
  console.log(`    model:  ${JSON.stringify([...got, r.title])}`);
}

console.log(
  failed ? `\n${failed} scenario(s) differ.` : "\nModel matches the script.",
);
process.exit(failed ? 1 : 0);
