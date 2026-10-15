import { component$ } from "@qwik.dev/core";
import { posts } from "~/content/profile";
import { longDate } from "./date";

/** The date, reading time and source under a post's standfirst. */
export const Byline = component$<{ slug: string }>(({ slug }) => {
  const post = posts.find((p) => p.slug === slug);
  if (!post) return null;
  return (
    <p class="text-muted mt-5 mb-10 flex flex-wrap items-baseline gap-x-2 text-sm">
      <time dateTime={post.date}>{longDate(post.date)}</time>
      <span aria-hidden="true">·</span>
      <span>{post.minutes} min read</span>
      {post.repo && (
        <>
          <span aria-hidden="true">·</span>
          <a href={post.repo} class="hover:text-text no-underline">
            Source on GitHub
            <span
              class="text-accent font-arrow ml-1 text-xs"
              aria-hidden="true"
            >
              ↗
            </span>
          </a>
        </>
      )}
    </p>
  );
});
