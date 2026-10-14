import { component$ } from "@qwik.dev/core";
import type { FunctionComponent, QwikIntrinsicElements } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { longDate } from "~/components/blog/date";
import { posts, profile } from "~/content/profile";
import { blogGraph, ld, seoMeta } from "~/content/seo";

// Sorted once at module scope, not per render — see Qwik best practices.
const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

/*
 * Each row's cover through Qwik's `?jsx` image import: WebP at five widths
 * with a srcset, from the same public/ JPEG that stays the og:image. The
 * thumbnail is at most 18rem wide, so browsers take a 6 or 11 kB file where
 * they used to download the 98 kB, 1200px JPEG.
 */
type ImgProps = Omit<
  QwikIntrinsicElements["img"],
  "src" | "width" | "height" | "srcSet"
>;
const covers = import.meta.glob<FunctionComponent<ImgProps>>(
  "/public/blog/*/cover.jpg",
  { query: "?jsx", import: "default", eager: true },
);
const Cover = ({ src, ...props }: ImgProps & { src: string }) => {
  const Img = covers[`/public${src}`];
  return Img ? <Img {...props} /> : null;
};

export default component$(() => {
  return (
    <div>
      <h1 class="mb-10">Blog</h1>
      {sorted.length === 0 ? (
        <div class="callout">
          Nothing published yet. When there is, it will be here — the list is
          empty rather than filled with a placeholder, because a fake post is
          indexable and a missing one is not.
        </div>
      ) : (
        <ul class="border-line border-b">
          {sorted.map((p) => (
            /*
             * One link per row, named by the title alone. Its ::after covers
             * the row, so the date and summary click through too, without a
             * screen reader announcing the whole row as the link text.
             */
            <li
              key={p.slug}
              class="hairline group has-[:focus-visible]:outline-accent relative items-center gap-x-10 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 sm:grid sm:grid-cols-[minmax(0,1fr)_14rem] lg:grid-cols-[minmax(0,1fr)_18rem]"
            >
              <div class="max-w-[32rem]">
                <time dateTime={p.date} class="text-muted font-mono text-xs">
                  {longDate(p.date)}
                </time>
                <h2 class="mt-1.5 mb-1.5 text-lg">
                  <Link
                    href={`/blog/${p.slug}/`}
                    class="group-hover:decoration-accent no-underline group-hover:underline after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {p.title}
                  </Link>
                </h2>
                <p class="text-muted m-0 text-[0.9375rem] leading-normal">
                  {p.summary}
                </p>
              </div>
              {p.cover && (
                <Cover
                  src={p.cover.src}
                  alt=""
                  sizes="(min-width: 64rem) 18rem, (min-width: 40rem) 14rem, 11rem"
                  loading="lazy"
                  decoding="async"
                  class="peek mt-5 w-44 sm:absolute sm:inset-y-0 sm:right-0 sm:my-auto sm:w-56 lg:w-72"
                />
              )}
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
