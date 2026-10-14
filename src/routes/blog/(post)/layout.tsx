import { component$, Slot } from "@qwik.dev/core";
import type { DocumentHeadValue } from "@qwik.dev/router";
import { Link, useLocation } from "@qwik.dev/router";
import { Checkpoints } from "~/components/blog/checkpoints";
import { longDate } from "~/components/blog/date";
import { posts } from "~/content/profile";
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
  const slug = useLocation().url.pathname.split("/")[2];
  const post = posts.find((p) => p.slug === slug);

  return (
    <div>
      <p class="text-muted post-text mb-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <Link href="/blog/" class="hover:text-text no-underline">
          <span aria-hidden="true">← </span>Blog
        </Link>
        {post && <time dateTime={post.date}>{longDate(post.date)}</time>}
        {post?.repo && (
          <a href={post.repo} class="hover:text-text no-underline">
            Source on GitHub
            <span
              class="text-accent font-arrow ml-1 text-xs"
              aria-hidden="true"
            >
              ↗
            </span>
          </a>
        )}
      </p>

      <div class="relative">
        <aside class="absolute inset-y-0 right-full mr-8 hidden w-44 xl:block">
          <Checkpoints />
        </aside>
        <article class="post">
          <Slot />
        </article>
      </div>
    </div>
  );
});
