import { component$, useSignal, $ } from "@qwik.dev/core";

/**
 * "Email" in the "say hi" menu: a mailto: link, and a button that copies the
 * address. A mailto: link does nothing on a machine with no mail handler,
 * which is most Macs whose owner reads mail in a browser, so the copy button
 * is the way through there. The link's title shows the address on hover.
 *
 * The button relabels itself rather than showing a toast, like the shell's
 * mute button: the control that was activated is the thing that reports
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
    <span class="flex items-center gap-1">
      <a
        class="hover:bg-line text-text flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm no-underline"
        href={`mailto:${email}`}
        title={email}
      >
        <svg
          viewBox="0 0 16 16"
          class="text-muted size-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
          <path d="M2 4.5l6 4.5 6-4.5" />
        </svg>
        Email
      </a>
      <button
        type="button"
        onClick$={copy}
        class="hover:bg-line text-muted hover:text-text grid size-8 shrink-0 place-items-center rounded-lg transition duration-150 active:scale-90"
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
