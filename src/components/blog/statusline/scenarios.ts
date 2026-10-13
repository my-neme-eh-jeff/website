import type { State } from "./model";

/** The made-up machine from the script's demo/render.sh. */
const machine = {
  model: "Opus 5.5",
  ctx1m: true,
  effort: "high",
  aws: {
    profile: "demo",
    account: "000000000000",
    role: "ReadOnly",
    ssoValid: true,
  },
};

export const demo = { ...machine, kube: "staging (eks)" };

// demo/render.sh adds one second to every reset; these keep it, so
// scripts/statusline-parity.mjs can compare them with the script as-is.
export const calm: State = {
  ...demo,
  title: "tidy the login form",
  context: 18,
  cost: 0.84,
  fiveHour: { used: 31, resetsIn: 9001 },
  week: { used: 22, resetsIn: 400001 },
  repos: [{ name: "web", branch: "main" }],
};

export const heating: State = {
  ...demo,
  title: "api retry budget",
  context: 64,
  cost: 6.42,
  fiveHour: { used: 72, resetsIn: 7801 },
  week: { used: 55, resetsIn: 259201 },
  repos: [
    {
      name: "api",
      branch: "fix-retries",
      ownWorktree: true,
      worktreeOf: "main",
    },
    { name: "infra", branch: "main", collide: 1 },
    { name: "web", branch: "main" },
  ],
};

export const wall: State = {
  ...demo,
  title: "api retry budget",
  context: 91,
  cost: 11.07,
  fiveHour: { used: 100, resetsIn: 2281 },
  week: { used: 58, resetsIn: 180001 },
  cacheCold: true,
  repos: [{ name: "api", branch: "fix-retries", ownWorktree: true }],
};

/** Line 1 only, as the demo's limit and context scenarios print it. */
export const quiet = (over: Partial<State> = {}): State => ({
  ...machine,
  title: "",
  context: 40,
  cost: 3.1,
  fiveHour: { used: 20, resetsIn: 9001 },
  week: { used: 20, resetsIn: 400001 },
  ...over,
});
