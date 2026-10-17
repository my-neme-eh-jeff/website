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

const ink = {
  dim: "text-term-dim",
  cyan: "text-term-cyan",
  yellow: "text-term-yellow",
} as const;

/*
 * Inline (sync$), so the card answers the first pointer move, not a bundle
 * load. Level at the middle of the row's title, leaning out to -1 and 1 at the
 * row's edges. A frame loop eases toward the pointer: a CSS transition
 * restarted on every move began each time from a stale point, and shook.
 */
const lean = sync$((e: PointerEvent) => {
  if (
    e.pointerType !== "mouse" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  const row = (e.target as Element).closest?.("li");
  const title = row?.querySelector("h2 a");
  if (!row || !title) return;
  const r = row.getBoundingClientRect();
  const t = title.getBoundingClientRect();
  const mid = t.left + t.width / 2;
  const dx = e.clientX - mid;
  const reach = Math.max(dx < 0 ? mid - r.left : r.right - mid, r.width / 4);
  const host = row as HTMLElement & {
    lean?: {
      x: number;
      y: number;
      l: number;
      tx: number;
      ty: number;
      at: number;
      frame: number;
    };
  };
  const tx = Math.max(-1, Math.min(1, dx / reach));
  const ty = Math.max(
    -1,
    Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1),
  );
  const style = host.style;
  let s = host.lean;
  if (!s) {
    s = host.lean = { x: tx, y: ty, l: 0, tx, ty, at: 0, frame: 0 };
    style.setProperty("--lean-x", tx.toFixed(4));
    style.setProperty("--lean-y", ty.toFixed(4));
    style.setProperty("--lift", "0");
  }
  s.tx = tx;
  s.ty = ty;
  if (s.frame) return;
  s.at = performance.now();
  const step = (now: number) => {
    const st = host.lean;
    if (!st) return;
    const k = 1 - Math.exp(-Math.min(64, Math.max(0, now - st.at)) / 80);
    st.at = now;
    st.x += (st.tx - st.x) * k;
    st.y += (st.ty - st.y) * k;
    st.l += (1 - st.l) * k;
    style.setProperty("--lean-x", st.x.toFixed(4));
    style.setProperty("--lean-y", st.y.toFixed(4));
    style.setProperty("--lift", st.l.toFixed(4));
    const off = Math.abs(st.tx - st.x) + Math.abs(st.ty - st.y) + 1 - st.l;
    st.frame = off < 0.002 ? 0 : requestAnimationFrame(step);
  };
  s.frame = requestAnimationFrame(step);
});

// Leaving the row drops the loop; the card eases out on its CSS transition.
const settle = sync$((e: PointerEvent) => {
  const row = (e.target as Element).closest?.("li");
  if (!row || row.contains(e.relatedTarget as Node | null)) return;
  const host = row as HTMLElement & { lean?: { frame: number } };
  if (host.lean?.frame) cancelAnimationFrame(host.lean.frame);
  delete host.lean;
  host.style.removeProperty("--lift");
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
        <ul
          class="covers border-line border-b"
          onPointerMove$={lean}
          onPointerOut$={settle}
        >
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
                    {p.glance ? (
                      <span class="glance">
                        <span class="glance-bar">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span class="glance-body">
                          {p.glance.map((line, i) => (
                            <span key={i}>
                              {line.map((part, j) =>
                                typeof part === "string" ? (
                                  part
                                ) : (
                                  <span key={j} class={ink[part[1]]}>
                                    {part[0]}
                                  </span>
                                ),
                              )}
                            </span>
                          ))}
                        </span>
                      </span>
                    ) : (
                      <Cover
                        src={p.cover.src}
                        alt=""
                        sizes="(min-width: 64rem) 17rem, 14rem"
                        loading="lazy"
                        decoding="async"
                        class="block"
                      />
                    )}
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
