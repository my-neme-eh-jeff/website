import type { DocumentHeadValue } from "@qwik.dev/router";
import type { Frontmatter } from "../layout";

/*
 * No component on purpose: RouterOutlet skips a layout without a default
 * export, so this only contributes head. It tells the root layout that every
 * page under /blog/ is read in the centred column — see why it is head and not
 * the URL in src/routes/layout.tsx.
 */
export const head: DocumentHeadValue<Frontmatter> = {
  frontmatter: { column: "reading" },
};
