import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { longDate } from "~/components/blog/date";
import { posts, profile } from "~/content/profile";
import { blogGraph, ld, seoMeta } from "~/content/seo";

// Sorted once at module scope, not per render.
const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

export default component$(() => {
  return (
    <div class="post-text">
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
            <time dateTime={p.date} class="text-muted text-sm">
              {longDate(p.date)}
            </time>
            <h2 class="mt-1 mb-1 text-lg">
              <Link href={`/blog/${p.slug}/`} class="no-underline">
                {p.title}
              </Link>
            </h2>
            <p class="text-muted mt-1 mb-0">{p.summary}</p>
          </article>
        ))
      )}
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
