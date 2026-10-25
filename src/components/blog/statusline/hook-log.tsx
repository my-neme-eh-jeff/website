import { component$, useSignal } from "@qwik.dev/core";

const ACTIONS = [
  {
    session: "A",
    tool: "Edit",
    arg: "~/code/api/retry.go",
    repo: "api",
    dirties: true,
  },
  {
    session: "B",
    tool: "Write",
    arg: "~/code/infra/main.tf",
    repo: "infra",
    dirties: true,
  },
  {
    session: "C",
    tool: "Bash",
    arg: "cd ~/code/web && npm test",
    repo: "web",
    dirties: false,
  },
] as const;

const SESSIONS = ["A", "B", "C"] as const;

const Repo = ({ name, wrong }: { name: string; wrong?: boolean }) => (
  <span
    class={[
      "rounded px-1.5 py-0.5 font-mono text-xs",
      wrong ? "text-danger ring-danger ring-1 ring-inset" : "bg-text/5",
    ]}
  >
    ⎇ {name}
    {wrong && <span class="sr-only"> (never touched by this session)</span>}
  </span>
);

export const HookLog = component$(() => {
  const done = useSignal<boolean[]>(ACTIONS.map(() => true));

  const applied = ACTIONS.filter((_, i) => done.value[i]);
  const dirty = applied.filter((a) => a.dirties).map((a) => a.repo);

  return (
    <div>
      <p class="text-muted mb-2 text-sm" id="hook-log-actions">
        Three sessions, one tool call each:
      </p>
      <div
        class="flex flex-col gap-2"
        role="group"
        aria-labelledby="hook-log-actions"
      >
        {ACTIONS.map((a, i) => (
          <button
            key={a.session}
            type="button"
            aria-pressed={done.value[i]}
            onClick$={() => {
              const next = [...done.value];
              next[i] = !next[i];
              done.value = next;
            }}
            class="border-line aria-pressed:border-accent flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border bg-transparent px-3 py-1.5 text-left font-mono text-xs"
          >
            <span class="text-accent shrink-0 font-sans text-sm font-medium">
              {a.session}
            </span>
            <span class="text-muted shrink-0">{a.tool}</span>
            <span class="min-w-0 truncate">{a.arg}</span>
          </button>
        ))}
      </div>

      <table class="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr class="text-muted border-line border-b text-left">
            <th scope="col" class="py-2 pr-4 font-normal">
              Session
            </th>
            <th scope="col" class="py-2 pr-4 font-normal">
              Git status, shared by every tab
            </th>
            <th scope="col" class="py-2 font-normal">
              The hook’s log for this session
            </th>
          </tr>
        </thead>
        <tbody>
          {SESSIONS.map((s) => {
            const mine = applied.filter((a) => a.session === s);
            return (
              <tr key={s} class="border-line border-b last:border-0">
                <th
                  scope="row"
                  class="text-accent py-2.5 pr-4 text-left font-medium"
                >
                  {s}
                </th>
                <td class="py-2.5 pr-4">
                  <span class="flex flex-wrap gap-1.5">
                    {dirty.length === 0 && <span class="text-muted">—</span>}
                    {dirty.map((r) => (
                      <Repo
                        key={r}
                        name={r}
                        wrong={!mine.some((a) => a.repo === r)}
                      />
                    ))}
                  </span>
                </td>
                <td class="py-2.5">
                  <span class="flex flex-wrap gap-1.5">
                    {mine.length === 0 && <span class="text-muted">—</span>}
                    {mine.map((a) => (
                      <Repo key={a.repo} name={a.repo} />
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
