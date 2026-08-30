import { component$, useSignal, useStore, $, sync$ } from "@qwik.dev/core";
import { haptic } from "./haptics";
import { sound, isMuted, setMuted, type Tone } from "./sounds";
import { run, completions, type Line } from "./commands";

/**
 * An interactive shell. Blank template — the registry ships `help` and `clear`,
 * and `k get projects` slots in later.
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
    text: "`help` for commands, or start with `k get projects`.",
  },
];

const PROMPT = "~ $";

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
 * The cost is that the panel is REPARENTED when maximising: the same markup is
 * rendered inside the dialog instead of in flow. State survives because it
 * lives in signals rather than in the DOM. The one thing that does not survive
 * is focus — the button that was clicked no longer exists — so `close` puts it
 * back explicitly. See restoreFocusToMax.
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
 * Matters in BOTH views now. It used to matter only while maximised, because
 * the normal view had no height of its own and simply grew the page -- which
 * is the behaviour that made this read as a transcript rather than a terminal.
 * The body is now a capped scroller in either view, so output always has an
 * edge to fall past. Measured before any of this existed: `k describe projects
 * gpu-autoscaler` left scrollHeight 931 against clientHeight 517 with scrollTop
 * still 0, putting the prompt 378px past the bottom edge. You would be typing
 * somewhere you cannot see.
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
 * The caller knows exactly how many lines the buffer should hold, and each
 * one renders as exactly one <pre>. Counting them is a direct question about
 * whether the render has landed, with no timing assumption in it at all.
 *
 * Two passes, not one: an `art` line can grow a horizontal scrollbar as it
 * lays out, which changes scrollHeight after the count is already satisfied.
 *
 * Module-level rather than a closure in the component: a plain function
 * captured by a `$()` handler would have to be serialisable, and this one
 * touches nothing but the DOM, so it has no business being captured at all.
 * Harmless when the body is not a scroller — scrollTop on a non-overflowing
 * element is a no-op.
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
  const history = useStore<{ past: string[]; cursor: number }>({
    past: [],
    cursor: -1,
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
      stickToBottom(lines.items.length);
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
        stickToBottom(lines.items.length);
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
    stickToBottom(lines.items.length);
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
      lines.items = [...BANNER];
      history.past = [];
      history.cursor = -1;
      value.value = "";
      view.value = "open";
    } else {
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

  const submit = $(async () => {
    const raw = value.value;
    value.value = "";

    lines.items = [...lines.items, { kind: "in", text: `${PROMPT} ${raw}` }];
    if (raw.trim()) {
      history.past = [...history.past, raw];
      history.cursor = -1;
    }

    const result = run(raw);
    if (result === null) {
      // `clear` — the buffer belongs to the shell, so it is handled here.
      lines.items = [];
      await feedback("enter");
      return;
    }

    lines.items = [...lines.items, ...result];
    stickToBottom(lines.items.length);
    await feedback(result.some((l) => l.kind === "err") ? "error" : "enter");
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
    if (e.key === "Enter") {
      await submit();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (history.past.length === 0) return;
      const next =
        e.key === "ArrowUp"
          ? Math.min(history.cursor + 1, history.past.length - 1)
          : Math.max(history.cursor - 1, -1);
      history.cursor = next;
      value.value = next === -1 ? "" : (history.past.at(-1 - next) ?? "");
      return;
    }
    /*
     * Tab completes. See tabGuard below for how the default gets suppressed;
     * this half only does the completing.
     *
     * Shift+Tab is explicitly not completion — it is the only way back out of
     * the input for a keyboard user, and tabGuard lets it through.
     */
    if (e.key === "Tab") {
      if (e.shiftKey) return;
      const partial = value.value.trimStart();
      if (!partial) return;
      const matches = completions().filter((c) => c.startsWith(partial));
      if (matches.length === 1) {
        value.value = matches[0]!;
        await feedback("key");
      } else if (matches.length > 1) {
        // Bash prints the candidates rather than guessing.
        lines.items = [
          ...lines.items,
          { kind: "in", text: `${PROMPT} ${partial}` },
          ...matches.map((m) => ({ kind: "out" as const, text: `  ${m}` })),
        ];
        stickToBottom(lines.items.length);
      }
      return;
    }

    // A tick per keystroke, but not for modifiers or navigation.
    if (e.key.length === 1) await feedback("key");
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
   */
  const tabGuard = sync$((e: KeyboardEvent, el: HTMLInputElement) => {
    if (e.key === "Tab" && !e.shiftKey && el.value.trim() !== "") {
      e.preventDefault();
    }
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
       * shell. The cap is `min(55vh,24rem)` — 24rem is what fits comfortably
       * inside the page's rhythm, and the 55vh term is what stops it eating a
       * short viewport. `max-h` rather than `h` so a two-line banner still
       * renders as two lines instead of a mostly-empty box.
       *
       * `overscroll-contain` keeps a flick at the bottom of the buffer from
       * chaining into the page scroll, which is the thing that makes a nested
       * scroller feel broken on a trackpad.
       */}
      {(view.value === "open" || maxed) && (
        <label
          class={[
            "block cursor-text overflow-y-auto overscroll-contain px-4 py-4",
            maxed ? "min-h-0 flex-1" : "max-h-[min(55vh,24rem)]",
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
            <div class="flex flex-col gap-1" aria-live="polite">
              {lines.items.map((l, i) => (
                <pre
                  class={
                    l.kind === "art"
                      ? `m-0 ${LINE_CLASS.art}`
                      : `m-0 whitespace-pre-wrap ${LINE_CLASS[l.kind]}`
                  }
                  /*
                   * Box-drawing characters read as gibberish through a screen
                   * reader — "box drawings light down and right, box drawings
                   * light horizontal…" for every glyph. The diagram's meaning is
                   * in the Detail prose printed directly below it, so this is
                   * hidden rather than mangled.
                   */
                  aria-hidden={l.kind === "art" ? "true" : undefined}
                  key={i}
                >
                  {l.text}
                </pre>
              ))}
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
                placeholder="help"
                class="text-text placeholder:text-muted min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[0.8125rem] focus:outline-none"
                onInput$={(_, el) => (value.value = el.value)}
                /* Sync guard first: it must run before the default, and before
                 * the lazily-fetched async handler below. */
                onKeyDown$={[tabGuard, onKeyDown]}
              />
            </div>
          </div>
        </label>
      )}
    </div>
  );

  /*
   * Maximised, the same panel is rendered inside a <dialog> instead of in
   * flow, and toggleMax calls showModal() on it once it exists.
   *
   * Sizing: `w-[min(96vw,80rem)] h-[92vh]` rather than a literal inset-0.
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
        class="m-auto h-[92vh] w-[min(96vw,80rem)] max-w-none border-0 bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        {panel}
      </dialog>
    </>
  ) : (
    panel
  );
});
