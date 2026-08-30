import { $ } from "@qwik.dev/core";

/**
 * Tiny synthesised interaction sounds for the shell.
 *
 * ---------------------------------------------------------------------------
 * SYNTHESISED, NOT SAMPLED, AND THAT IS THE WHOLE REASON THIS IS AFFORDABLE
 *
 * There are no audio files. Every sound here is a single oscillator with an
 * envelope, built at the moment it plays, so the feature adds nothing to the
 * page weight and makes no network request ever. A set of four short .wav
 * clicks would have been 40-80 kB of assets that every visitor downloads and
 * almost nobody hears.
 *
 * It also means the sounds are tunable by editing numbers rather than by
 * re-recording, which matters because "a click that reads as key travel" is
 * something you converge on by ear.
 *
 * ---------------------------------------------------------------------------
 * DEFAULT-ON WAS A DELIBERATE CALL, SO THE MUTE HAS TO BE REAL
 *
 * A site that makes noise before being asked is a real imposition — people
 * browse in offices, in libraries, next to sleeping children. This ships
 * unmuted because that is what was chosen for it, which puts the burden on the
 * mute being obvious, one click away, and remembered.
 *
 * Persistence lives HERE rather than in the component, and the check happens
 * at play time rather than at render time. That is not incidental: the
 * terminal deliberately runs no eager task (see terminal.tsx), so nothing
 * reads localStorage on load, and a component-side flag would start every page
 * as unmuted. Reading the store inside `sound` means a returning visitor who
 * muted us NEVER hears a sound, on any page, from the very first keystroke —
 * even though the toggle's icon does not know its own state until that first
 * interaction returns it. Behaviour is correct immediately; the icon catches
 * up. That trade is the right way round.
 *
 * ---------------------------------------------------------------------------
 * Three constraints worth not rediscovering:
 *
 *   - An AudioContext may only start after a user gesture. Every call site is
 *     inside a handler, and the context is created on first play rather than
 *     on import, so this module can be fetched without ever arming audio.
 *   - ONE context, reused. Browsers cap how many a document may create, and
 *     constructing one per keystroke exhausts that in seconds.
 *   - Gain must ramp, never step. Jumping from 0 to full gain puts a
 *     discontinuity in the waveform, which is itself an audible click — you
 *     get a pop layered over the sound you designed.
 * ---------------------------------------------------------------------------
 */

/** ms-scale envelopes. Anything longer stops reading as a UI tick. */
const SPEC = {
  /** Per keystroke. Highest and shortest — it has to disappear under typing. */
  key: { freq: 1720, drop: 0.72, decay: 0.026, gain: 0.026, type: "triangle" },
  /** Window chrome: minimise, maximise, mute. A softer, rounder tap. */
  chrome: { freq: 880, drop: 0.7, decay: 0.05, gain: 0.032, type: "sine" },
  /** Command submitted. Lower and longer, so it reads as a commit. */
  enter: { freq: 540, drop: 0.62, decay: 0.075, gain: 0.038, type: "sine" },
  /** Command failed. Low and blunt, deliberately not a buzzer. */
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
    // Storage denied. The toggle still works for this page; it just will not
    // be remembered, which is better than refusing to mute at all.
  }
  return value;
});

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) {
    // Browsers suspend the context when a tab is backgrounded, and it does not
    // resume itself. Without this, sound stops permanently after a tab switch.
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
 * Play `tone`, unless muted. Returns the CURRENT muted state.
 *
 * The return value is what lets the toggle's icon correct itself: the
 * component assigns it on every interaction, so the first keystroke or button
 * press reconciles the icon with what storage actually says. See the note on
 * persistence above for why it cannot simply be read during render.
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

    // Takes the edge off the harmonics so a triangle reads as a tap on a
    // surface rather than as a note being played.
    tone_.type = "lowpass";
    tone_.frequency.setValueAtTime(2800, t);

    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, t);
    // The downward glide is what separates "click" from "beep": real impacts
    // lose pitch as they decay.
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
