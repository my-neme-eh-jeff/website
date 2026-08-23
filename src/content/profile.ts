/**
 * All site content lives here, deliberately.
 *
 * Two reasons: (1) you edit facts in one file instead of hunting through JSX,
 * and (2) it keeps the escape hatch cheap — porting to another framework means
 * rewriting components, not re-entering content.
 *
 * Everything marked TODO is a placeholder. Nothing here is invented about you.
 */

export const profile = {
  name: "Aman Nambisan",

  /**
   * TODO: your actual one-liner.
   *
   * This is load-bearing: it renders in the hero AND becomes the meta
   * description, the og:description, and schema.org Person.description.
   * Until it is filled in, search results and social cards literally read
   * "TODO: one line on what you do" under your name. 120-160 chars.
   */
  tagline: "TODO: one line on what you do",

  /** TODO: 2-3 sentences. Recruiters read this before anything else. */
  bio: "TODO: short bio.",

  /**
   * TODO: pick ONE canonical job title and use the identical string on
   * LinkedIn and GitHub. Variation is what creates entity ambiguity.
   */
  jobTitle: "",

  /** TODO: city. Feeds both the visible resume and PostalAddress.addressLocality. */
  city: "",

  /** TODO: public contact email, or leave empty to keep it uncrawled. */
  email: "",

  /** TODO: current employer, or null. */
  employer: null as { name: string; url: string } | null,

  /**
   * TODO: topics you would defend in an interview. Feeds Person.knowsAbout.
   * Name specific technologies, not categories.
   */
  knowsAbout: [] as string[],

  /**
   * Visible links in the hero.
   * TODO: add LinkedIn and anything else you want public.
   */
  links: [{ label: "GitHub", href: "https://github.com/my-neme-eh-jeff" }],

  /**
   * schema.org sameAs -- the machine-readable "these accounts are one person"
   * assertion, and the best entity-disambiguation tool available.
   *
   * ONLY add URLs you have confirmed are yours and are live. A stale or wrong
   * profile here actively harms disambiguation. Research surfaced a plausible
   * LinkedIn slug and a read.cv page, but neither was verified, so neither is
   * listed -- confirm them first.
   *
   * Also make these reciprocal: each profile should link back to this domain.
   */
  sameAs: [
    "https://github.com/my-neme-eh-jeff",
    // TODO: "https://www.linkedin.com/in/<verified-handle>",
  ] as string[],

  /**
   * Path to a 1200x630 social card under public/, e.g. "/og/home.png".
   * Empty means no og:image tags are emitted at all -- deliberate, because a
   * referenced-but-missing image renders a blank card, which is worse than none.
   */
  ogImage: "",
};

export type Role = {
  company: string;
  title: string;
  period: string;
  /** Bullets should be outcomes, not duties. */
  points: string[];
};

/** TODO: your real history. Left empty on purpose — I won't invent this. */
export const roles: Role[] = [];

/** TODO: skills you'd actually defend in an interview. */
export const skills: string[] = [];

export type Post = {
  slug: string;
  title: string;
  date: string;
  summary: string;
};

/** TODO: real posts. One sample so the index renders and is styled. */
export const posts: Post[] = [
  {
    slug: "hello",
    title: "Placeholder post",
    date: "2026-08-22",
    summary:
      "Replace or delete. Exists so the blog index has something to lay out.",
  },
];
