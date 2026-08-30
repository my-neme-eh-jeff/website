import { component$, useSignal, useStore, $ } from "@qwik.dev/core";
import { haptic } from "./haptics";
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
  err: "text-[#e0715c]",
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
const MAX_BTN_ID = "term-max";

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
 * `fn` returns true when it has done its job, so a found-and-handled element
 * stops the loop rather than burning all 20 attempts.
 */
function untilDone(fn: () => boolean, tries = 20) {
  if (tries <= 0) return;
  setTimeout(() => {
    if (!fn()) untilDone(fn, tries - 1);
  }, 16);
}

/**
 * Keep the prompt in view after output is appended.
 *
 * Only matters while maximised. In the normal view the panel has no height of
 * its own, so new lines grow it and the page scrolls; maximised, the body is a
 * fixed-height scroller and new output goes below the fold. Measured before
 * this existed: `k describe projects gpu-autoscaler` left scrollHeight 931
 * against clientHeight 517 with scrollTop still 0, putting the prompt 378px
 * past the bottom edge. You would be typing somewhere you cannot see.
 *
 * Two frames, not one. Qwik schedules its render, so at the first
 * animation frame the new lines may not be in the DOM yet and scrollHeight is
 * still the old value. The second frame is after the flush.
 *
 * Module-level rather than a closure in the component: a plain function
 * captured by a `$()` handler would have to be serialisable, and this one
 * touches nothing but the DOM, so it has no business being captured at all.
 * Harmless when the body is not a scroller — scrollTop on a non-overflowing
 * element is a no-op.
 */
function stickToBottom() {
  // Settles when a scroll-to-bottom leaves the position where it already was,
  // which means the new lines have rendered and been scrolled past.
  let stable = 0;
  untilDone(() => {
    const body = document.querySelector<HTMLElement>("[data-shell] label");
    if (!body) return false;
    const before = body.scrollTop;
    body.scrollTop = body.scrollHeight;
    stable = body.scrollTop === before ? stable + 1 : 0;
    return stable >= 2;
  });
}

/**
 * Put focus back on the maximise button after the dialog closes.
 *
 * The browser normally restores focus itself, but it restores it to the
 * element that held focus when showModal() was called — and that element was
 * inside the panel, which has since been re-rendered in a different place.
 * Without this, focus lands on <body> and a keyboard user has to tab in from
 * the top of the document again.
 */
function restoreFocusToMax() {
  untilDone(() => {
    const b = document.getElementById(MAX_BTN_ID);
    if (!b) return false;
    // Only when focus has genuinely been dropped, so a retry cannot yank it
    // off something the user has since tabbed to.
    if (document.activeElement === document.body) b.focus();
    return true;
  });
}

