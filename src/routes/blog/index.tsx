import { component$, sync$ } from "@qwik.dev/core";
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

/*
 * Where a mouse is over the list, the hovered row's cover is carried by its
 * top-left corner in place of the pointer, and swings with sideways speed.
 * Inline (sync$), so it moves with the first event instead of after a bundle
 * loads. It only writes custom properties; global.css draws the sticker.
 */
const carry = sync$(
  (e: PointerEvent, list: HTMLElement & { _x?: number; _rest?: number }) => {
    if (e.pointerType !== "mouse") return;
    const s = list.style;
    const swing = Math.max(
      -14,
      Math.min(14, (e.clientX - (list._x ?? e.clientX)) * 0.9),
    );
    list._x = e.clientX;
    s.setProperty("--x", `${e.clientX}px`);
    s.setProperty("--y", `${e.clientY}px`);
    s.setProperty("--swing", `${swing}deg`);
    clearTimeout(list._rest);
    list._rest = window.setTimeout(() => s.setProperty("--swing", "0deg"), 90);
  },
);

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
        <ul
          class="stickers border-line border-b"
          onPointerMove$={carry}
          onPointerOver$={carry}
        >
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
                <p class="text-muted m-0 font-mono text-xs">
                  <time dateTime={p.date}>{longDate(p.date)}</time>
                  <span aria-hidden="true"> · </span>
                  {p.minutes} min read
                </p>
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
                <span class="sticker" aria-hidden="true">
                  <span class="sticker-face">
                    <Cover
                      src={p.cover.src}
                      alt=""
                      sizes="(min-width: 64rem) 16rem, (min-width: 40rem) 14rem, 11rem"
                      loading="lazy"
                      decoding="async"
                      class="block h-auto w-full"
                    />
                  </span>
                </span>
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
