import { component$, untrack } from "@qwik.dev/core";
import { useContent } from "@qwik.dev/router";

/**
 * A post's sections, from the headings Qwik Router collects out of the MDX.
 * Placed in the post after its intro, not in the layout, so it is read after
 * the title. Closed by default: a long list before the first section is a
 * screenful on a phone.
 */
export const Contents = component$(() => {
  /*
   * Read untracked, into plain objects: each post renders its own list, so it
   * never needs to update. Subscribed, it serialized the headings again with
   * their subscriptions, and emptied an open list in the leaving page's
   * snapshot when navigating away.
   */
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
