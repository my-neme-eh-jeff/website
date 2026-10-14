import { component$, Slot } from "@qwik.dev/core";
import { Link, useLocation } from "@qwik.dev/router";
import { longDate } from "~/components/blog/date";
import { posts } from "~/content/profile";

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
            <span class="text-accent ml-1 font-mono text-xs" aria-hidden="true">
              ↗
            </span>
          </a>
        )}
      </p>

      <article class="post">
        <Slot />
      </article>
    </div>
  );
});
