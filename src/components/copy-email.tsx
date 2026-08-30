import { component$, useSignal, $ } from "@qwik.dev/core";

/**
 * The email address, shown and copyable.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: A mailto: LINK IS NOT A CONTACT METHOD
 *
 * The hero used to offer a pill reading "Email" whose whole behaviour was a
 * `mailto:` href. On any machine with no default mail handler registered —
 * which is most macOS installs where the owner reads mail in a browser, plus
 * plenty of Windows ones — clicking that does NOTHING. No error, no new tab,
 * no clue. The address was never on the page in a form anyone could read or
 * copy, so a visitor whose click silently failed had no way to reach me at
 * all, and no reason to think anything had gone wrong.
 *
 * So the address is now the link text: even when the click is a no-op, the
 * thing you needed is on screen and selectable. The copy button is the
 * convenience on top, not the fix.
 *
 * No new exposure. The address was already in the href, in the HTML, on every
 * page load — this only makes it legible to humans as well as to scrapers.
 *
 * ---------------------------------------------------------------------------
 * The button relabels itself rather than showing a toast, matching the shell's
 * traffic lights: the control that was activated is the thing that reports
 * back, so focus never moves and a screen reader hears the change on the
 * element it is already on.
 */
export const CopyEmail = component$<{ email: string }>(({ email }) => {
  const copied = useSignal(false);

  const copy = $(async () => {
    try {
      await navigator.clipboard.writeText(email);
      copied.value = true;
      // Long enough to read, short enough that the button does not look stuck.
      setTimeout(() => (copied.value = false), 2000);
    } catch {
      /*
       * Clipboard access is refused on insecure origins and in some embedded
       * webviews. The address is visible next to this button either way, which
       * is the entire reason it is visible — so a failure here costs nothing
       * and must not be reported as an error.
       */
    }
  });

  return (
    <span class="inline-flex items-center gap-1">
      <a class="pill hover:border-accent font-mono" href={`mailto:${email}`}>
        {email}
      </a>
      <button
        type="button"
        onClick$={copy}
        class="hover:border-accent text-muted hover:text-text grid size-9 place-items-center rounded-full border border-transparent transition duration-150 active:scale-90"
      >
        <span class="sr-only">
          {copied.value ? "Email address copied" : "Copy email address"}
        </span>
        {copied.value ? (
          <svg
            viewBox="0 0 16 16"
            class="text-accent size-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 16 16"
            class="size-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 3.5H3.5a1 1 0 00-1 1v7" />
          </svg>
        )}
      </button>
    </span>
  );
});
