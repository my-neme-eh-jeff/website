import { component$, useSignal, useStore, $, sync$ } from "@qwik.dev/core";
import { haptic } from "./haptics";
import { sound, isMuted, setMuted, type Tone } from "./sounds";
import { load as loadHistory, save as saveHistory } from "./history";
import { run, completions, ASK, type Line } from "./commands";
import { abortChat, sendChat, type Outcome, type Turn } from "./chat";
import { KNOWN_HREFS } from "~/content/chat";

/**
 * An interactive shell. The command registry lives in `commands.ts`.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS COSTS NOTHING UNTIL SOMEONE USES IT
 *
 * The whole frame — chrome, prompt, banner — is server-rendered HTML. On first
 * paint it is text and CSS, no JavaScript at all, so it costs no hydration and
 * no layout shift, and a crawler reads the banner as content.
 *
 * Every handler is a `$()` QRL, which Qwik compiles into its own bundle
 * referenced from the DOM by attribute. Nothing is fetched until an actual
 * event fires. `commands.ts` and `haptics.ts` are separate modules for the same
 * reason: they are only reachable through a handler, so they only download once
 * someone types.
 *
 * Deliberately NOT used:
 *   - `useVisibleTask$`, which would run on load and defeat the entire point.
 *   - autofocus, which would drag a phone keyboard up on page load and hijack
 *     the scroll position of a page nobody has read yet.
 *
 * Per the repo's Qwik guidance: no eager tasks, state in signals, computation
 * out of the component body.
 * ---------------------------------------------------------------------------
 */

const BANNER: Line[] = [
  { kind: "out", text: "amannambisan.com — interactive shell" },
  {
    kind: "hint",
    text: "Ask anything about Aman's work, or type `help` for commands.",
  },
];

const PROMPT = "~ $";

/** Shown under the shell until it is closed, so nobody has to guess. */
const SUGGESTIONS = [
  "What is he working on?",
  "What's his stack?",
  "How does this chat work?",
];

/** Matches the Worker's cap, so the visitor hears it here first. */
const MAX_CHAT_CHARS = 800;

/** After this long with no answer, say why: the model is probably loading. */
const SLOW_MS = 4_000;

function chatError(code: string): Line[] {
  if (code === "rate_limited") {
    return [
      {
        kind: "err",
        text: "Too many questions from your network. Try again in a minute.",
      },
    ];
  }
  if (code === "offline") {
    return [
      { kind: "err", text: "The model on Aman's desk is offline right now." },
      {
        kind: "hint",
        text: "The rest of the shell still works: try `help` or `k get projects`.",
      },
    ];
  }
  return [{ kind: "err", text: "The model could not answer that. Try again." }];
}

/**
 * The caption under an answer: where it ran, that it can be wrong, how fast.
 * Provenance first, because it is the disclosure; the numbers are garnish.
 */
function statsLine(o: Extract<Outcome, { ok: true }>): string {
  const parts = [`${o.model || "model"} on Aman's desk`, "can be wrong"];
  if (o.stats && o.stats.genMs > 0) {
    parts.push(`${(o.stats.tokens / (o.stats.genMs / 1000)).toFixed(1)} tok/s`);
  }
  if (o.firstTokenMs >= 0) {
    parts.push(`first word in ${(o.firstTokenMs / 1000).toFixed(1)}s`);
  }
  if (o.stats && o.stats.loadMs > 1000) {
    parts.push(`cold start ${(o.stats.loadMs / 1000).toFixed(1)}s`);
  }
  return parts.join(" · ");
}

/** Styling per line kind, so the render stays a lookup rather than a branch. */
const LINE_CLASS: Record<Line["kind"], string> = {
  in: "text-text",
  out: "text-muted",
  // --sem-danger, not the raw #e0715c this used to carry. That hex is 3.01:1
  // on the light ground -- error text below the 4.5:1 bar, and invisible to
  // `pnpm run verify`, which can only see colours that are tokens.
  err: "text-danger",
  hint: "text-accent",
  // Diagrams must not wrap — a re-flowed box drawing is unreadable — so this
  // is the one kind that scrolls its container instead.
  art: "text-muted/85 whitespace-pre overflow-x-auto",
  ai: "text-text",
  meta: "text-muted text-[0.6875rem] leading-snug",
};

/**
 * Window state. The traffic lights are real controls, so they need somewhere
 * to put the result.
 *
 * ---------------------------------------------------------------------------
 * MAXIMISE IS A NATIVE <dialog> RUN WITH showModal(), AND THAT IS THE WHOLE
 * REASON IT CAN BE FULLSCREEN AT ALL
 *
 * A hand-rolled `position: fixed; inset: 0` overlay is a WCAG 2.2 AA failure
 * under 2.4.11 Focus Not Obscured: with nothing containing focus, Tab walks
 * straight out of the panel into page content the overlay is now covering, so
 * the focused element ends up entirely hidden. Fixing that by hand means
 * trapping Tab, and trapping Tab means preventDefault — which an async Qwik
 * handler cannot do (see the note on onKeyDown below; `sync$` can, but a sync
 * QRL is serialised standalone and cannot reach `view` or any other signal
 * here).
 *
 * `showModal()` sidesteps all of it, because the browser supplies:
 *
 *   - focus containment, so Tab cannot leave
 *   - Escape to dismiss, firing `close`
 *   - inertness for everything behind it, so background controls are removed
 *     from the tab order rather than merely hidden
 *   - the top layer, so no z-index arithmetic against the gradient or grain
 *   - `role="dialog"` and modal semantics, without asserting aria-modal on a
 *     div that would not have earned it
 *
 * The cost is that the panel is REPARENTED when maximising. State survives
 * because it lives in signals, not the DOM; focus does not, because the button
 * that was clicked no longer exists — so `close` restores it. See
 * restoreFocusToMax.
 * ---------------------------------------------------------------------------
 */
type View = "open" | "min" | "max" | "closed";

/** The dialog and the maximise button, addressed by id because both are found
 *  from handlers after a render that has no synchronous completion hook. */
const DIALOG_ID = "term-dialog";
const CLOSE_BTN_ID = "term-close";
const MIN_BTN_ID = "term-min";
const MAX_BTN_ID = "term-max";
const MUTE_BTN_ID = "term-mute";

/**
 * What actually gets rendered, after consecutive diagram lines are merged.
 *
 * ---------------------------------------------------------------------------
 * ONE SOURCE OF TRUTH, BECAUSE stickToBottom COUNTS THESE
 *
 * stickToBottom waits until the DOM holds as many <pre> elements as it was
 * told to expect, which is how it knows Qwik's render has landed. The instant
 * a run of `art` lines collapses into a single <pre>, "one line, one <pre>"
 * stops being true and any output containing a diagram would never reach the
 * expected count — the loop would burn every attempt and give up, silently
 * un-sticking exactly the command that most needs it.
 *
 * So the grouping is a pure function and BOTH the render and the callers of
 * stickToBottom go through it. They cannot drift.
 * ---------------------------------------------------------------------------
 */
export type Group = { kind: Line["kind"]; text: string };

export function renderGroups(items: Line[]): Group[] {
  const groups: Group[] = [];
  for (const l of items) {
    const prev = groups[groups.length - 1];
    // A diagram is one picture, not N independent lines — see the render.
    if (l.kind === "art" && prev?.kind === "art") {
      prev.text += `\n${l.text}`;
    } else {
      groups.push({ kind: l.kind, text: l.text });
    }
  }
  return groups;
}

