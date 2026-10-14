import {
  component$,
  sync$,
  useId,
  useOn,
  useOnDocument,
  useSignal,
  $,
} from "@qwik.dev/core";
import { profile } from "~/content/profile";

/**
 * A hand-drawn circle around a label that opens a two-way choice.
 *
 * The annotation is an SVG path, not a font or an image. A rough ellipse is
 * three cubic curves with deliberately uneven control points and a small
 * overshoot past the start — the overshoot is what reads as "drawn by a person"
 * rather than "border-radius: 999px". `vector-effect: non-scaling-stroke` keeps
 * the ink one weight while the ellipse stretches to fit the label.
 *
 * It is a real disclosure widget, not a hover trick:
 *   - a <button> with aria-expanded and aria-controls, so a screen reader
 *     announces the state rather than the popover appearing silently;
 *   - Escape closes and returns focus, which hover-only menus cannot do;
 *   - a click outside closes it.
 *
 * Hover alone would make this unusable by keyboard and invisible to touch,
 * where there is no hover state to enter.
 */
export const CircledChoice = component$<{ label?: string }>(
  ({ label = "say hi" }) => {
    const open = useSignal(false);
    const button = useSignal<HTMLButtonElement>();
    const id = useId();
    const panelId = `choice-${id}`;

    /*
     * Escape and an outside click can only be heard on the document, where
     * every keypress and click on the page arrives. A plain handler there woke
     * this component on the first of them, whatever it was for. This one is a
     * sync$: it runs inline with no fetch and no resume, and only while the
     * panel is open does it pass the event on, to the handler below.
     */
    const dismiss = sync$((e: Event, el: HTMLElement) => {
      if (el.querySelector("[data-choice-panel]")?.hasAttribute("hidden"))
        return;
      const key = e.type === "keydown";
      if (
        key
          ? (e as KeyboardEvent).key !== "Escape"
          : el.contains(e.target as Node)
      )
        return;
      el.dispatchEvent(new CustomEvent("choicedismiss", { detail: key }));
    });
    useOnDocument("keydown", dismiss, { passive: true });
    useOnDocument("click", dismiss, { passive: true });

    // Escape is the expected way out of any transient overlay. Hiding the
    // panel under a focused link would drop focus on <body>, so hand it back
    // to the button first.
    useOn(
      "choicedismiss",
      $((e: Event) => {
        const escape = (e as CustomEvent<boolean>).detail;
        if (
          escape &&
          document.getElementById(panelId)?.contains(document.activeElement)
        )
          button.value?.focus();
        open.value = false;
      }),
    );

    const choices = profile.links.filter((l) =>
      ["LinkedIn", "X"].includes(l.label),
    );

    return (
      <div class="relative inline-block" data-circled-choice>
        <button
          ref={button}
          type="button"
          aria-expanded={open.value}
          aria-controls={panelId}
          onClick$={() => (open.value = !open.value)}
          class="text-text relative inline-flex cursor-pointer items-center border-0 bg-transparent px-3 py-1 text-base"
        >
          {label}
          {/*
           * aria-hidden: the circle is emphasis, not information. The button's
           * own text already carries the meaning.
           */}
          <svg
            class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 120 40"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M18 21 C16 10, 44 4, 72 5 C102 6, 114 13, 113 23 C112 34, 84 39, 54 38 C24 37, 8 31, 10 21 C11 12, 30 7, 50 5"
              fill="none"
              stroke="var(--sem-accent)"
              stroke-width="2"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
              class="motion-safe:animate-ink [stroke-dasharray:420] [stroke-dashoffset:420] motion-reduce:[stroke-dashoffset:0]"
            />
          </svg>
        </button>

        {/*
         * `hidden` rather than conditional rendering: the panel is two links,
         * so keeping it in the DOM costs nothing and avoids a layout jump on
         * first open.
         */}
        <div
          id={panelId}
          data-choice-panel
          hidden={!open.value}
          class="border-line bg-surface absolute top-full left-0 z-20 mt-2 flex min-w-max flex-col gap-1 rounded-xl border p-2 shadow-lg"
        >
          <span class="eyebrow px-2 pt-1 pb-1">where?</span>
          {choices.map((c) => (
            <a
              key={c.href}
              href={c.href}
              rel="me noopener"
              class="hover:border-accent border-line flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm no-underline"
            >
              <span class="text-accent font-mono text-xs">→</span>
              {c.label}
            </a>
          ))}
        </div>
      </div>
    );
  },
);
