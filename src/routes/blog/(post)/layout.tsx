import { component$, Slot } from "@qwik.dev/core";
import type { DocumentHeadValue } from "@qwik.dev/router";
import { useDocumentHead } from "@qwik.dev/router";
import { Checkpoints } from "~/components/blog/checkpoints";
import type { Frontmatter } from "../../layout";

export const head: DocumentHeadValue<Frontmatter> = {
  frontmatter: { column: "reading" },
};

export default component$(() => {
  // Not `head`: the optimizer counts that name as this module's export, so
  // nothing reading it would become a binding.
  const doc = useDocumentHead<Frontmatter>();
  return (
    <div>
      <div class="relative">
        <aside class="absolute inset-y-0 right-full mr-(--rail-gap) hidden w-(--rail-width) xl:block">
          {/*
           * Keyed from head, which the router updates only after capturing the
           * page being left, so that page keeps its rail in the transition.
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