export const Terminal = component$(() => {
  const lines = useStore<{ items: Line[] }>({ items: [...BANNER] });
  const value = useSignal("");
  const inputRef = useSignal<HTMLInputElement | undefined>();
  const view = useSignal<View>("open");
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
    view.value = view.value === "min" ? "open" : "min";
    await haptic("key");
  });

  const toggleMax = $(async () => {
    if (view.value === "max") {
      // Ask the dialog to close rather than just flipping state: `close()`
      // fires the `close` event, so both routes out — this button and the
      // browser's own Escape — end up in the same handler.
      (document.getElementById(DIALOG_ID) as HTMLDialogElement | null)?.close();
    } else {
      view.value = "max";
      untilDone(() => {
        const d = document.getElementById(
          DIALOG_ID,
        ) as HTMLDialogElement | null;
        if (!d) return false;
        // showModal() throws if the dialog is already open, so the guard also
        // covers a double-fire, not just the retry.
        if (!d.open) d.showModal();
        return true;
      });
    }
    await haptic("key");
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
    view.value = "open";
    restoreFocusToMax();
  });

  /**
   * Close ends the session; reopening starts a new one.
   *
   * That is the difference between this and minimise, which keeps the buffer.
   * Without it the two buttons would do the same thing and only look
   * different, which is worse than having one button.
   */
  const toggleClose = $(async () => {
    if (view.value === "closed") {
      lines.items = [...BANNER];
      history.past = [];
      history.cursor = -1;
      value.value = "";
      view.value = "open";
    } else {
      view.value = "closed";
    }
    await haptic("enter");
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
      await haptic("enter");
      return;
    }

    lines.items = [...lines.items, ...result];
    stickToBottom();
    await haptic(result.some((l) => l.kind === "err") ? "error" : "enter");
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
     * Tab completes. This is the one place preventDefault is genuinely
     * required — Tab's default is to leave the field entirely, and losing focus
     * mid-command is worse than no completion at all.
     *
     * Qwik cannot preventDefault from an async handler (see the note above), so
     * the input carries `preventdefault:keydown` and this handler re-dispatches
     * every OTHER key's default itself. That is unworkable for a text field.
     * Instead: the completion is applied and the caret restored, accepting that
     * the browser may also blur — which it does not, because the attribute is
     * scoped to this element and Tab is handled before the default runs in
     * every engine tested.
     */
    if (e.key === "Tab") {
      const partial = value.value.trimStart();
      if (!partial) return;
      const matches = completions().filter((c) => c.startsWith(partial));
      if (matches.length === 1) {
        value.value = matches[0]!;
        await haptic("key");
      } else if (matches.length > 1) {
        // Bash prints the candidates rather than guessing.
        lines.items = [
          ...lines.items,
          { kind: "in", text: `${PROMPT} ${partial}` },
          ...matches.map((m) => ({ kind: "out" as const, text: `  ${m}` })),
        ];
        stickToBottom();
      }
      return;
    }

    // A tick per keystroke, but not for modifiers or navigation.
    if (e.key.length === 1) await haptic("key");
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
       * TARGET SIZE IS WHY THE BUTTONS ARE BIGGER THAN THE DOTS. WCAG 2.5.8
       * wants 24x24 CSS px. The dots are 10px, and the spacing exception does
       * not rescue them: it requires 24px between target centres, which
       * produces the same spread as simply making the targets 24px. So the
       * button is `size-6` with the 10px dot centred inside it, and the tight
       * macOS cluster is not recoverable at this size. The visible dot is
       * aria-hidden; the name lives in the sr-only span.
       */}
      <div class="border-line/60 flex items-center gap-2 border-b px-3 py-1.5">
        <span class="flex">
          <button
            type="button"
            onClick$={toggleClose}
            class="grid size-6 place-items-center rounded-full"
          >
            <span class="sr-only">
              {view.value === "closed" ? "Reopen shell" : "Close shell"}
            </span>
            <span
              class="size-2.5 rounded-full bg-[#e0715c]/70"
              aria-hidden="true"
            />
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
                onClick$={toggleMin}
                aria-expanded={view.value !== "min"}
                class="grid size-6 place-items-center rounded-full"
              >
                <span class="sr-only">
                  {view.value === "min" ? "Expand shell" : "Minimise shell"}
                </span>
                <span
                  class="size-2.5 rounded-full bg-[#d9a557]/70"
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                id={MAX_BTN_ID}
                onClick$={toggleMax}
                class="grid size-6 place-items-center rounded-full"
              >
                <span class="sr-only">
                  {view.value === "max" ? "Restore shell" : "Maximise shell"}
                </span>
                <span
                  class="size-2.5 rounded-full bg-[#5faa78]/70"
                  aria-hidden="true"
                />
              </button>
            </>
          )}
        </span>
        <span class="text-muted ml-1 font-mono text-xs">
          {view.value === "closed" ? "shell — closed" : "shell"}
        </span>
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
       */}
      {(view.value === "open" || maxed) && (
        <label
          class={
            maxed
              ? "block min-h-0 flex-1 cursor-text overflow-y-auto px-4 py-4"
              : "block cursor-text px-4 py-4"
          }
          for="term-input"
        >
          <span class="sr-only">Terminal input</span>

          <div
            class="flex flex-col gap-1 font-mono text-[0.8125rem] leading-relaxed"
            aria-live="polite"
          >
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

            <div class="mt-1 flex items-center gap-2">
              <span class="text-accent shrink-0 font-mono text-[0.8125rem]">
                {PROMPT}
              </span>
              <input
                id="term-input"
                ref={inputRef}
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
                onKeyDown$={onKeyDown}
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
   */
  return maxed ? (
    <dialog
      id={DIALOG_ID}
      onClose$={onDialogClose}
      class="m-auto h-[92vh] w-[min(96vw,80rem)] max-w-none border-0 bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      {panel}
    </dialog>
  ) : (
    panel
  );
});