/**
 * Split a line into plain text and links.
 *
 * The shell prints an email address and a repo URL and, until now, printed
 * them as inert text — the one place the whole thing asks you to make contact
 * and it could not be clicked.
 *
 * Only `https?://` and bare email addresses match, so there is no shape of
 * input that produces a `javascript:` href. Content is Qwik JSX rather than
 * innerHTML, so the text is escaped regardless; the narrow pattern is about
 * not manufacturing a dangerous URL in the first place.
 *
 * Trailing punctuation is pushed back into the text: `wrap()` sets prose, and
 * prose ends sentences with a full stop hard against the URL it just quoted.
 */
const LINK =
  /(?:https?:\/\/[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** The longest string every candidate starts with — what Tab extends to. */
export function commonPrefix(all: string[]): string {
  if (all.length === 0) return "";
  let out = all[0]!;
  for (const c of all.slice(1)) {
    let i = 0;
    while (i < out.length && i < c.length && out[i] === c[i]) i++;
    out = out.slice(0, i);
    if (!out) break;
  }
  return out;
}

export type Segment = { text: string; href?: string };

/** With `allow`, only hrefs in it become links; the rest stay text. */
export function linkify(text: string, allow?: ReadonlySet<string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index;
    let hit = m[0];
    const trailing = /[.,;:!?)\]]+$/.exec(hit)?.[0];
    if (trailing) hit = hit.slice(0, -trailing.length);
    if (!hit) continue;
    const href = hit.startsWith("http") ? hit : `mailto:${hit}`;
    if (allow && !allow.has(href)) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: hit, href });
    last = start + hit.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/**
 * The glyph inside a lamp, as macOS draws it.
 *
 * Hidden until the cluster is hovered or holds focus, which is what a Mac
 * does — at rest the lights are just colour. `group-focus-within` rather than
 * `group-hover` alone so the glyphs are not pointer-only; tabbing to a lamp
 * reveals them too.
 *
 * aria-hidden throughout: the button already has an sr-only name that says
 * what pressing it will do, and "times" announced next to "Close shell" is
 * noise. That name is also why the glyph never has to carry meaning on its
 * own — it is a visual affordance, not the label.
 *
 * No colour class. `currentColor` picks up the glyph shade from the `lamp-*`
 * utility, so the symbol is tinted into its own button the way Apple does it —
 * a dark red x on red, not a black one. A neutral black glyph is the most
 * obvious tell that traffic lights have been reimplemented rather than copied.
 *
 * SIZED TO FILL, which the first version got wrong twice over. The dash in a
 * real 12px light spans about 8px — two thirds of the button. This svg is 8px,
 * but the artwork inside it was drawn across the middle 9 units of a 16 unit
 * box, so it rendered at ~4.5px and the glyphs read as smudges. The paths
 * below use nearly the whole viewBox.
 */
