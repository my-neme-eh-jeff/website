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

export const Terminal = component$(() => {
  const lines = useStore<{ items: Line[] }>({ items: [...BANNER] });
  const value = useSignal("");
  const inputRef = useSignal<HTMLInputElement | undefined>();
  const history = useStore<{ past: string[]; cursor: number }>({
    past: [],
    cursor: -1,
  });

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
      }
      return;
    }

    // A tick per keystroke, but not for modifiers or navigation.
    if (e.key.length === 1) await haptic("key");
  });

  return (
    <div class="glass overflow-hidden rounded-2xl">
      {/* Chrome. The dots are decorative — they are not buttons, so they are
          not focusable and carry no labels. */}
      <div
        class="border-line/60 flex items-center gap-2 border-b px-4 py-2.5"
        aria-hidden="true"
      >
        <span class="flex gap-1.5">
          <span class="size-2.5 rounded-full bg-[#e0715c]/70" />
          <span class="size-2.5 rounded-full bg-[#d9a557]/70" />
          <span class="size-2.5 rounded-full bg-[#5faa78]/70" />
        </span>
        <span class="text-muted ml-1 font-mono text-xs">shell</span>
      </div>

      {/*
       * Clicking anywhere in the body focuses the input, which is what people
       * expect from a terminal. The <label> is what makes that accessible: it
       * gives the input a name and makes the whole body a legitimate click
       * target, rather than a div with an onClick that a screen reader cannot
       * describe.
       */}
      <label class="block cursor-text px-4 py-4" for="term-input">
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
    </div>
  );
});
