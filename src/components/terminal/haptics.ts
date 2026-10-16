import { $ } from "@qwik.dev/core";

/** Vibration length in ms. */
const PATTERN = {
  key: 4,
  enter: 9,
  error: 18,
} as const;

export type Haptic = keyof typeof PATTERN;

/**
 * A no-op on iOS Safari, which has no `navigator.vibrate`, so pair each tick
 * with a visible change. Call from a handler: vibration needs a user gesture.
 */
export const haptic = $((kind: Haptic = "key") => {
  if (typeof navigator === "undefined" || typeof window === "undefined") return;

  if (typeof navigator.vibrate !== "function") return;

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  try {
    navigator.vibrate(PATTERN[kind]);
  } catch {
    // Some webviews throw; never break input over a buzz.
  }
});
