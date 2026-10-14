import {
  $,
  component$,
  useId,
  useOn,
  useOnWindow,
  useSignal,
  untrack,
} from "@qwik.dev/core";
import { useContent } from "@qwik.dev/router";

/**
 * The post's sections as checkpoints in the left margin. Sections already
 * read fill in, and the one being read is lit. Shown from `xl`, the first
 * width where the centred column leaves room for it.
 */
export const Checkpoints = component$(() => {
  // Untracked, as in contents.tsx, which says why.
  const content = useContent();
  const sections = untrack(() =>
    (content.headings ?? [])
      .filter((h) => h.level === 2)
      .map(({ id, text }) => ({ id, text })),
  );
  const at = useSignal(-1);
  const label = useId();

  // The section being read is the last one whose heading has reached the top
  // third of the window. At the very bottom it is the last section, which is
  // too short to scroll that far up.
  const update = $(() => {
    const tops = [...document.querySelectorAll(".post > h2[id]")].map(
      (h) => h.getBoundingClientRect().top,
    );
    const bottom =
      scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    at.value = bottom
      ? tops.length - 1
      : tops.filter((t) => t <= innerHeight / 3).length - 1;
  });
  useOn("qvisible", update);
  useOnWindow("scroll", update);

  if (sections.length === 0) return null;

  return (
    <nav aria-labelledby={label} class="sticky top-10">
      <p id={label} class="eyebrow mb-4">
        On this page
      </p>
      <ol class="grid gap-3">
        {sections.map((s, i) => (
          <li key={s.id} class="relative pl-5">
            {i < sections.length - 1 && (
              <span
                aria-hidden="true"
                class={[
                  "absolute top-[calc(0.3rem+7px)] left-[3px] h-[calc(100%-7px+0.75rem)] w-px",
                  i < at.value ? "bg-accent" : "bg-muted/40",
                ]}
              />
            )}
            <span
              aria-hidden="true"
              class={[
                "absolute top-[0.3rem] left-0 size-[7px] rounded-full border",
                i < at.value && "border-accent bg-accent",
                i === at.value &&
                  "border-accent bg-accent ring-accent/25 ring-4",
                i > at.value && "border-muted bg-bg",
              ]}
            />
            <a
              href={`#${s.id}`}
              aria-current={i === at.value ? "location" : undefined}
              class={[
                "line-clamp-2 text-xs leading-snug no-underline",
                i === at.value ? "text-text" : "text-muted hover:text-text",
              ]}
            >
              {s.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
});
