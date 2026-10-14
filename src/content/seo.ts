/**
 * SEO and structured-data helpers.
 *
 * Everything here reads from profile.ts, so the markup can never describe
 * content the page doesn't render — which is both a correctness property and
 * what keeps it inside Google's structured-data policy.
 */
import { profile, posts, type Post } from "./profile";

/**
 * NOTE: also hardcoded as `origin` in adapters/ssg/vite.config.ts. The adapter
 * config runs in Vite's context and importing app source into it adds coupling
 * for one string, so the duplication is deliberate. Change both together.
 */
export const ORIGIN = "https://amannambisan.com";

/**
 * JSON.stringify does not escape "<". A value containing "</script>" would
 * otherwise break out of the ld+json tag. Escaping it as < is valid JSON
 * and inert HTML.
 */
export const ld = (obj: unknown) =>
  JSON.stringify(obj).replace(/</g, "\\u003c");

type SeoInput = {
  /** Route path with leading and trailing slash, e.g. "/resume/". */
  path: string;
  title: string;
  description: string;
  ogType?: "profile" | "website" | "article";
};

/**
 * Shared meta for every route.
 *
 * Deliberately does NOT emit a canonical link: src/root.tsx always emits one,
 * and DocumentHead `links` are additive, so a route-level canonical produces a
 * second conflicting tag rather than overriding the first. Google distrusts
 * both when they conflict.
 */
export function seoMeta({
  path,
  title,
  description,
  ogType = "website",
}: SeoInput) {
  const url = `${ORIGIN}${path}`;

  const meta: Array<Record<string, string>> = [
    { name: "description", content: description },
    { name: "author", content: profile.name },

    { property: "og:site_name", content: profile.name },
    { property: "og:type", content: ogType },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:locale", content: "en_IN" },

    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];

  // Only emit image tags when an image actually exists. A referenced-but-404
  // og:image renders a blank card, which is worse than emitting none at all.
  if (profile.ogImage) {
    const img = `${ORIGIN}${profile.ogImage}`;
    const alt = `${profile.name}${profile.jobTitle ? `, ${profile.jobTitle}` : ""}`;
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

  return meta;
}

/** The Person node. Referenced by @id everywhere else so it can't drift. */
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
  // sameAs is the entity-reconciliation hook. Only ever list profiles that are
  // verified yours and currently live -- a stale or wrong URL actively harms
  // disambiguation rather than helping it.
  ...(profile.sameAs.length ? { sameAs: [...profile.sameAs] } : {}),
});

/**
 * Homepage graph: WebSite + ProfilePage + Person in a single @graph.
 *
 * One @graph rather than three scripts, because disconnected top-level nodes
 * are the most common validation complaint -- Google can't relate them.
 * No SearchAction / sitelinks searchbox: Google retired that in Oct 2024.
 */
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
      // mainEntity is REQUIRED on ProfilePage.
      mainEntity: { "@id": `${ORIGIN}/#person` },
      inLanguage: "en",
    },
    personNode(),
  ],
});

/** Resume page. References the Person rather than redefining it. */
export const resumeGraph = () => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${ORIGIN}/resume/#webpage`,
      url: `${ORIGIN}/resume/`,
      name: `Resume — ${profile.name}`,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      about: { "@id": `${ORIGIN}/#person` },
      inLanguage: "en",
    },
    personNode(),
  ],
});

/** Privacy page. A plain WebPage on the site, nothing to disambiguate. */
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

/**
 * Blog index. BlogPosting entries are what tie writing to the person entity --
 * the pathway for "engineers who write about X" queries.
 */
export const blogGraph = () => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Blog",
      "@id": `${ORIGIN}/blog/#blog`,
      url: `${ORIGIN}/blog/`,
      name: `Writing — ${profile.name}`,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      author: { "@id": `${ORIGIN}/#person` },
      inLanguage: "en",
      blogPost: posts.map(postingNode),
    },
    personNode(),
  ],
});

/**
 * Everything a post's `head` needs, from its entry in profile.ts. An MDX post
 * does `export const head = postHead("<slug>")`; an unknown slug fails the
 * build rather than shipping a page with no title.
 */
export function postHead(slug: string) {
  const p = posts.find((x) => x.slug === slug);
  if (!p) throw new Error(`No post "${slug}" in profile.ts posts`);
  const title = `${p.title} — ${profile.name}`;
  return {
    title,
    meta: [
      ...seoMeta({
        path: `/blog/${p.slug}/`,
        title,
        description: p.summary,
        ogType: "article",
      }),
      { property: "article:published_time", content: p.date },
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
              ...(profile.ogImage
                ? { image: `${ORIGIN}${profile.ogImage}` }
                : {}),
            },
            personNode(),
          ],
        }),
      },
    ],
  };
}
