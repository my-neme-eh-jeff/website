import { component$, useSignal, $ } from "@qwik.dev/core";

/**
 * A mailto: link does nothing without a mail handler (most Macs whose owner
 * reads mail in a browser), so the address can be copied too.
 * The button keeps one name and a status region says it copied: a focused
 * button being renamed is not reliably announced.
 */
/**
 * Where the Clipboard API is refused (insecure origins, some webviews), the
 * older copy command may still work. Selecting moves focus, so it goes back.
 */
function copyByCommand(text: string): boolean {
  const back = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok: boolean;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  back?.focus();
  return ok;
}

export const CopyEmail = component$<{ email: string }>(({ email }) => {
  const copied = useSignal(false);
  const refused = useSignal(false);

  const copy = $(async () => {
    // Inside then(): without a Clipboard API, the call throws, not rejects.
    const ok = await Promise.resolve()
      .then(() => navigator.clipboard.writeText(email))
      .then(
        () => true,
        () => copyByCommand(email),
      );
    copied.value = ok;
    refused.value = !ok;
    if (ok) setTimeout(() => (copied.value = false), 2000);
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
        <span class="sr-only">Copy email address</span>
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
      <span role="status" class="sr-only">
        {copied.value
          ? "Email address copied"
          : refused.value
            ? `This browser wouldn't copy. The address is ${email}`
            : ""}
      </span>
    </span>
  );
});
