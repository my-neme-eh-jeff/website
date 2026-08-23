import { $ } from "@qwik.dev/core";

/**
 * A short haptic tick, for keystrokes and command submission.
 *
 * ---------------------------------------------------------------------------
 * What this actually does, and where it does nothing
 *
 * `navigator.vibrate` is Android-only in practice. **iOS Safari does not
 * implement it at all** — there is no way to trigger Taptic Engine feedback
 * from a web page, and the workarounds that circulate (a hidden `<input
 * switch>`, playing a silent audio file) either stopped working or never did.
 * So on an iPhone this is a no-op, by necessity rather than by oversight.
 *
 * That is why haptics here are strictly *additional* feedback. Every action
 * that ticks also changes something visible, so nothing depends on a buzz that
 * most visitors will never feel.
 *
 * Three guards, each for a real reason:
 *   - `prefers-reduced-motion` covers vestibular sensitivity, and a device
 *     buzzing in the hand is motion whatever the spec says about it.
 *   - Vibration requires a prior user gesture; called otherwise the browser
 *     drops it and logs a warning. Every call site here is inside a handler.
 *   - Durations stay in single-digit milliseconds. Anything longer stops
 *     reading as key travel and starts reading as a notification.
 *
 * Exported as a QRL, so this file is a separate bundle that is only fetched
 * when a handler that uses it actually runs.
 * ---------------------------------------------------------------------------
 */

/** ms per pattern. Deliberately tiny — this should feel like key travel. */
const PATTERN = {
  key: 4,
  enter: 9,
  error: 18,
} as const;

export type Haptic = keyof typeof PATTERN;

export const haptic = $((kind: Haptic = "key") => {
  if (typeof navigator === "undefined" || typeof window === "undefined") return;

  // Absent on iOS and on every desktop browser. Nothing to do there.
  if (typeof navigator.vibrate !== "function") return;

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  try {
    navigator.vibrate(PATTERN[kind]);
  } catch {
    // Some embedded webviews throw rather than no-op. Never break input over
    // a decorative buzz.
  }
});
