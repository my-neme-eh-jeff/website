import { component$, Slot } from "@qwik.dev/core";
import type { DocumentHeadValue } from "@qwik.dev/router";
import { useDocumentHead } from "@qwik.dev/router";
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
  // `doc`, not `head`: why in src/routes/layout.tsx.
  const doc = useDocumentHead<Frontmatter>();
  return (
    <div>
      <div class="relative">
        <aside class="absolute inset-y-0 right-full mr-[clamp(3rem,5vw_-_1rem,5rem)] hidden w-44 xl:block">
          {/*
           * Keyed per page: this layout stays mounted from one post to the
           * next, and the rail reads its sections once. From head, which the
           * router updates after capturing the page being left, so that page
           * keeps its rail in the transition.
           */}
          <Checkpoints key={doc.frontmatter.transitionName} />
        </aside>
        <article class="post">
          <Slot />
        </article>
      </div>
    </div>
  );
});
