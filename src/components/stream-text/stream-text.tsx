import { component$ } from "@qwik.dev/core";

type Props = {
  text: string;
  /** ms of delay added per word. */
  stagger?: number;
  /** Show a blinking caret after the last word. */
  caret?: boolean;
};

/**
 * Token-stream reveal, done in CSS on purpose.
 *
 * A JS typewriter would start from an empty string, so the prerendered HTML
 * would contain no text — bad for SEO and for anyone without JS, which
 * defeats the point of building this statically. Here the full text ships in
 * the HTML and CSS only animates its arrival.
 *
 * The keyframes are `--animate-token-in` and `--animate-caret` in global.css,
 * so the animation is a named token rather than a per-component style block.
 * The reduced-motion fallback is per-element (`motion-reduce:`) because the
 * text is already in the DOM — it just needs to be shown, not animated.
 */
export const StreamText = component$<Props>(
  ({ text, stagger = 55, caret = false }) => {
    // Keep whitespace as its own entries so spacing survives inline-block words.
    const parts = text.split(/(\s+)/);

    return (
      <span class="inline">
        {parts.map((part, i) =>
          part.trim() === "" ? (
            part
          ) : (
            <span
              key={i}
              class="animate-token-in inline-block translate-y-[0.15em] opacity-0 blur-[4px] motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:blur-none"
              style={{ animationDelay: `${i * stagger}ms` }}
            >
              {part}
            </span>
          ),
        )}
        {caret && (
          <span
            class="animate-caret bg-accent ml-[0.15ch] inline-block h-[1em] w-[0.5ch] align-[-0.15em]"
            aria-hidden="true"
          />
        )}
      </span>
    );
  },
);
