import { component$ } from "@qwik.dev/core";
import { useContent } from "@qwik.dev/router";

/**
 * A post's sections, from the headings Qwik Router collects out of the MDX.
 * Placed in the post after its intro, not in the layout, so it is read after
 * the title. Closed by default: a long list before the first section is a
 * screenful on a phone.
 */
export const Contents = component$(() => {
  const content = useContent();
  const sections = (content.headings ?? []).filter((h) => h.level === 2);
  return (
    <details class="post-text text-muted my-10 text-sm">
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