const Glyph = ({ d, fill = false }: { d: string[]; fill?: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    class="size-2 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    stroke-width="2.2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    {d.map((path) => (
      <path d={path} key={path} />
    ))}
  </svg>
);

/**
 * Two triangles hugging opposite corners — outward to zoom, inward to restore.
 *
 * Each triangle nearly fills its half — legs of 11 units in a 16 unit box —
 * leaving a diagonal gap that renders at roughly 1.4px. The first attempt used
 * legs of 6.6 set at opposite corners, which put a 4.5px void between two 3px
 * triangles: at 8px that reads as one smudge, not as a pair of arrowheads.
 *
 * Restore flips WHICH diagonal they hug rather than trying to reverse where
 * they point. At this size an arrowhead's direction is not legible, but the
 * diagonal swapping from ↘ to ↗ plainly is.
 */
const ZOOM_OUT = ["M1.5 1.5h11L1.5 12.5z", "M14.5 14.5h-11L14.5 3.5z"];
const ZOOM_IN = ["M14.5 1.5v11L3.5 1.5z", "M1.5 14.5v-11L12.5 14.5z"];

/**
 * Retry `fn` on a short timer until it reports success, or the tries run out.
 *
 * Qwik schedules rendering, so after a signal write there is no synchronous
 * moment at which the new DOM exists. `useTask$` runs BEFORE render, and
 * `useVisibleTask$` — which runs after — is banned in this file because it
 * fires on load and would defeat the lazy-loading design. So the new node has
 * to be waited for.
 *
 * TIMERS, NOT requestAnimationFrame, and that is not a style preference. The
 * first version of this polled with rAF and maximise silently did nothing:
 * the dialog stayed 0x0 with `:modal` false, while calling showModal() by hand
 * on the very same element worked immediately. rAF does not fire while the tab
 * is not visible, so every retry was simply never running. A control whose
 * behaviour depends on whether the tab happens to be foregrounded is a bug
 * even when the user is usually looking at it.
 *
 * ZERO DELAY, NOT 16ms, AND THAT IS THE FIX FOR THE MAXIMISE FLASH. The delay
 * used to be 16 -- one frame, chosen because it looked like the right unit
 * next to a render. But nothing here is synchronised to a frame: the loop is
 * waiting on Qwik's render flush, which lands on a task, not on a repaint. A
 * 16ms floor meant the panel had already left the flow while the dialog was
 * still unopened and therefore `display: none`, so the page visibly collapsed
 * and then a modal appeared a beat later. `setTimeout(0)` is clamped to ~1ms
 * (4ms once nested past five levels), which puts the flush and the showModal()
 * in the same visual instant while keeping the background-tab guarantee that
 * rAF cannot give.
 *
 * `fn` returns true when it has done its job, so a found-and-handled element
 * stops the loop rather than burning every attempt.
 */
function untilDone(fn: () => boolean, tries = 30) {
  if (tries <= 0) return;
  setTimeout(() => {
    if (!fn()) untilDone(fn, tries - 1);
  }, 0);
}

/**
 * Keep the prompt in view after output is appended.
 *
 * The body is a capped scroller in either view, so output always has an edge to
 * fall past. Measured before this existed: `k describe projects gpu-autoscaler`
 * left scrollHeight 931 against clientHeight 517 with scrollTop still 0,
 * putting the prompt 378px below the bottom edge — typing somewhere you cannot
 * see.
 *
 * IT WAITS FOR THE NODES, NOT FOR A DURATION, AND THAT DISTINCTION IS THE
 * WHOLE FUNCTION. The previous version settled when a scroll-to-bottom left
 * scrollTop where it already was, on the theory that an unchanged position
 * means the new lines have rendered and been scrolled past. It does not: an
 * element whose content has NOT yet arrived is not overflowing, so scrollTop
 * is pinned at 0, so setting it to scrollHeight leaves it at 0 — "unchanged",
 * and the loop declares success against an empty buffer. That only ever looked
 * correct because the poll interval happened to be 16ms, which was usually
 * longer than Qwik's flush. Dropping the interval to 0 for the maximise fix
 * exposed it immediately: `k describe projects gpu-autoscaler` came back with
 * scrollHeight 931 against clientHeight 384 and scrollTop still 0.
 *
 * The caller knows exactly how many elements the buffer should render as, via
 * renderGroups — which is NOT the same as the number of lines, because a run
 * of diagram lines collapses into one <pre>. Counting them is a direct
 * question about whether the render has landed, with no timing assumption in
 * it at all. Every call site goes through renderGroups for that reason.
 *
 * Two passes, not one: an `art` line can grow a horizontal scrollbar as it
 * lays out, which changes scrollHeight after the count is already satisfied.
 *
 * Module-level rather than a closure: a plain function captured by a `$()`
 * handler would have to be serialisable, and this one touches only the DOM.
 */
function stickToBottom(lineCount: number) {
  let scrolled = false;
  untilDone(() => {
    const body = document.querySelector<HTMLElement>("[data-shell] label");
    if (!body) return false;
    /*
     * Skip the copy inside a CLOSED dialog. During the max->open handover both
     * exist for a tick, and the stale one satisfies the count check below —
     * every line is present, it is merely `display: none`. Settling on it
     * leaves the real, freshly mounted body at scrollTop 0, which is the same
     * "measured the wrong thing and stopped early" failure the count check
     * exists to prevent. A dialog that is OPEN is the live one, so it passes.
     */
    const dialog = body.closest("dialog");
    if (dialog && !dialog.open) return false;
    // The render has not landed until every line in the buffer is a node.
    if (body.querySelectorAll("pre").length < lineCount) return false;
    body.scrollTop = body.scrollHeight;
    const done = scrolled;
    scrolled = true;
    return done;
  });
}

/**
 * Follow a streaming answer down, but only if the reader is already at the
 * bottom. stickToBottom cannot do this: it waits for a <pre> count, and a
 * streaming answer grows one <pre> without adding any.
 */
function followIfPinned() {
  for (const body of document.querySelectorAll<HTMLElement>(
    "[data-shell] label",
  )) {
    const dialog = body.closest("dialog");
    if (dialog && !dialog.open) continue;
    if (body.scrollHeight - body.scrollTop - body.clientHeight > 32) return;
    setTimeout(() => (body.scrollTop = body.scrollHeight), 0);
    return;
  }
}

/**
 * Put focus back on a named chrome button after the dialog goes away.
 *
 * The browser normally restores focus itself, but it restores it to the
 * element that held focus when showModal() was called — and that element was
 * inside the panel, which has since been re-rendered in a different place.
 * Without this, focus lands on <body> and a keyboard user has to tab in from
 * the top of the document again.
 *
 * Which button depends on how the dialog was left: the green one for a plain
 * restore, but minimise and close are also reachable while maximised and each
 * should hand focus to its own control, not to a third one.
 *
 * THE `closest("dialog")` GUARD IS LOAD-BEARING. Both copies of the chrome
 * carry the same ids, and for the tick or two between `close()` and Qwik
 * dropping the dialog from the DOM, BOTH exist. `getElementById` returns the
 * first in document order, which is the one inside the dialog — so without
 * this the focus would land on a node that is about to be removed, and end up
 * back on <body>: the exact bug this function exists to prevent.
 */
/**
 * Clear the busy flag that keyGuard set synchronously on Enter.
 *
 * Plain DOM rather than a signal, because the thing that SET it could not use
 * a signal — see keyGuard.
 */
function clearBusy() {
  document.querySelector("[data-shell]")?.removeAttribute("data-busy");
}

function restoreFocusTo(id: string) {
  untilDone(() => {
    const b = document.getElementById(id);
    if (!b || b.closest("dialog")) return false;
    // Only when focus has genuinely been dropped, so a retry cannot yank it
    // off something the user has since tabbed to.
    const active = document.activeElement;
    if (!active || active === document.body) b.focus();
    return true;
  });
}

/** The open dialog, if the panel is currently living inside one. */
const shellDialog = () =>
  document.getElementById(DIALOG_ID) as HTMLDialogElement | null;

export const Terminal = component$(() => {
  const lines = useStore<{ items: Line[] }>({ items: [...BANNER] });
  const value = useSignal("");
  const view = useSignal<View>("open");

  /*
   * The panel's height in normal flow, captured the instant before maximising.
   *
   * Maximising REPARENTS the panel into a <dialog>, which is out of flow
   * whether it is closed (`display: none`) or open (top layer). So the space
   * the panel occupied collapses, and everything below it on the page jumps up
   * by the panel's full height — then jumps back down on restore. That is the
   * larger half of what read as jitter; the other half was the 16ms poll, see
   * untilDone.
   *
   * A spacer of the measured height holds the gap open, so the page behind the
   * modal does not move at all.
   */
  const flowHeight = useSignal(0);

  /*
   * Whether a chrome control has been pressed yet.
   *
   * Gates the body's entry animation. Without it the shell would fade in on
   * every page load — including the server-rendered first paint, which is
   * supposed to be plain text with no motion — and it would fight the route
   * view transition. False on the server, so the SSG output is unchanged.
   */
  const stirred = useSignal(false);

  /*
   * Whether the shell is muted, for the toggle's ICON only.
   *
   * Never the source of truth — sounds.ts reads the persisted value at play
   * time, so a returning visitor who muted us is silent from the first
   * keystroke regardless of what this says. It starts false because that is
   * what the server rendered, and it is reconciled by `feedback` below on the
   * first interaction of any kind. See the persistence note in sounds.ts.
   */
  const muted = useSignal(false);

  /*
   * Completion-cycling state. `last` is what the input held after the previous
   * Tab: if the value still matches, the user has pressed Tab again without
   * typing, and the run continues from `base` rather than restarting from
   * whatever the cycling itself just wrote into the field.
   */
  const tab = useStore({ base: "", last: "", i: -1, armed: false });

  /**
   * The conversation. `turns` is sent with each question; the server keeps
   * nothing. `note` explains a long wait while it is happening. Declared
   * above every QRL that reads it — see the note on cmdHistory for why the
   * order matters.
   */
  const convo = useStore<{ streaming: boolean; turns: Turn[]; note: string }>({
    streaming: false,
    turns: [],
    note: "",
  });

  /*
   * DECLARED BEFORE ensureHistory, AND THE ORDER IS LOAD-BEARING.
   *
   * A `$()` body is extracted into its own module with its captured scope
   * passed in, and the optimizer works out what to capture from the bindings
   * that exist ABOVE it. This store used to sit below ensureHistory, so the
   * capture silently missed it and the emitted QRL read:
   *
   *   const t=await de(); t.length&&(history.past=[...t,...history.past])
   *
   * `recalled`, declared above, became `c[0]`. `history` stayed a free
   * identifier — and since it was then named `history`, it resolved to
   * `window.history` rather than throwing, so the merge wrote into the
   * History API and read `undefined` back. Nothing surfaced it; the stored
   * history was simply overwritten by the first command after a reload.
   *
   * Two rules came out of that, both cheap to keep: declare state above any
   * QRL that touches it, and never name captured state after a browser global
   * (history, location, name, status, origin, top, closed), because that is
   * what turns a missed capture from a loud ReferenceError into silence.
   */
  const cmdHistory = useStore<{ past: string[]; cursor: number }>({
    past: [],
    cursor: -1,
  });

  /** Whether stored history has been merged in yet. See ensureHistory. */
  const recalled = useSignal(false);

  /**
   * Pull history out of storage, once, before it is read from or written to.
   *
   * The ordering is the whole point: `submit` pushes onto `cmdHistory.past` and
   * saves it, so if that ran before the load, the first command of a reloaded
   * session would save a one-item array over everything that came before.
   */
  /*
   * NAMED cmdHistory, NOT history, AND THAT IS NOT A STYLE PREFERENCE.
   *
   * This store was called `history`. In-session recall worked, so it looked
   * fine — but `history` is a browser global, and the Qwik optimizer, which
   * rewrites every `$()` body into a standalone module with its captured
   * scope passed in as an array, silently declined to capture it. The emitted
   * ensureHistory read:
   *
   *   const e=c[0]; if(e.value)return; e.value=!0;
   *   const t=await de(); t.length&&(history.past=[...t,...history.past])
   *
   * `recalled` became `c[0]`; `history` stayed a bare identifier and resolved
   * to `window.history`. So the merge wrote to the History API, read
   * `undefined`, and threw inside a handler where nothing surfaced it — the
   * stored history was then overwritten by the first command of the new page.
   * The capture happened to succeed in the older handlers, which is why this
   * only appeared when a new QRL touched the same store.
   *
   * Anything sharing a name with a global — history, location, name, status,
   * origin, top, closed — is a candidate for the same silent failure. Do not
   * name captured state after one.
   */
  const ensureHistory = $(async () => {
    if (recalled.value) return;
    recalled.value = true;
    const stored = await loadHistory();
    if (stored.length) cmdHistory.past = [...stored, ...cmdHistory.past];
  });

  /**
   * One tick of feedback: audible, tactile, and self-correcting.
   *
   * Both channels are additive and both are absent somewhere — vibrate does
   * not exist on iOS or desktop, audio is off if the visitor muted it — which
   * is why every action they accompany also changes something visible.
   *
   * Assigning the return value is what reconciles the mute icon with storage,
   * on whatever the first interaction happens to be.
   */
  const feedback = $(async (tone: Tone) => {
    muted.value = await sound(tone);
    await haptic(tone === "chrome" ? "key" : tone);
  });

  /*
   * Every control RELABELS ITSELF rather than being replaced.
   *
   * Close does not swap in a separate "reopen" control; the red button stays
   * put and its accessible name becomes "Reopen shell". The button the user
   * just activated therefore keeps focus, and the name change is announced on
   * the spot. Minimise works the same way, plus aria-expanded.
   *
   * The payoff is that close and minimise need no focus management at all.
   * Maximise is the one exception, and only because showModal() reparents the
   * panel and destroys the button that was clicked — see restoreFocusToMax.
   */
  const toggleMin = $(async () => {
    stirred.value = true;
    if (view.value === "max") {
      /*
       * Minimise is reachable while maximised, and it used to leak focus.
       * Flipping straight to "min" unmounts the <dialog> without closing it:
       * the browser drops it from the top layer but fires no `close` event, so
       * nothing put focus back and it fell to <body>.
       *
       * Closing first is synchronous — it leaves the top layer immediately —
       * while `close` is dispatched as a queued task, by which point the write
       * below has already moved `view` off "max" and onDialogClose's guard
       * declines to overwrite it.
       */
      shellDialog()?.close();
      view.value = "min";
      restoreFocusTo(MIN_BTN_ID);
    } else {
      view.value = view.value === "min" ? "open" : "min";
    }
    await feedback("chrome");
  });

  const toggleMax = $(async () => {
    stirred.value = true;
    if (view.value === "max") {
      /*
       * Close the dialog AND apply the state here, rather than closing and
       * waiting for `close` to come back and do it.
       *
       * This used to route through the event so that the button and Escape
       * could not drift apart. The cost of that was a single point of failure
       * for the only exit a pointer user has: if the event does not arrive,
       * the dialog is shut but `view` is still "max", so Qwik keeps rendering
       * the panel inside a closed — and therefore `display: none` — dialog.
       * The shell does not return; it disappears, measured at 0px tall, with
       * the spacer still holding its place. There is no way back from that
       * without a reload.
       *
       * And the event genuinely does not always arrive: a dialog in a hidden
       * tab dispatches no `close` at all. That is a browser behaviour, not a
       * Qwik one — reproduced here on a hand-built dialog with no framework
       * involved, which is also why it cannot be tested from a backgrounded
       * automation tab.
       *
       * Escape still comes back through onDialogClose. The two paths cannot
       * conflict because that handler is guarded on `view` still being "max",
       * so whichever runs first wins and the other is a no-op.
       */
      shellDialog()?.close();
      view.value = "open";
      restoreFocusTo(MAX_BTN_ID);
      stickToBottom(renderGroups(lines.items).length);
    } else {
      // Measured BEFORE the state write, because that write is what destroys
      // the element being measured.
      const el = document.querySelector<HTMLElement>("[data-shell]");
      flowHeight.value = el ? Math.round(el.getBoundingClientRect().height) : 0;

      view.value = "max";
      untilDone(() => {
        const d = shellDialog();
        if (!d) return false;
        // showModal() throws if the dialog is already open, so the guard also
        // covers a double-fire, not just the retry.
        if (!d.open) d.showModal();
        /*
         * The dialog gets a FRESH scroller, so the buffer arrives at scrollTop
         * 0 and a long transcript hides the prompt behind it — measured 931px
         * of content against a 640px body, leaving the prompt 291px below the
         * fold the moment you maximise. Re-stick after the reparent, the same
         * way an append does.
         */
        stickToBottom(renderGroups(lines.items).length);
        return true;
      });
    }
    await feedback("chrome");
  });

  /**
   * The single exit from maximised, however it was triggered — the green
   * button, or Escape, which the browser handles itself and will not let a
   * modal refuse. Both arrive as the dialog's `close` event, so the state
   * change lives here and the two cannot drift apart.
   *
   * `onClose$` works even though `close` does not bubble, because qwikloader
   * delegates with CAPTURE-phase listeners and a non-bubbling event still
   * traverses the capture phase down to its target. Verified twice over: every
   * delegation call site in the loader passes capture=true
   * (`grep -o 'S([^;]*)' dist/build/q-*.js` — the qwikloader bundle), and a
   * trusted Escape driven over CDP against a real page restores the panel and
   * puts focus back on the maximise button.
   *
   * That second check was not optional. A hidden tab does not dispatch `close`
   * at all — confirmed with a dialog built by hand, no Qwik involved — so
   * testing this through a backgrounded browser reports a handler that looks
   * broken when it is fine, and would have justified replacing it with a
   * hand-rolled listener for no reason.
   */
  const onDialogClose = $(() => {
    /*
     * In practice this is Escape's path. Every button that closes the dialog
     * now applies its own state first, precisely so that none of them depends
     * on this event arriving — see toggleMax.
     *
     * Hence the guard: by the time `close` lands, `view` has usually already
     * been moved somewhere deliberate, and re-asserting "open" over it would
     * undo a minimise or a close and make the button look dead. Whichever path
     * runs first wins; this one does the work only when nothing else has.
     */
    if (view.value !== "max") return;
    view.value = "open";
    restoreFocusTo(MAX_BTN_ID);
    stickToBottom(renderGroups(lines.items).length);
  });

  /**
   * Close ends the session; reopening starts a new one.
   *
   * That is the difference between this and minimise, which keeps the buffer.
   * Without it the two buttons would do the same thing and only look
   * different, which is worse than having one button.
   */
  const toggleClose = $(async () => {
    stirred.value = true;
    if (view.value === "closed") {
      convo.turns = [];
      lines.items = [...BANNER];
      cmdHistory.past = [];
      cmdHistory.cursor = -1;
      value.value = "";
      view.value = "open";
      // Close ends the session, and that has to include what it remembered —
      // otherwise the next ArrowUp resurrects the buffer that was just reset.
      recalled.value = true;
      await saveHistory([]);
    } else {
      abortChat();
      // Same reparenting hazard as minimise — see the note there.
      const wasMax = view.value === "max";
      if (wasMax) shellDialog()?.close();
      view.value = "closed";
      if (wasMax) restoreFocusTo(CLOSE_BTN_ID);
    }
    await feedback("chrome");
  });

  /*
   * No Escape handler. The dialog gives it for free while maximised, and in
   * the other views there is nothing for Escape to dismiss. Writing one anyway
   * would mean two things racing to own the same key.
   */

  /** One question, streamed into an `ai` line created by the first token. */
  const converseInner = $(async (text: string) => {
    const say = (more: Line[]) => {
      lines.items = [...lines.items, ...more];
      stickToBottom(renderGroups(lines.items).length);
    };

    if (text.length > MAX_CHAT_CHARS) {
      return say([
        {
          kind: "err",
          text: `Keep it under ${MAX_CHAT_CHARS} characters, please.`,
        },
      ]);
    }

    const turns: Turn[] = [
      ...convo.turns,
      { role: "user" as const, content: text },
    ].slice(-8);
    convo.streaming = true;
    await feedback("enter");

    /*
     * No empty answer line up front: it would sit as a blank row between the
     * question and the pending dots. The line appears with its first word.
     */
    let answer: Line | null = null;
    let got = "";
    const slow = setTimeout(() => {
      convo.note =
        "Waking the model on Aman's desk. After a quiet spell the first answer takes about 20 seconds.";
    }, SLOW_MS);
    let outcome: Outcome;
    try {
      outcome = await sendChat(turns, (t) => {
        got = (got + t).trimStart();
        if (!got) return;
        // The prompt asks for plain text and "-" lists; gpt-oss uses
        // asterisks for emphasis and bullets anyway.
        const shown = got.replace(/^(\s*)\* /gm, "$1- ").replace(/\*/g, "");
        if (answer) {
          answer.text = shown;
          followIfPinned();
          return;
        }
        clearTimeout(slow);
        convo.note = "";
        clearBusy();
        say([{ kind: "ai", text: shown }]);
        answer = lines.items[lines.items.length - 1]!;
      });
    } finally {
      clearTimeout(slow);
      convo.note = "";
      convo.streaming = false;
    }

    if (outcome.ok) {
      convo.turns = [...turns, { role: "assistant" as const, content: got }];
      say([{ kind: "meta", text: statsLine(outcome) }]);
    } else if (outcome.code !== "aborted") {
      say(chatError(outcome.code));
      await feedback("error");
    } else if (got) {
      // Otherwise a half answer reads as the model losing its train of thought.
      say([{ kind: "meta", text: "stopped" }]);
    }
  });

  const converse = $(async (text: string) => {
    try {
      await converseInner(text);
    } finally {
      // Every path out, including the early returns and a throw.
      clearBusy();
    }
  });

  /**
   * Run one line, typed or picked from the suggestions. The shell decides per
   * line whether it is a command or a question; there is no mode to enter.
   */
  const runLine = $(async (raw: string) => {
    // finally, not a tail call: every early return has to clear the busy
    // dots, and a throw must not leave them running forever.
    let handedOff = false;
    try {
      lines.items = [...lines.items, { kind: "in", text: `${PROMPT} ${raw}` }];
      if (raw.trim()) {
        // Before the push, never after — see ensureHistory.
        await ensureHistory();
        cmdHistory.past = [...cmdHistory.past, raw];
        cmdHistory.cursor = -1;
        await saveHistory(cmdHistory.past);
      }

      const result = run(raw);
      if (result === ASK) {
        /*
         * NOT awaited. Qwik runs an element's handlers one at a time, so
         * awaiting the stream here held every later keydown — Ctrl+C
         * included — until the answer had finished. converse clears the
         * busy dots itself.
         */
        handedOff = true;
        void converse(raw.trim());
        return;
      }
      if (result === null) {
        // `clear`. What is on screen is what the model knows, so the
        // conversation goes with the buffer.
        lines.items = [];
        convo.turns = [];
        await feedback("enter");
        return;
      }

      lines.items = [...lines.items, ...result];
      stickToBottom(renderGroups(lines.items).length);
      await feedback(result.some((l) => l.kind === "err") ? "error" : "enter");
    } finally {
      if (!handedOff) clearBusy();
    }
  });

  const submit = $(async () => {
    // One answer at a time. What they typed stays in the field.
    if (convo.streaming) return;
    const raw = value.value;
    value.value = "";
    await runLine(raw);
  });

  /**
   * A suggestion is asked exactly as if it had been typed. The row stays put
   * afterwards, so the button keeps focus rather than vanishing from under it.
   */
  const suggest = $(async (q: string) => {
    if (convo.streaming) {
      clearBusy();
      return;
    }
    await runLine(q);
  });

  /**
   * Enter submits; up/down walk history, the way a real shell does.
   *
   * No `preventDefault()` anywhere, and that is deliberate rather than an
   * omission. A Qwik handler is lazily fetched, so by the time an async one
   * runs the event has already been dispatched and preventDefault is a no-op —
   * eslint's `qwik/no-async-prevent-default` flags exactly this. Qwik's
   * alternative is the `preventdefault:keydown` attribute, but that is
   * all-or-nothing for the event: on a text input it would block every
   * character from being inserted, i.e. break typing entirely.
   *
   * So the design avoids needing it. Enter on an input outside a <form> has no
   * default action to suppress, and the arrows' default — jumping the caret to
   * either end — is harmless when the value is being replaced on the same
   * keystroke.
   */
  const onKeyDown = $(async (e: KeyboardEvent) => {
    /*
     * Any key that is not Tab ends a completion run. Done unconditionally at
     * the top rather than in each branch, so a new exit path cannot forget it
     * and leave the next Tab cycling a stale candidate list.
     */
    if (e.key !== "Tab") tab.armed = false;

    if (e.key === "Enter") {
      await submit();
      return;
    }

    /*
     * Ctrl+L clears, Ctrl+C abandons the line. Both are pure muscle memory for
     * anyone who has used a shell, and both were previously handled by the
     * browser instead: Ctrl+L focuses the address bar, which is a spectacular
     * thing to happen when you meant to tidy your screen. tabGuard suppresses
     * them; this half does the work.
     */
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "l") {
        // Same rule as `clear`: the conversation goes with the screen.
        lines.items = [];
        convo.turns = [];
        await feedback("enter");
        return;
      }
      if (k === "c") {
        /*
         * Ctrl+C is COPY when there is a selection, and nothing this shell
         * does is worth breaking that. Only when nothing is selected does it
         * mean what it means in a terminal.
         */
        if (window.getSelection()?.toString()) return;
        // Mid-answer, ^C stops the model, as it does in `ollama run`.
        if (abortChat()) {
          await feedback("error");
          return;
        }
        lines.items = [
          ...lines.items,
          { kind: "in", text: `${PROMPT} ${value.value}^C` },
        ];
        value.value = "";
        cmdHistory.cursor = -1;
        stickToBottom(renderGroups(lines.items).length);
        await feedback("error");
        return;
      }
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Recall may still be on disk. Load before the first read, not after.
      await ensureHistory();
      if (cmdHistory.past.length === 0) return;
      const next =
        e.key === "ArrowUp"
          ? Math.min(cmdHistory.cursor + 1, cmdHistory.past.length - 1)
          : Math.max(cmdHistory.cursor - 1, -1);
      cmdHistory.cursor = next;
      value.value = next === -1 ? "" : (cmdHistory.past.at(-1 - next) ?? "");
      return;
    }

    /*
     * Tab completes. See tabGuard below for how the default gets suppressed;
     * this half only does the completing.
     *
     * Shift+Tab is explicitly not completion — it is the only way back out of
     * the input for a keyboard user, and tabGuard lets it through.
     *
     * THREE BEHAVIOURS, WHICH IS WHAT A REAL SHELL DOES. It used to have one:
     * print the candidates and stop, leaving you to type the rest by hand.
     *
     *   1. One match — complete it.
     *   2. Many matches that share more prefix than you typed — extend to that
     *      common prefix. `k des` becomes `k describe` without a list, because
     *      there was never a choice to make.
     *   3. Many matches, nothing more in common — print them, then cycle
     *      through them on each further Tab.
     */
    if (e.key === "Tab") {
      if (e.shiftKey) return;

      const continuing = tab.armed && value.value === tab.last;
      const base = continuing ? tab.base : value.value.trimStart();
      if (!base) return;

      const matches = completions().filter((c) => c.startsWith(base));
      if (matches.length === 0) return;

      if (matches.length === 1) {
        value.value = matches[0]!;
        tab.armed = false;
        await feedback("key");
        return;
      }

      if (continuing) {
        tab.i = (tab.i + 1) % matches.length;
        value.value = matches[tab.i]!;
        tab.last = value.value;
        await feedback("key");
        return;
      }

      const common = commonPrefix(matches);
      if (common.length > base.length) {
        value.value = common;
        tab.armed = false;
        await feedback("key");
        return;
      }

      // Bash prints the candidates rather than guessing. Then it lets you
      // walk them.
      lines.items = [
        ...lines.items,
        { kind: "in", text: `${PROMPT} ${base}` },
        ...matches.map((m) => ({ kind: "out" as const, text: `  ${m}` })),
      ];
      stickToBottom(renderGroups(lines.items).length);
      tab.base = base;
      tab.i = -1;
      tab.last = value.value;
      tab.armed = true;
      return;
    }

    /*
     * A tick per keystroke, but not for modifiers or navigation — and not for
     * chords. Ctrl+A and friends have `key.length === 1` too, and a shortcut
     * that clicks at you is a bug you only notice once sound is on.
     */
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      await feedback("key");
    }
  });

  /**
   * Mute toggle.
   *
   * Reads the persisted value rather than inverting the local signal, because
   * that signal is only an icon hint and may not yet have been reconciled —
   * inverting a stale `false` on a muted visitor's first click would leave
   * them muted while the icon claimed otherwise.
   *
   * Unmuting plays its own confirmation, which is the only honest way to
   * report that sound is back on.
   */
  const toggleMute = $(async () => {
    const next = !(await isMuted());
    muted.value = next;
    await setMuted(next);
    if (!next) await sound("chrome");
    await haptic("key");
  });

  /**
   * Suppress Tab's default, and ONLY Tab's, and only when it would complete.
   *
   * The async handler above cannot do this. A Qwik handler is fetched lazily,
   * so by the time it runs the event has been dispatched and preventDefault is
   * a no-op — eslint's `qwik/no-async-prevent-default` flags exactly that. The
   * previous comment here claimed the input carried `preventdefault:keydown`;
   * it never did, so Tab both completed the command AND blurred the field.
   * That attribute would not have worked anyway: it is all-or-nothing for the
   * event, so on a text input it would block every character from being
   * inserted.
   *
   * `sync$` is the mechanism that fits — a QRL serialised into the HTML as a
   * string and run synchronously, before the default. The cost is that it can
   * capture nothing from this scope, which is why it reads its condition off
   * the event and the element rather than off a signal.
   *
   * THE TWO CONDITIONS ARE BOTH ESCAPE HATCHES, NOT POLISH. `e.key` is "Tab"
   * for Shift+Tab too, so an unconditional preventDefault would trap a
   * keyboard user in the input with no way out — a WCAG 2.1.2 failure, and a
   * worse bug than the one being fixed. Shift+Tab always leaves; so does Tab
   * on an empty input, where there is nothing to complete anyway.
   *
   * It also claims Ctrl+L and Ctrl+C, which the shell now implements. Each is
   * conditional for the same reason: Ctrl+C must remain copy when text is
   * selected, and neither may fire with Shift held, because Ctrl+Shift+C is
   * how a developer opens devtools on this page.
   */
  const keyGuard = sync$((e: KeyboardEvent, el: HTMLInputElement) => {
    /*
     * Mark the shell busy the instant Enter is pressed.
     *
     * THIS CANNOT BE DONE FROM THE ASYNC HANDLER, and that is the entire
     * reason it lives in a sync$. The gap being covered IS the gap before the
     * async handler exists: on the first command of a page, pressing Enter
     * starts Qwik resuming the container, fetching handler bundles, and
     * rendering, and nothing on screen moves until all of that finishes. Any
     * indicator set inside that handler would appear only once the wait was
     * already over.
     *
     * A sync$ body is serialised into the HTML and run straight from
     * qwikloader with no fetch and no resume, so it paints in the same tick as
     * the keypress. It cannot touch signals, hence a DOM attribute; runLine()
     * clears it in a finally.
     *
     * Preloading the bundles would not have fixed this. Measured on the built
     * output, the first command pulls 8 files totalling 32 kB — the bytes are
     * not the wait.
     */
    if (e.key === "Enter" && el.value.trim() !== "") {
      el.closest("[data-shell]")?.setAttribute("data-busy", "");
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && el.value.trim() !== "") {
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    // Ctrl+L is the browser's address bar. The shiftKey bail above is not
    // optional: Ctrl+Shift+C opens devtools on this very page.
    if (k === "l") {
      e.preventDefault();
      return;
    }
    // Ctrl+C stays copy whenever there is something to copy.
    if (k === "c" && !window.getSelection()?.toString()) {
      e.preventDefault();
    }
  });

  /** keyGuard's busy mark, for a suggestion clicked instead of Enter. */
  const clickGuard = sync$((_: MouseEvent, el: HTMLElement) => {
    el.closest("[data-shell]")?.setAttribute("data-busy", "");
  });

  const maxed = view.value === "max";

  const panel = (
    <div
      class={
        maxed
          ? "glass flex h-full flex-col overflow-hidden rounded-2xl"
          : "glass overflow-hidden rounded-2xl"
      }
      data-shell
    >
      {/*
       * Chrome. The dots ARE the controls — close, minimise, maximise — so
       * this bar is no longer aria-hidden and each dot is a real <button>
       * with a name that states what pressing it will do.
       *
       * TARGET SIZE IS WHY THE BUTTONS ARE BIGGER THAN THE DOTS, AND IT SETS
       * A FLOOR ON HOW TIGHT THE CLUSTER CAN GET. WCAG 2.5.8 wants 24x24 CSS
       * px, and the spacing exception does not buy anything back: it requires
       * 24px between the centres of undersized targets, which is the same
       * spread as simply making the targets 24px. The buttons already sit flush
       * against each other, so 24px is the pitch and there is no legal way to
       * pull them closer.
       *
       * What IS adjustable is how much of that pitch the dot fills. The dots
       * are 12px, which IS the macOS diameter; macOS then sets them on a 20px
       * pitch and this has to use 24px. That 4px is the one dimension of these
       * controls that is not native, and it is not recoverable — the
       * alternative is targets a pointer user can miss.
       *
       * Everything else is: measured fills, a rim a step darker, and glyphs
       * tinted in each button's own hue, revealed on hover of the cluster the
       * way a Mac does. See the `lamp` utility in global.css.
       *
       * The hover wash and the press scale are on the button, not the dot, so
       * the real 24px target is what responds — otherwise a pointer inside the
       * target but outside the dot appears to have missed.
       *
       * The visible dot is aria-hidden; the name lives in the sr-only span.
       */}
      <div class="border-line/60 flex items-center gap-2 border-b px-3 py-1.5">
        <span class="group flex">
          <button
            type="button"
            id={CLOSE_BTN_ID}
            onClick$={toggleClose}
            class="hover:bg-text/10 grid size-6 place-items-center rounded-full transition duration-150 active:scale-90"
          >
            <span class="sr-only">
              {view.value === "closed" ? "Reopen shell" : "Close shell"}
            </span>
            <span class="lamp lamp-close" aria-hidden="true">
              <Glyph d={["M2.6 2.6l10.8 10.8", "M13.4 2.6L2.6 13.4"]} />
            </span>
          </button>

          {/*
           * Hidden rather than disabled while closed. A disabled minimise
           * button on a closed shell is still announced, and "dimmed,
           * Minimise shell" is noise about a thing that cannot happen.
           */}
          {view.value !== "closed" && (
            <>
              <button
                type="button"
                id={MIN_BTN_ID}
                onClick$={toggleMin}
                aria-expanded={view.value !== "min"}
                class="hover:bg-text/10 grid size-6 place-items-center rounded-full transition duration-150 active:scale-90"
              >
                <span class="sr-only">
                  {view.value === "min" ? "Expand shell" : "Minimise shell"}
                </span>
                <span class="lamp lamp-min" aria-hidden="true">
                  <Glyph d={["M1.4 8h13.2"]} />
                </span>
              </button>

              <button
                type="button"
                id={MAX_BTN_ID}
                onClick$={toggleMax}
                class="hover:bg-text/10 grid size-6 place-items-center rounded-full transition duration-150 active:scale-90"
              >
                <span class="sr-only">
                  {view.value === "max" ? "Restore shell" : "Maximise shell"}
                </span>
                <span class="lamp lamp-max" aria-hidden="true">
                  <Glyph d={maxed ? ZOOM_IN : ZOOM_OUT} fill />
                </span>
              </button>
            </>
          )}
        </span>
        {/*
         * No title while the shell is open. The section this panel sits in is
         * already headed "Shell", so a title bar reading "shell" said the same
         * word twice, three lines apart.
         *
         * The closed state still needs saying: a collapsed panel with nothing
         * in it is otherwise indistinguishable from a broken one. A screen
         * reader gets this from the red button's name flipping to "Reopen
         * shell"; this is the sighted equivalent.
         */}
        {view.value === "closed" && (
          <span class="text-muted ml-1 font-mono text-xs">closed</span>
        )}

        {/*
         * Mute. Sound ships ON, so the control that turns it off has to be
         * findable without hunting — hence a permanent button in the chrome
         * rather than something revealed on hover like the lamp glyphs.
         *
         * It relabels itself rather than toggling aria-pressed, matching every
         * other control here: the name states what pressing it will do.
         */}
        <button
          type="button"
          id={MUTE_BTN_ID}
          onClick$={toggleMute}
          class="hover:bg-text/10 text-muted ml-auto grid size-6 place-items-center rounded-full transition duration-150 active:scale-90"
        >
          <span class="sr-only">
            {muted.value ? "Unmute shell sounds" : "Mute shell sounds"}
          </span>
          <svg
            viewBox="0 0 16 16"
            class="size-3.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8.5 3L5 6H2.5v4H5l3.5 3z" />
            {muted.value ? (
              <path d="M11 6.5l3 3M14 6.5l-3 3" />
            ) : (
              <path d="M11 6a3 3 0 010 4" />
            )}
          </svg>
        </button>
      </div>

      {/*
       * Clicking anywhere in the body focuses the input, which is what people
       * expect from a terminal. The <label> is what makes that accessible: it
       * gives the input a name and makes the whole body a legitimate click
       * target, rather than a div with an onClick that a screen reader cannot
       * describe.
       */}
      {/*
       * The body renders only when the shell is open or maximised; minimise
       * and close both drop it, which is what collapses the panel to its bar.
       * State lives in signals, so the buffer survives being unmounted — that
       * is what lets minimise keep the session while close resets it.
       *
       * Maximised it is `flex-1` inside a full-height panel, so it takes
       * whatever the dialog gives it and scrolls internally. An earlier
       * attempt used `max-h-[70vh]`, which does nothing at all when the buffer
       * is short — measured 146px before and after pressing maximise.
       *
       * NORMAL VIEW IS NOW CAPPED TOO, WHICH IS WHAT MAKES IT A TERMINAL. It
       * used to have no height of its own, so every command appended to a
       * strip that just got taller: `k describe projects` pushed the rest of
       * the page down by roughly 900px and left the prompt somewhere below the
       * fold, and the panel never came back down. That is a transcript, not a
       * shell. The cap is `min(55svh,24rem)` — 24rem is what fits comfortably
       * inside the page's rhythm, and the viewport term stops it eating a
       * short screen. `max-h` rather than `h` so a two-line banner still
       * renders as two lines instead of a mostly-empty box.
       *
       * `svh`, NOT `vh` OR `dvh`. On a phone `vh` is the layout viewport and
       * ignores browser chrome, so 55vh can exceed what is actually on screen;
       * `dvh` tracks the URL bar and therefore RESIZES THE PANEL WHILE YOU
       * SCROLL, which is precisely the jitter this component spent a day
       * removing. `svh` is the small viewport — the conservative, stable one —
       * so the panel always fits and never moves on its own.
       *
       * `overscroll-contain` keeps a flick at the bottom of the buffer from
       * chaining into the page scroll, which is the thing that makes a nested
       * scroller feel broken on a trackpad.
       */}
      {(view.value === "open" || maxed) && (
        <label
          class={[
            "block cursor-text overflow-y-auto overscroll-contain px-4 py-4",
            maxed ? "min-h-0 flex-1" : "max-h-[min(55svh,24rem)]",
            stirred.value && !maxed ? "animate-shell-in" : "",
          ]}
          for="term-input"
        >
          <span class="sr-only">Terminal input</span>

          <div class="flex flex-col gap-1 font-mono text-[0.8125rem] leading-relaxed">
            {/*
             * The live region wraps the OUTPUT only. It used to wrap the prompt
             * row as well, which put an editable text field inside a region the
             * screen reader re-reads on every append — so each command echoed
             * the input back alongside its result.
             */}
            {/*
             * aria-busy while an answer streams, so a screen reader announces
             * the finished answer once instead of every fragment of it.
             */}
            <div
              class="flex flex-col gap-1"
              aria-live="polite"
              aria-busy={convo.streaming}
            >
              {renderGroups(lines.items).map((g, i) =>
                g.kind === "art" ? (
                  /*
                   * A diagram, as ONE element rather than one per line.
                   *
                   * Two bugs died with that change. Visually, each line used to
                   * be its own `overflow-x-auto` box, so scrolling a wide
                   * diagram sideways moved a single row and sheared the picture
                   * apart. And a scroll container that is `aria-hidden` cannot
                   * be given a tabindex without lying, so the only way to reach
                   * it was a pointer — a WCAG 2.1.1 failure, once per line.
                   *
                   * `role="img"` is what resolves it. Box-drawing characters
                   * read as gibberish spelled out glyph by glyph ("box drawings
                   * light down and right…"), so the contents must not be
                   * announced; but the region still has to be focusable to be
                   * scrollable by keyboard. An img with a label is exactly
                   * that: named, reachable, and announced as one thing rather
                   * than mangled. The meaning itself is in the Detail prose
                   * printed directly below.
                   */
                  <pre
                    class={`m-0 ${LINE_CLASS.art}`}
                    role="img"
                    aria-label="Architecture diagram, drawn in text. It is described in the detail below."
                    tabIndex={0}
                    key={i}
                  >
                    {g.text}
                  </pre>
                ) : (
                  <pre
                    class={`m-0 whitespace-pre-wrap ${LINE_CLASS[g.kind]}`}
                    key={i}
                  >
                    {/*
                     * Only output is linkified. `in` lines echo what was typed
                     * and `err` lines quote it back, so neither should turn a
                     * visitor's own text into a link.
                     */}
                    {g.kind === "out" || g.kind === "hint" || g.kind === "ai"
                      ? linkify(
                          g.text,
                          g.kind === "ai" ? KNOWN_HREFS : undefined,
                        ).map((seg, j) =>
                          seg.href ? (
                            <a
                              href={seg.href}
                              /*
                               * A new tab, which the rest of the site does not
                               * do — every other external link here navigates
                               * in place. The shell is the exception because it
                               * is the only stateful thing on the site: leaving
                               * the page destroys the buffer, so following a
                               * repo link would silently throw away the session
                               * that produced it.
                               *
                               * No `↗` marker, unlike the nav. This sits inside
                               * monospace output where an extra glyph shifts
                               * every column after it; the note is sr-only
                               * instead, which costs no width at all.
                               */
                              target={
                                seg.href.startsWith("http")
                                  ? "_blank"
                                  : undefined
                              }
                              rel="noopener noreferrer"
                              class="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                              key={j}
                            >
                              {seg.text}
                              {seg.href.startsWith("http") && (
                                <span class="sr-only">
                                  {" "}
                                  (opens in a new tab)
                                </span>
                              )}
                            </a>
                          ) : (
                            <span key={j}>{seg.text}</span>
                          ),
                        )
                      : g.text}
                  </pre>
                ),
              )}
            </div>

            {/*
             * The busy line, where the output is about to land. CSS shows it
             * off `[data-busy]`, which keyGuard sets in the same tick as the
             * keypress — see there for why that cannot be a signal. Not a
             * <pre>: stickToBottom counts those.
             *
             * The note is the one part that speaks. It lives outside the live
             * region above, which is aria-busy while an answer streams and
             * would hold the announcement until the wait was over.
             */}
            <div class="term-pending text-muted items-baseline gap-3">
              <span class="term-dots" aria-hidden="true" />
              <span role="status" class="text-[0.6875rem] leading-snug">
                {convo.note}
              </span>
            </div>

            <div class="mt-1 flex items-center gap-2">
              <span class="text-accent shrink-0 font-mono text-[0.8125rem]">
                {PROMPT}
              </span>
              <input
                id="term-input"
                type="text"
                value={value.value}
                spellcheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                /*
                 * Full opacity, not /50. Placeholder is text and WCAG does not
                 * exempt it: at /50 it measured 2.33:1 against the panel, taken
                 * from rendered pixels rather than token arithmetic — which is a
                 * measurement `pnpm run verify` structurally cannot make, since
                 * it compares --sem-* against --sem-bg only.
                 */
                /*
                 * The first thing a visitor reads, before any JavaScript. At
                 * most 22 characters: it is 16px on a phone (see below), and
                 * a 320px screen cut the 28-character version off mid-word.
                 * The banner says `help`, so this does not have to.
                 */
                placeholder="Ask about Aman's work"
                /*
                 * 16px on phones, 13px from `sm` up, and that is not a taste
                 * call. iOS Safari zooms the page whenever a focused input is
                 * under 16px, so tapping the prompt would scale the whole site
                 * and leave the visitor pinching their way back out. The other
                 * fix — capping maximum-scale in the viewport meta — disables
                 * pinch-zoom outright, which is a WCAG 1.4.4 failure and not
                 * on the table.
                 *
                 * The cost is that the input reads a shade larger than the
                 * output above it on a phone. It sits on its own row after the
                 * prompt, so nothing misaligns.
                 */
                class="text-text placeholder:text-muted min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-base focus:outline-none sm:text-[0.8125rem]"
                onInput$={(_, el) => (value.value = el.value)}
                /* Sync guard first: it must run before the default, and before
                 * the lazily-fetched async handler below. */
                onKeyDown$={[keyGuard, onKeyDown]}
              />
            </div>
          </div>
        </label>
      )}

      {/*
       * Example questions, so nobody has to guess that the shell takes plain
       * English. Server-rendered, so they are there before any JavaScript.
       *
       * Outside the <label>: a button is labelable, and a label may not
       * contain a labelable element other than its own control.
       */}
      {(view.value === "open" || maxed) && (
        <div
          role="group"
          aria-labelledby="term-suggest"
          class="border-line/60 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t px-4 py-2.5"
        >
          <span id="term-suggest" class="text-muted font-mono text-[0.6875rem]">
            Try asking
          </span>
          {SUGGESTIONS.map((q) => (
            <button
              type="button"
              key={q}
              onClick$={[clickGuard, $(() => suggest(q))]}
              class="border-line text-muted hover:text-text hover:border-muted min-h-6 rounded-full border px-2.5 font-mono text-[0.6875rem] transition-colors duration-150"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /*
   * Maximised, the same panel is rendered inside a <dialog> instead of in
   * flow, and toggleMax calls showModal() on it once it exists.
   *
   * Sizing: `w-[min(96vw,80rem)] h-[92svh]` rather than a literal inset-0.
   * Edge-to-edge would put the shell's own rounded corners flush against the
   * viewport corners and lose the sense that this is a window that popped out;
   * a small margin keeps the backdrop visible around it, which is what makes
   * it read as fullscreen-over-the-page rather than as a new page.
   *
   * `p-0` and `max-w-none` override UA dialog styles, which otherwise impose
   * padding, a border, and a max-width of calc(100% - 6px - 2em).
   *
   * The backdrop is dimmed and blurred so the gradient behind does not compete
   * with terminal text for attention.
   *
   * `data-shell-dialog` is what global.css hangs the entry transition off —
   * @starting-style plus a fade and a 0.97 scale, so the modal grows into
   * place instead of appearing. See the note there for why there is no exit
   * animation to match.
   *
   * THE SPACER IS NOT DECORATIVE. A dialog is out of flow in both states —
   * `display: none` while closed, top layer while open — so the moment the
   * panel moves inside one, the space it held in the page collapses and
   * everything below it jumps up by the panel's height. The spacer holds that
   * gap open at the height measured in toggleMax, so the page behind the
   * modal stays exactly where it was and restoring puts the panel back into
   * its own footprint.
   */
  return maxed ? (
    <>
      <div style={{ height: `${flowHeight.value}px` }} aria-hidden="true" />
      <dialog
        id={DIALOG_ID}
        data-shell-dialog
        onClose$={onDialogClose}
        class="m-auto h-[92svh] w-[min(96vw,80rem)] max-w-none border-0 bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        {panel}
      </dialog>
    </>
  ) : (
    panel
  );
});
