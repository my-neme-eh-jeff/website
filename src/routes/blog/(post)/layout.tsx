import { component$, Slot } from "@qwik.dev/core";
import { Link, useLocation } from "@qwik.dev/router";
import { longDate } from "~/components/blog/date";
import { posts } from "~/content/profile";

export default component$(() => {
  const slug = useLocation().url.pathname.split("/")[2];
  const post = posts.find((p) => p.slug === slug);

  return (
    <div>
      <p class="text-muted mb-8 flex flex-wrap items-baseline gap-x-3 text-sm">
        <Link href="/blog/" class="hover:text-text no-underline">
          <span aria-hidden="true">← </span>Writing
        </Link>
        {post && <time dateTime={post.date}>{longDate(post.date)}</time>}
      </p>

      <article class="post">
        <Slot />
      </article>

      {post?.repo && (
        <p class="hairline text-muted mt-16 text-sm">
          The code is in{" "}
          <a href={post.repo} class="text-text">
            {new URL(post.repo).pathname.split("/").slice(1, 3).join("/")}
          </a>
          .
        </p>
      )}
    </div>
  );
});
