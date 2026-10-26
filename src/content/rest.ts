/** Untouched this long, what moves on its own holds still until the next touch. */
export const REST_MS = 60_000;

/** What counts as a touch, listened for on `window` in the capture phase. */
export const TOUCH_EVENTS = [
  "pointermove",
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
  "focus",
];
