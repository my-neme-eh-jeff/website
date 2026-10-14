import { component$, useSignal } from "@qwik.dev/core";
import { heating } from "./scenarios";
import { Statusline } from "./terminal";

const ROWS = [
  {
    key: "context",
    sample: "🧠 64%",
    text: "Context used. Green to red, so you see compaction coming.",
  },
  {
    key: "limits",
    sample: "🔋 5h 72% → 100% in 1h06m",
    text: "Only what can stop you. Nothing under 60% is shown. The forecast appears only if you'd hit the limit before it resets.",
  },
  {
    key: "aws",
    sample: "☁ demo (…)",
    text: "Shown only while the AWS SSO token is still valid.",
  },
  {
    key: "repo:infra",
    sample: "⎇ infra(main) ⚠×1",
    text: "Another live session is editing this same checkout.",
  },
  {
    key: "repo:api",
    sample: "⎇ api(…)·wt ⑃ main",
    text: "Same repo, separate worktree. No conflict.",
  },
];

export const Anatomy = component$(() => {
  const hl = useSignal("");
  return (
    <div>
      <Statusline state={heating} highlight={hl.value} />
      <ul class="mt-5 grid gap-1">
        {ROWS.map((r) => {
          // Only the key in the handlers: closing over `r` serialised the whole
          // row into the page (destructuring the parameter does not help).
          const key = r.key;
          return (
            <li
              key={key}
              // Pointer, not mouse, events: iOS sends no mouse events to a plain
              // <li>, so a tap did nothing. A tap's highlight stays until the next.
              onPointerEnter$={() => (hl.value = key)}
              onPointerLeave$={(e) => {
                if (e.pointerType === "mouse") hl.value = "";
              }}
              class={[
                "grid gap-x-6 gap-y-0.5 rounded-lg px-2 py-1.5 transition-colors sm:grid-cols-[15rem_1fr]",
                hl.value === key ? "bg-text/5" : "",
              ]}
            >
              <span class="font-mono text-xs leading-6" aria-hidden="true">
                {r.sample}
              </span>
              <span class="text-muted text-sm leading-6">{r.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
