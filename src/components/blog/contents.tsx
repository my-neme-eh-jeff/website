import { component$, untrack } from "@qwik.dev/core";
import { useContent } from "@qwik.dev/router";

export const Contents = component$(() => {
  // Untracked, into plain objects: subscribed, Qwik rc.3 serialises the
  // headings again and empties an open list in the leaving page's snapshot.
  const content = useContent();
  const sections = untrack(() =>
    (content.headings ?? [])
      .filter((h) => h.level === 2)
      .map(({ id, text }) => ({ id, text })),
  );
  return (
    <details class="post-text text-muted my-10 text-sm xl:hidden">
      <summary class="hover:text-text w-fit cursor-pointer py-1">
        Contents
      </summary>
      <ol class="marker:text-accent mt-2 grid list-decimal gap-1 pl-5 leading-6">
        {sections.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ol>
    </details>
  );
});
