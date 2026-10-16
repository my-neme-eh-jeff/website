import {
  component$,
  sync$,
  useId,
  useOn,
  useOnDocument,
  useSignal,
  $,
} from "@qwik.dev/core";
import { CopyEmail } from "~/components/copy-email";
import { profile } from "~/content/profile";

/** The profile links that sit under "say hi" rather than in the header row. */
export const SAY_HI = ["LinkedIn", "X"];

/** Simple Icons (CC0), 24x24: https://github.com/simple-icons/simple-icons */
const ICONS: Record<string, string> = {
  LinkedIn:
    "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  X: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
};

/**
 * A hand-drawn circle around a label that opens the ways to reach him.
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
      const panel = el.querySelector<HTMLElement>("[data-choice-panel]");
      if (!panel || panel.hidden) return;
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

    const choices = profile.links.filter((l) => SAY_HI.includes(l.label));

    return (
      <div class="relative inline-block" data-circled-choice>
        <button
          ref={button}
          type="button"
          aria-expanded={open.value}
          aria-controls={panelId}
          onClick$={() => (open.value = !open.value)}
          class="text-text relative inline-flex cursor-pointer items-center border-0 bg-transparent px-3 py-1 text-sm"
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
         * `hidden` rather than conditional rendering: the panel is three
         * links, so keeping it in the DOM costs nothing, and rel="me" stays in
         * the HTML for anything verifying the profiles.
         */}
        <div
          id={panelId}
          data-choice-panel
          hidden={!open.value}
          class="border-line bg-surface absolute top-full right-0 z-20 mt-2 flex min-w-max flex-col gap-0.5 rounded-xl border p-1.5 shadow-lg"
        >
          {choices.map((c) => (
            <a
              key={c.href}
              href={c.href}
              rel="me noopener"
              class="hover:bg-line text-text flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm no-underline"
            >
              <svg
                viewBox="0 0 24 24"
                class="text-muted size-3.5 shrink-0"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d={ICONS[c.label]} />
              </svg>
              {c.label}
            </a>
          ))}
          <CopyEmail email={profile.email} />
        </div>
      </div>
    );
  },
);
