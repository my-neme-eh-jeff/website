import {
  component$,
  sync$,
  untrack,
  useId,
  useOn,
  useOnWindow,
} from "@qwik.dev/core";
import { useContent } from "@qwik.dev/router";

// A sync$ can't write a signal, so it marks the items itself.
const mark = sync$((_: Event, nav: Element) => {
  if (!(nav as HTMLElement).offsetParent) return;
  const items = [...nav.querySelectorAll("li")];
  const at =
    scrollY + innerHeight >= document.documentElement.scrollHeight - 2
      ? items.length - 1
      : items.filter((li) => {
          const href = li.querySelector("a")!.getAttribute("href")!;
          const top = document
            .getElementById(href.slice(1))
            ?.getBoundingClientRect().top;
          return top !== undefined && top <= innerHeight / 3;
        }).length - 1;
  items.forEach((li, i) => {
    const state = i < at ? "read" : i === at ? "now" : null;
    if (li.getAttribute("data-state") === state) return;
    if (state) li.setAttribute("data-state", state);
    else li.removeAttribute("data-state");
    const link = li.querySelector("a")!;
    if (state === "now") link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
});

export const Checkpoints = component$(() => {
  const content = useContent();
  const sections = untrack(() =>
    (content.headings ?? [])
      .filter((h) => h.level === 2)
      .map(({ id, text }) => ({ id, text })),
  );
  const label = useId();

  useOn("qvisible", mark);
  useOnWindow("scroll", mark, { passive: true });

  if (sections.length === 0) return null;

  return (
    <nav aria-labelledby={label} class="sticky top-10">
      <p id={label} class="eyebrow mb-4">
        On this page
      </p>
      <ol class="grid gap-3">
        {sections.map((s, i) => (
          <li key={s.id} class="group relative pl-5">
            {i < sections.length - 1 && (
              <span
                aria-hidden="true"
                class="bg-muted/40 group-data-[state=read]:bg-accent absolute top-[calc(0.3rem+7px)] left-[3px] h-[calc(100%-7px+0.75rem)] w-px"
              />
            )}
            <span
              aria-hidden="true"
              class="border-muted bg-bg group-data-state:border-accent group-data-state:bg-accent group-data-[state=now]:ring-accent/25 absolute top-[0.3rem] left-0 size-[7px] rounded-full border group-data-[state=now]:ring-4"
            />
            <a
              href={`#${s.id}`}
              class="text-muted hover:text-text aria-[current=location]:text-text line-clamp-2 text-xs leading-snug no-underline"
            >
              {s.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
});
