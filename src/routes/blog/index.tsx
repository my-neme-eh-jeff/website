import { component$, sync$ } from "@qwik.dev/core";
import type { FunctionComponent, QwikIntrinsicElements } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link } from "@qwik.dev/router";
import { longDate } from "~/components/blog/date";
import { posts, profile } from "~/content/profile";
import { blogGraph, ld, seoMeta } from "~/content/seo";

const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));

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

// Not under public/, which would ship the PNG too; only its WebP is shown.
const backdrops = import.meta.glob<FunctionComponent<ImgProps>>(
  "/src/content/backdrops/*.png",
  { query: "?jsx", import: "default", eager: true },
);
const Backdrop = ({
  slug,
  src,
  ...props
}: ImgProps & { slug: string; src: string }) => {
  const Img =
    backdrops[`/src/content/backdrops/${slug}.png`] ?? covers[`/public${src}`];
  return Img ? <Img {...props} /> : null;
};

// Inline (sync$), so the lean follows the first pointer move, not a bundle load.
const lean = sync$((e: PointerEvent, list: HTMLElement) => {
  if (e.pointerType !== "mouse") return;
  const r = list.getBoundingClientRect();
  const s = list.style;
  s.setProperty(
    "--lean-x",
    (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3),
  );
  s.setProperty(
    "--lean-y",
    (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3),
  );
});

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
        <ul class="covers border-line border-b" onPointerMove$={lean}>
          {sorted.map((p) => (
            /*
             * One link per row, named by the title alone; its ::after covers
             * the row, so the rest clicks through without becoming link text.
             */
            <li
              key={p.slug}
              class="hairline group has-[:focus-visible]:outline-accent relative gap-x-10 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 sm:grid sm:grid-cols-[minmax(0,1fr)_14rem] lg:grid-cols-[minmax(0,1fr)_17rem]"
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
                <>
                  <span class="cover" aria-hidden="true">
                    <Cover
                      src={p.cover.src}
                      alt=""
                      sizes="11rem"
                      loading="lazy"
                      decoding="async"
                      class="block h-auto w-full"
                    />
                  </span>
                  <span class="backdrop" aria-hidden="true">
                    <Backdrop
                      slug={p.slug}
                      src={p.cover.src}
                      alt=""
                      sizes="(min-width: 64rem) 17rem, 14rem"
                      loading="lazy"
                      decoding="async"
                      class="block"
                    />
                  </span>
                </>
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
