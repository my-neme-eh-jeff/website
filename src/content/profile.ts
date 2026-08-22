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
  // TODO: your actual one-liner. This shows up in the hero and in meta tags.
  tagline: "TODO: one line on what you do",
  // TODO: 2-3 sentences. Recruiters read this first.
  bio: "TODO: short bio.",
  location: "TODO: city",
  email: "TODO: public contact email",
  links: [
    { label: "GitHub", href: "https://github.com/my-neme-eh-jeff" },
    // TODO: add LinkedIn / X / anything else you want public
  ],
} as const;

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
    summary: "Replace or delete. Exists so the blog index has something to lay out.",
  },
];
