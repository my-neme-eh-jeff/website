/**
 * Made-up sessions for the status line's window, matched by its title. A line
 * with no title gets one picked from its label, so every build draws the same.
 */
export type Turn =
  | { you: string }
  | { says: string }
  | { tool: string; arg: string; out: string };

export type Thread = { cwd: string; turns: Turn[] };

const THREADS: Record<string, Thread> = {
  "api retry budget": {
    cwd: "~/code/api",
    turns: [
      {
        you: "429s from the payments client reset the retry budget, so a bad minute never backs off. fix it",
      },
      { tool: "Read", arg: "src/http/retry.ts", out: "Read 84 lines" },
      {
        says: "The budget is rebuilt inside the loop, so every retry starts with a full one. I'll move it out so each request spends from one budget.",
      },
      {
        tool: "Update",
        arg: "src/http/retry.ts",
        out: "Updated src/http/retry.ts with 4 additions and 3 removals",
      },
      { tool: "Bash", arg: "pnpm test retry", out: "✓ 14 passed (1.2s)" },
      {
        says: "Fixed. A 429 now spends from the request's budget instead of refilling it, and a new test covers a minute of them.",
      },
    ],
  },
  "tidy the login form": {
    cwd: "~/code/web",
    turns: [
      { you: "the login form jumps when the error shows up. tidy it" },
      {
        tool: "Read",
        arg: "src/routes/login/form.tsx",
        out: "Read 112 lines",
      },
      {
        says: "The error is inserted above the button and pushes it down. I'll reserve its line so nothing moves.",
      },
      {
        tool: "Update",
        arg: "src/routes/login/form.tsx",
        out: "Updated src/routes/login/form.tsx with 6 additions and 9 removals",
      },
      { tool: "Bash", arg: "pnpm test login", out: "✓ 9 passed (0.8s)" },
      {
        says: "Done. The error appears in a line that was already there, so the button stays put.",
      },
    ],
  },
  "bump providers": {
    cwd: "~/code/api",
    turns: [
      {
        you: "bump the model provider SDKs and check the streaming tests still pass",
      },
      {
        tool: "Bash",
        arg: "pnpm outdated",
        out: "3 packages have newer versions",
      },
      {
        says: "Three provider SDKs are behind, none by a major version. Updating them together.",
      },
      { tool: "Bash", arg: "pnpm update --latest", out: "Updated 3 packages" },
      { tool: "Bash", arg: "pnpm test streaming", out: "✓ 22 passed (3.4s)" },
      {
        says: "Bumped, and streaming passes. Another session is working in this checkout, so I haven't committed.",
      },
    ],
  },
};

const ALL = Object.values(THREADS);

export function threadFor(title: string, seed: string): Thread {
  const known = THREADS[title];
  if (known) return known;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++)
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ALL[(h >>> 0) % ALL.length]!;
}
