/**
 * What the shell's model knows beyond the CV, in Aman's own words; it relays
 * these as his views. Empty until he writes them: an invented opinion is not a
 * placeholder.
 */

/** His pick for his best work: a `slug` from `projects`, and why. */
export const bestWork: { slug: string; why: string } | null = null;

export type Note = {
  /** What the note answers, e.g. "what he looks for in a team". */
  about: string;
  text: string;
  links?: { label: string; href: string }[];
};

export const notes: Note[] = [];
