import { component$, useStyles$ } from "@qwik.dev/core";

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
 */
export const StreamText = component$<Props>(({ text, stagger = 55, caret = false }) => {
  useStyles$(`
    .st { display: inline; }
    .st-w {
      display: inline-block;
      opacity: 0;
      filter: blur(4px);
      transform: translateY(0.15em);
      animation: st-in 420ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
    }
    @keyframes st-in {
      to { opacity: 1; filter: blur(0); transform: none; }
    }
    .st-caret {
      display: inline-block;
      width: 0.5ch;
      background: var(--accent);
      margin-left: 0.15ch;
      animation: st-blink 1.1s step-end infinite;
      /* Sit on the text baseline rather than stretching the line box. */
      height: 1em;
      vertical-align: -0.15em;
    }
    @keyframes st-blink { 50% { opacity: 0; } }

    /* Reduced motion: text is already in the DOM, so just show it. */
    @media (prefers-reduced-motion: reduce) {
      .st-w { opacity: 1; filter: none; transform: none; animation: none; }
      .st-caret { animation: none; }
    }
  `);

  // Keep whitespace as its own entries so spacing survives inline-block words.
  const parts = text.split(/(\s+)/);

  return (
    <span class="st">
      {parts.map((part, i) =>
        part.trim() === "" ? (
          part
        ) : (
          <span key={i} class="st-w" style={{ animationDelay: `${i * stagger}ms` }}>
            {part}
          </span>
        ),
      )}
      {caret && <span class="st-caret" aria-hidden="true" />}
    </span>
  );
});
