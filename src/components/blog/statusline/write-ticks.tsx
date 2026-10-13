import { component$, useSignal } from "@qwik.dev/core";
import { Choice, Range } from "../controls";

const SPAN = 180;
const RENAMED_AT = 95;

const REFRESH = [
  { value: "5", label: "every 5 s" },
  { value: "15", label: "every 15 s" },
] as const;

const POLICY = [
  { value: "always", label: "every tick" },
  { value: "needed", label: "only when needed" },
] as const;

/** Which ticks write, for one file, under the "only when needed" rules. */
const ROWS = [
  {
    file: "liveness marker",
    // Rewritten when over 60 s old; readers allow 120 s.
    needed: (ticks: number[]) => {
      let last = -Infinity;
      return ticks.map((t) => {
        if (t - last < 60) return false;
        last = t;
        return true;
      });
    },
  },
  {
    file: "tab title",
    needed: (ticks: number[], step: number) =>
      ticks.map((t) => t === 0 || (t >= RENAMED_AT && t - step < RENAMED_AT)),
  },
  {
    file: "debug sample",
    needed: (ticks: number[]) => ticks.map((t) => t === 0),
  },
];

export const WriteTicks = component$(() => {
  const refresh = useSignal<string>("15");
  const policy = useSignal<string>("needed");
  const sessions = useSignal(8);

  const step = Number(refresh.value);
  const ticks = Array.from({ length: SPAN / step }, (_, i) => i * step);
  const grid = ROWS.map((r) => ({
    file: r.file,
    writes:
      policy.value === "always" ? ticks.map(() => true) : r.needed(ticks, step),
  }));
  const each = grid.reduce((n, r) => n + r.writes.filter(Boolean).length, 0);

  return (
    <div>
      <div class="flex flex-wrap gap-x-8 gap-y-4">
        <Choice
          legend="The status line refreshes"
          options={REFRESH}
          value={refresh}
        />
        <Choice
          legend="Its files are written"
          options={POLICY}
          value={policy}
        />
      </div>

      <div class="mt-6 overflow-x-auto">
        <table class="border-separate border-spacing-y-1.5 text-xs">
          <caption class="sr-only">
            Writes per tick over three minutes, one row per file
          </caption>
          <tbody>
            {grid.map((r) => (
              <tr key={r.file}>
                <th
                  scope="row"
                  class="text-muted pr-4 text-left font-normal whitespace-nowrap"
                >
                  {r.file}
                </th>
                <td>
                  <span class="sr-only">
                    {r.writes.filter(Boolean).length} writes in{" "}
                    {r.writes.length} ticks
                  </span>
                  <span class="flex gap-0.5" aria-hidden="true">
                    {r.writes.map((w, i) => (
                      <span
                        key={i}
                        class={[
                          "block h-4 shrink-0 rounded-[3px]",
                          step === 5 ? "w-2.5" : "w-6",
                          w ? "bg-accent" : "border-line border",
                        ]}
                      />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="text-muted mt-1 text-xs">
        Three minutes, {ticks.length} ticks. The session is renamed at 1m35s.
      </p>

      <p class="mt-4 text-sm" aria-live="polite">
        {each} file writes per session. With {sessions.value} sessions open,
        that is <strong>{each * sessions.value}</strong> filesystem events in
        three minutes for Spotlight and every watcher to pick up.
      </p>

      <div class="mt-4 max-w-sm">
        <Range
          label="Sessions open"
          value={sessions}
          min={1}
          max={8}
          text={String(sessions.value)}
        />
      </div>
    </div>
  );
});
