/**
 * The code checks. An answer row keeps the names it failed when it was
 * asked, but summaries rerun these on its text, so fixing a check corrects
 * old runs without asking the models again.
 */
import { KNOWN_HREFS } from "../src/content/chat.ts";

const words = (s) => s.split(/\s+/).filter(Boolean).length;
const bare = (u) => u.replace(/[.,;:!?)]+$/, "").replace(/\/$/, "");
const known = new Set([...KNOWN_HREFS].map(bare));
const urls = (s) => (s.match(/https?:\/\/[^\s<>"'\]]+/g) ?? []).map(bare);

/** Checks every answer must pass, whatever was asked. */
export const FORM = [
  ["not cut off", (r) => r.doneReason !== "length"],
  ["has an answer", (r) => r.answer.trim().length > 0],
  ["no loop", (r) => !r.looped],
  ["<=120 words", (r) => words(r.answer) <= 120],
  ["plain text", (r) => !/\*\*|^#{1,6}\s|^\s*\|.*\|\s*$|`/m.test(r.answer)],
  ["known URLs only", (r) => urls(r.answer).every((u) => known.has(u))],
  ["3 follow-ups", (r) => r.next.length === 3],
  [
    "no stray help",
    (r) => !/(?:^|[.!?]\s*|\n\s*)help\.?$/i.test(r.answer.trim()),
  ],
];

/**
 * Text with the spaces, dashes and quotes models type folded to ASCII, so a
 * case's check for "Argo CD" or "don't" matches gpt-oss-16k:20b's
 * "Argo\u202fCD" and "don\u2019t" (2026-10-19).
 */
export const plain = (s) =>
  s
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201f]/g, '"');

/** The checks `row` fails: FORM's, then its case's `must`. */
export function failedChecks(row, c, { onDesk }) {
  if (row.error) return ["request failed"];
  const text = plain(row.answer);
  return [
    ...FORM.filter(([, ok]) => !ok(row)),
    ...(c?.must ?? []).filter(([, ok]) => !ok(text, { onDesk })),
  ].map(([name]) => name);
}

/** `failedChecks` with today's checks, or what the row stored if its case is gone. */
export const recheck = (row, c, target) =>
  c ? failedChecks(row, c, target) : row.failed;
