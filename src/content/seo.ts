/**
 * Meta tags and JSON-LD, built only from profile.ts: Google's structured-data
 * policy forbids describing content the page doesn't show.
 */
import { profile, posts, type Post } from "./profile.ts";

/** Also `origin` in adapters/ssg/vite.config.ts. Change both together. */
export const ORIGIN = "https://amannambisan.com";

/**
 * JSON.stringify doesn't escape "<", so "</script>" in a value would end the
 * ld+json tag. `\u003c` is valid JSON and inert HTML.
 */
export const ld = (obj: unknown) =>
  JSON.stringify(obj).replace(/</g, "\\u003c");

/** From the X profile in sameAs, so the handle has one source. */
export const xHandle = profile.sameAs
  .map((u) => u.match(/^https:\/\/(?:x|twitter)\.com\/(\w{1,15})\/?$/)?.[1])
  .find(Boolean);

type SeoInput = {
  /** Route path with leading and trailing slash, e.g. "/blog/". */
  path: string;
  title: string;
  description: string;
  /** A page with a video must be video.*, or Discord won't play it. */
  ogType?: "profile" | "website" | "article" | "video.other";
  /** Overrides profile.ogImage. Must be a 1200x630 file under public/. */
  image?: { src: string; alt: string };
  /**
   * A 1200x630 MP4 under public/. Messages plays it in the preview (TN3156,
   * rev. 2024-04-30, read 2026-10-24); the og:image stays for platforms that
   * only show a still.
   */
  video?: string;
};

/**
 * Emits no canonical: root.tsx writes one on every page, and a route's
 * DocumentHead `links` add to the page rather than replace (@qwik.dev/router
 * rc.3, 2026-10-16), so a second would conflict.
 */
export function seoMeta({
  path,
  title,
  description,
  ogType = "website",
  image,
  video,
}: SeoInput) {
  const url = `${ORIGIN}${path}`;

  const meta: Array<Record<string, string>> = [
    { name: "description", content: description },
    { name: "author", content: profile.name },
    // Discover shows a large image only with this opt-in (Google robots
    // meta doc, updated 2026-03-09, read 2026-10-24).
    { name: "robots", content: "max-image-preview:large" },

    { property: "og:site_name", content: profile.name },
    { property: "og:type", content: ogType },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:locale", content: "en_IN" },

    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    ...(xHandle
      ? [
          { name: "twitter:site", content: `@${xHandle}` },
          { name: "twitter:creator", content: `@${xHandle}` },
        ]
      : []),
  ];

  const src = image?.src ?? profile.ogImage;
  if (src) {
    const img = `${ORIGIN}${src}`;
    const alt =
      image?.alt ??
      `${profile.name}${profile.jobTitle ? `, ${profile.jobTitle}` : ""}`;
    meta.push(
      { property: "og:image", content: img },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: alt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: img },
      { name: "twitter:image:alt", content: alt },
    );
  } else {
    meta.push({ name: "twitter:card", content: "summary" });
  }

  if (video) {
    const mp4 = `${ORIGIN}${video}`;
    meta.push(
      { property: "og:video", content: mp4 },
      { property: "og:video:secure_url", content: mp4 },
      { property: "og:video:type", content: "video/mp4" },
      { property: "og:video:width", content: "1200" },
      { property: "og:video:height", content: "630" },
    );
  }

  return meta;
}

const personNode = () => ({
  "@type": "Person",
  "@id": `${ORIGIN}/#person`,
  name: profile.name,
  url: `${ORIGIN}/`,
  ...(profile.jobTitle ? { jobTitle: profile.jobTitle } : {}),
  ...(profile.tagline ? { description: profile.tagline } : {}),
  ...(profile.ogImage ? { image: `${ORIGIN}${profile.ogImage}` } : {}),
  ...(profile.knowsAbout.length ? { knowsAbout: [...profile.knowsAbout] } : {}),
  ...(profile.employer
    ? {
        worksFor: {
          "@type": "Organization",
          name: profile.employer.name,
          url: profile.employer.url,
        },
      }
    : {}),
  ...(profile.city
    ? {
        address: {
          "@type": "PostalAddress",
          addressLocality: profile.city,
          addressCountry: "IN",
        },
      }
    : {}),
  ...(profile.sameAs.length ? { sameAs: [...profile.sameAs] } : {}),
});

/** No SearchAction: Google retired the sitelinks search box in late 2024. */
export const homeGraph = () => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      url: `${ORIGIN}/`,
      name: profile.name,
      inLanguage: "en",
      publisher: { "@id": `${ORIGIN}/#person` },
    },
    {
      "@type": "ProfilePage",
      "@id": `${ORIGIN}/#profilepage`,
      url: `${ORIGIN}/`,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      // Google requires mainEntity on a ProfilePage.
      mainEntity: { "@id": `${ORIGIN}/#person` },
      inLanguage: "en",
    },
    personNode(),
  ],
});

export const privacyGraph = () => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${ORIGIN}/privacy/#webpage`,
      url: `${ORIGIN}/privacy/`,
      name: `Privacy — ${profile.name}`,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      inLanguage: "en",
    },
  ],
});

const postUrl = (p: Post) => `${ORIGIN}/blog/${p.slug}/`;

const postingNode = (p: Post) => ({
  "@type": "BlogPosting",
  "@id": `${postUrl(p)}#post`,
  url: postUrl(p),
  mainEntityOfPage: postUrl(p),
  headline: p.title,
  datePublished: p.date,
  description: p.summary,
  author: { "@id": `${ORIGIN}/#person` },
  inLanguage: "en",
});

export const blogGraph = () => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Blog",
      "@id": `${ORIGIN}/blog/#blog`,
      url: `${ORIGIN}/blog/`,
      name: `Blog — ${profile.name}`,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      author: { "@id": `${ORIGIN}/#person` },
      inLanguage: "en",
      blogPost: posts.map(postingNode),
    },
    personNode(),
  ],
});

/**
 * A post's `head`, from its entry in profile.ts: in the MDX,
 * `export const head = postHead("<slug>")`. An unknown slug fails the build.
 */
export function postHead(slug: string) {
  const p = posts.find((x) => x.slug === slug);
  if (!p) throw new Error(`No post "${slug}" in profile.ts posts`);
  return {
    title: `${p.title} — ${profile.name}`,
    meta: [
      // No name in the share title: Messages and Facebook both say leave it
      // to og:site_name (TN3156; Facebook's webmasters guide, read 2026-10-24).
      ...seoMeta({
        path: `/blog/${p.slug}/`,
        title: p.title,
        description: p.summary,
        ogType: "article",
        ...(p.cover ? { image: p.cover } : {}),
      }),
      { property: "article:published_time", content: p.date },
      // Slack shows these under the title (its 2015 unfurling post; Discord
      // ignores them).
      { name: "twitter:label1", content: "Written by" },
      { name: "twitter:data1", content: profile.name },
      { name: "twitter:label2", content: "Reading time" },
      { name: "twitter:data2", content: `${p.minutes} min read` },
    ],
    scripts: [
      {
        type: "application/ld+json",
        key: "ld-post",
        dangerouslySetInnerHTML: ld({
          "@context": "https://schema.org",
          "@graph": [
            {
              ...postingNode(p),
              isPartOf: { "@id": `${ORIGIN}/blog/#blog` },
              ...((p.cover?.src ?? profile.ogImage)
                ? { image: `${ORIGIN}${p.cover?.src ?? profile.ogImage}` }
                : {}),
            },
            personNode(),
          ],
        }),
      },
    ],
  };
}
