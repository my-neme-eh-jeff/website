import { component$, Slot } from "@qwik.dev/core";
import type { DocumentHeadValue } from "@qwik.dev/router";
import { Checkpoints } from "~/components/blog/checkpoints";
import type { Frontmatter } from "../../layout";

/*
 * Posts are read in the centred column; the /blog/ index is not, so this is
 * set here rather than on the whole of /blog/. Why it is head and not the URL:
 * src/routes/layout.tsx.
 */
export const head: DocumentHeadValue<Frontmatter> = {
  frontmatter: { column: "reading" },
};

export default component$(() => {
  return (
    <div>
      <div class="relative">
        <aside class="absolute inset-y-0 right-full mr-[clamp(3rem,5vw_-_1rem,5rem)] hidden w-44 xl:block">
          <Checkpoints />
        </aside>
        <article class="post">
          <Slot />
        </article>
      </div>
    </div>
  );
});
