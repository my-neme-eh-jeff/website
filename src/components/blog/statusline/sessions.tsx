import { component$, useSignal } from "@qwik.dev/core";
import { Choice } from "../controls";
import type { Repo, State } from "./model";
import { quiet } from "./scenarios";
import { Statusline } from "./terminal";

const OPTIONS = [
  { value: "same", label: "the same checkout" },
  { value: "worktree", label: "its own worktree" },
  { value: "closed", label: "a tab closed 3 minutes ago" },
] as const;

const WT = "~/code/api/.claude/worktrees/fix-retries";

const session = (title: string, context: number, cost: number, repo: Repo) =>
  quiet({ title, context, cost, repos: [repo] }) satisfies State;

export const Sessions = component$(() => {
  const mode = useSignal<string>("same");
  const same = mode.value !== "worktree";
  const live = mode.value !== "closed";

  const a = session(
    "api retry budget",
    41,
    3.8,
    mode.value === "same"
      ? { name: "api", branch: "main", collide: 1 }
      : mode.value === "worktree"
        ? { name: "api", branch: "main", worktreeOf: "fix-retries" }
        : { name: "api", branch: "main" },
  );
  const b = session(
    "bump providers",
    23,
    1.15,
    same
      ? { name: "api", branch: "main", collide: 1 }
      : {
          name: "api",
          branch: "fix-retries",
          ownWorktree: true,
          worktreeOf: "main",
        },
  );

  const rows = [
    {
      flag: "--show-toplevel",
      a: "~/code/api",
      b: same ? "~/code/api" : WT,
      equal: same,
    },
    {
      flag: "--git-common-dir",
      a: "~/code/api/.git",
      b: "~/code/api/.git",
      equal: true,
    },
    {
      flag: "last tick",
      a: "just now",
      b: live ? "just now" : "3 min ago",
      equal: live,
    },
  ];

  const verdict =
    mode.value === "same"
      ? "Same checkout: both sessions get ⚠×1."
      : mode.value === "worktree"
        ? "Same repository, different checkout: no warning, just ⑃ and the other session's branch."
        : "B hasn't ticked in two minutes, so it doesn't count. A shows nothing.";

  return (
    <div>
      <Choice legend="Session B is working in" options={OPTIONS} value={mode} />

      <div class="scroll-cue mt-5 overflow-x-auto">
        <table class="w-full border-collapse font-mono text-xs">
          <thead>
            <tr class="text-muted border-line border-b text-left font-sans text-sm">
              <th scope="col" class="py-2 pr-4 font-normal">
                git rev-parse
              </th>
              <th scope="col" class="py-2 pr-4 font-normal">
                Session A
              </th>
              <th scope="col" class="py-2 font-normal">
                Session B
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.flag} class="border-line border-b last:border-0">
                <th
                  scope="row"
                  class="text-muted py-2 pr-4 text-left font-normal whitespace-nowrap"
                >
                  {r.flag}
                </th>
                <td class="py-2 pr-4 whitespace-nowrap">{r.a}</td>
                <td
                  class={[
                    "py-2 whitespace-nowrap",
                    r.equal ? "" : "text-accent",
                  ]}
                >
                  {r.b}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p class="mt-4 mb-4 text-sm" aria-live="polite">
        {verdict}
      </p>

      <div class="grid grid-cols-1 gap-4">
        <div>
          <p class="eyebrow mb-1.5">Session A</p>
          <Statusline state={a} label="Session A's status line" />
        </div>
        <div class={live ? "" : "opacity-60"}>
          <p class="eyebrow mb-1.5">Session B{live ? "" : " · closed"}</p>
          <Statusline state={b} label="Session B's status line" />
        </div>
      </div>
    </div>
  );
});
