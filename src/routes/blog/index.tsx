import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { posts, profile } from "~/content/profile";
import { blogGraph, ld, seoMeta } from "~/content/seo";

// Sorted once at module scope, not per render — see Qwik best practices.
const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

export default component$(() => {
  return (
    <div class="wrap">
      <div class="max-w-measure">
        <h1 class="mb-6">Writing</h1>
        {sorted.length === 0 ? (
          <div class="callout">
            Nothing published yet. When there is, it will be here — the list is
            empty rather than filled with a placeholder, because a fake post is
            indexable and a missing one is not.
          </div>
        ) : (
          sorted.map((p) => (
            <article class="hairline" key={p.slug}>
              <h2 class="mb-1 text-lg">{p.title}</h2>
              <div class="text-muted text-sm">{p.date}</div>
              <p class="text-muted mt-1 mb-0">{p.summary}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: `Writing — ${profile.name}`,
  meta: seoMeta({
    path: "/blog/",
    title: `Writing — ${profile.name}`,
    description: `Technical writing by ${profile.name}.`,
  }),
  scripts: [
    {
      type: "application/ld+json",
      key: "ld-blog",
      dangerouslySetInnerHTML: ld(blogGraph()),
    },
  ],
};
