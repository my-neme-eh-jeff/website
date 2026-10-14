import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { longDate } from "~/components/blog/date";
import { posts, profile } from "~/content/profile";
import { blogGraph, ld, seoMeta } from "~/content/seo";

// Sorted once at module scope, not per render — see Qwik best practices.
const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

export default component$(() => {
  return (
    <div class="post-text">
      <h1 class="mb-8">Blog</h1>
      {sorted.length === 0 ? (
        <div class="callout">
          Nothing published yet. When there is, it will be here — the list is
          empty rather than filled with a placeholder, because a fake post is
          indexable and a missing one is not.
        </div>
      ) : (
        <ul class="grid gap-8">
          {sorted.map((p) => (
            /*
             * One link per card, named by the title alone. Its ::after covers
             * the card, so the cover and summary click through too, without a
             * screen reader announcing the whole card as the link text.
             */
            <li
              key={p.slug}
              class="border-line bg-surface hover:border-accent/50 has-[:focus-visible]:outline-accent relative overflow-hidden rounded-2xl border transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2"
            >
              {p.cover && (
                <img
                  src={p.cover.src}
                  alt=""
                  width={1200}
                  height={630}
                  decoding="async"
                  class="border-line block h-auto w-full border-b"
                />
              )}
              <div class="p-5 sm:p-6">
                <time dateTime={p.date} class="text-muted text-sm">
                  {longDate(p.date)}
                </time>
                <h2 class="mt-1 mb-2">
                  <Link
                    href={`/blog/${p.slug}/`}
                    class="no-underline after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {p.title}
                  </Link>
                </h2>
                <p class="text-muted m-0 text-[0.9375rem] leading-normal">
                  {p.summary}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export const head: DocumentHead = {
  title: `Blog — ${profile.name}`,
  meta: seoMeta({
    path: "/blog/",
    title: `Blog — ${profile.name}`,
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
