import { $, component$, useOn, useSignal } from "@qwik.dev/core";
import { OPT_OUT_KEY } from "~/content/analytics";

type State = "nojs" | "signal" | "on" | "off";

const text: Record<State, string> = {
  nojs: "Analytics needs JavaScript to run, and so does this switch.",
  signal:
    "Your browser sends Global Privacy Control or Do Not Track, so analytics never loads for you. Nothing to do.",
  on: "Analytics can run in this browser. Turning it off is remembered on this device until you clear its site data.",
  off: "Analytics is off in this browser. If it had already loaded on this visit, the change applies from your next page load.",
};

export const AnalyticsChoice = component$(() => {
  const state = useSignal<State>("nojs");

  // Browser-only state, read on `qvisible`: the event useVisibleTask$ compiles
  // to, without the task.
  useOn(
    "qvisible",
    $(() => {
      const n = navigator as Navigator & { globalPrivacyControl?: boolean };
      const w = window as Window & { doNotTrack?: string };
      if (
        n.globalPrivacyControl === true ||
        n.doNotTrack === "1" ||
        w.doNotTrack === "1"
      ) {
        state.value = "signal";
        return;
      }
      try {
        state.value = localStorage.getItem(OPT_OUT_KEY) === "1" ? "off" : "on";
      } catch {
        state.value = "on";
      }
    }),
  );

  const toggle = $(() => {
    const off = state.value !== "off";
    try {
      if (off) localStorage.setItem(OPT_OUT_KEY, "1");
      else localStorage.removeItem(OPT_OUT_KEY);
      state.value = off ? "off" : "on";
    } catch {
      // Storage blocked: nothing can be remembered, so say what is true.
      state.value = "on";
    }
  });

  return (
    <div class="callout">
      <p class="mt-0" aria-live="polite">
        {text[state.value]}
      </p>
      {(state.value === "on" || state.value === "off") && (
        <button
          type="button"
          class="pill mt-3 cursor-pointer"
          onClick$={toggle}
        >
          {state.value === "on"
            ? "Turn analytics off"
            : "Turn analytics back on"}
        </button>
      )}
    </div>
  );
});
