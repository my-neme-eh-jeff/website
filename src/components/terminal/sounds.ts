import { $ } from "@qwik.dev/core";

/** freq in Hz, decay in seconds, drop as a fraction of freq. */
const SPEC = {
  key: { freq: 1720, drop: 0.72, decay: 0.026, gain: 0.026, type: "triangle" },
  /** The mute button. */
  chrome: { freq: 880, drop: 0.7, decay: 0.05, gain: 0.032, type: "sine" },
  enter: { freq: 540, drop: 0.62, decay: 0.075, gain: 0.038, type: "sine" },
  error: { freq: 196, drop: 0.75, decay: 0.13, gain: 0.042, type: "triangle" },
} as const;

export type Tone = keyof typeof SPEC;

const STORE_KEY = "shell:muted";

/** Reading storage throws outright in some privacy modes, not just returns null. */
function readMuted(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false;
  }
}

export const isMuted = $(() =>
  typeof window === "undefined" ? false : readMuted(),
);

export const setMuted = $((value: boolean) => {
  try {
    localStorage.setItem(STORE_KEY, value ? "1" : "0");
  } catch {
    // Storage denied: muted for this page only.
  }
  return value;
});

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) {
    // A backgrounded tab can leave it suspended, and it doesn't resume itself.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Play `tone` unless storage says muted, and return the muted state. Call it
 * from a handler: an AudioContext may only start after a user gesture.
 */
export const sound = $((tone: Tone = "key"): boolean => {
  if (typeof window === "undefined") return false;
  if (readMuted()) return true;

  const ac = audio();
  if (!ac) return false;

  try {
    const spec = SPEC[tone];
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    const tone_ = ac.createBiquadFilter();

    tone_.type = "lowpass";
    tone_.frequency.setValueAtTime(2800, t);

    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, t);
    osc.frequency.exponentialRampToValueAtTime(
      spec.freq * spec.drop,
      t + spec.decay,
    );

    // Never ramp to or from exactly 0 — exponentialRamp is undefined at zero.
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(spec.gain, t + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + spec.decay);

    osc.connect(tone_).connect(amp).connect(ac.destination);
    osc.start(t);
    osc.stop(t + spec.decay + 0.02);
    osc.onended = () => {
      osc.disconnect();
      tone_.disconnect();
      amp.disconnect();
    };
  } catch {
    // Never let a decorative sound break an input.
  }
  return false;
});
