import { $ } from "@qwik.dev/core";

/**
 * A short haptic tick, for keystrokes and command submission.
 *
 * `navigator.vibrate` is Android-only in practice. iOS Safari does not
 * implement it at all, and the workarounds that circulate — a hidden `<input
 * switch>`, playing a silent audio file — either stopped working or never did.
 * So on an iPhone this is a no-op by necessity, which is why haptics here are
 * strictly additional: every action that ticks also changes something visible.
 *
 * `prefers-reduced-motion` is checked because a device buzzing in the hand is
 * motion whatever the spec says. Vibration also requires a prior user gesture,
 * so every call site is inside a handler.
 *
 * Exported as a QRL, so this is a separate bundle fetched only when a handler
 * that uses it runs.
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
