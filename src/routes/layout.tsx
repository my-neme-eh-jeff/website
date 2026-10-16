import { component$, Slot, sync$, useOnDocument } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { Link, useDocumentHead, useLocation } from "@qwik.dev/router";
import {
  CircledChoice,
  ICONS,
  SAY_HI,
} from "~/components/circled-choice/circled-choice";
import { ThemePicker } from "~/components/theme-picker";
import { profile } from "~/content/profile";

/**
 * `column` is what a route tells this layout through `head.frontmatter`; the
 * rest is derived for every page by this layout's own `head`, below.
 */
export type Frontmatter = {
  column?: "reading" | "stage";
  navHref?: string;
  navCurrent?: "page" | "true";
  transitionName?: string;
};

/**
 * A view-transition name for the content that is different on every page, so
 * the old page always leaves from where it is and the new one arrives where it
 * lands. A shared name made the two morph into each other: from the bottom of
 * a long page that slid the old content thousands of pixels, because the
 * router scrolls the new page to the top only after the transition starts.
 *
 * Keyed on the path, which `head` below receives before the router captures
 * the new page.
 */
const pageTransitionName = (path: string) => {
  let hash = 0;
  for (const ch of path)
    hash = (Math.imul(hash, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return `page-${hash.toString(36)}`;
};

const buildYear = new Date().getFullYear();

const pages = [
  { href: "/", label: "Index" },
  { href: "/blog/", label: "Blog" },
];

/**
 * Everything this layout shows that differs per page is worked out here, once
 * per navigation, and the component below only reads it. Two reasons:
 *
 * - Head is updated before the view transition captures the new page, and
 *   `useLocation()` readers only after (see the column note below), so the lit
 *   link and the transition name are right in the captured snapshot.
 * - Read straight from head in JSX, each becomes a signal binding, so a click
 *   updates a few attributes and never re-runs this layout. rc.3's optimizer
 *   only makes a binding of an expression with no call, nothing from module
 *   scope and at most 150 characters; anything else is evaluated in the render
 *   and subscribes the whole component. `pnpm run verify` checks the bindings.
 */
export const head: DocumentHead = ({ url }) => {
  const path = url.pathname;
  // A post is inside the blog, so the blog link stays lit there.
  const lit = pages.find(
    (p) => p.href === path || (p.href !== "/" && path.startsWith(p.href)),
  );
  return {
    frontmatter: {
      navHref: lit?.href,
      navCurrent: lit && (lit.href === path ? "page" : "true"),
      transitionName: pageTransitionName(path),
    },
  };
};

/**
 * No sidebar, no rule, no navbar.
 *
 * ---------------------------------------------------------------------------
 * On the wide pages the left of the page is deliberately EMPTY — just the
 * grainy gradient showing through — and everything readable lives in a
 * column on the right. A link rail there once turned that space into a
 * sidebar; it is meant as the artwork, so the column is offset into it with
 * `margin-inline-start: auto` rather than framed by a grid. Below `lg` the
 * offset collapses, because a phone has no room to give away.
 *
 * The home page is the exception: its first screen is the shell, centred.
 * ---------------------------------------------------------------------------
 */
export default component$(() => {
  const loc = useLocation();
  // Not `head`: this module exports that name, and the optimizer then counts
  // every expression using it as module scope, so none becomes a binding.
  const doc = useDocumentHead<Frontmatter>();

  /*
   * Qwik Router takes over every same-page `#` link: it cancels the click and
   * scrolls the target into view, so focus stays on the link and the next Tab
   * starts from the top again. That broke the skip link and the post's
   * contents list. This moves focus to the target as well, inline from the
   * HTML, so no click on the page waits on a bundle for it. The router's own
   * handler: `grep -n 'scrollIntoView' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
   */
  useOnDocument(
    "click",
    sync$((e: Event) => {
      const link = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const target =
        link && document.getElementById(link.getAttribute("href")!.slice(1));
      if (!target) return;
      if (!target.hasAttribute("tabindex"))
        target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }),
    { passive: true },
  );

  return (
    <div class="min-h-dvh">
      {/* Never named either: see the view-transition note in global.css. */}
      <div class="field" aria-hidden="true" />
      {/*
       * No view-transition-name here, deliberately — `pnpm run verify` asserts
       * it. A named element is snapshotted into the transition's own layer,
       * where mix-blend-mode has no backdrop to blend against, so the grain
       * painted as raw grey noise over the whole page for one frame.
       */}
      <div class="grain-page" aria-hidden="true" />

      <a
        href="#main"
        class="focus:bg-surface focus:text-text focus:border-line sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:border focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      {/*
       * A post is read, not browsed, so it gets a centred column; the home
       * page is the shell, so it gets a wide centred one. `.site-column` in
       * global.css draws each.
       *
       * Which column comes from the route's head (src/routes/blog/(post)/layout.tsx),
       * not the URL. Qwik Router notifies `useLocation()` readers only after
       * the view transition has captured the new page, so a URL-driven column
       * is captured wrong and then jumps; head updates land before the
       * capture. The order, in the router's commit step:
       *   grep -n 'const headUpdated\|forceStoreEffects(routeLocation, "url")' node_modules/@qwik.dev/router/lib/index.qwik.mjs
       */}
      <div
        class="site-column flex min-h-dvh w-full flex-col"
        data-column={doc.frontmatter.column}
      >
        {/*
         * Links sit inline at the top of the column, not in a rail. Small,
         * horizontal, no border — an index line rather than a chrome band.
         */}
        {/* Above main, so the "say hi" panel is not drawn under the shell. */}
        <header class="relative z-10 flex flex-wrap items-baseline gap-x-5 gap-y-2 pt-6 lg:pt-8">
          <nav
            aria-label="Site"
            class="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm"
            style={{ viewTransitionName: "site-nav" }}
          >
            {pages.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                aria-current={
                  doc.frontmatter.navHref === p.href
                    ? doc.frontmatter.navCurrent
                    : undefined
                }
                class={
                  doc.frontmatter.navHref === p.href
                    ? "decoration-accent text-text underline underline-offset-4"
                    : "text-muted hover:text-text no-underline"
                }
              >
                {p.label}
              </Link>
            ))}
          </nav>

          <span
            class="ml-auto flex flex-wrap items-baseline gap-x-3 gap-y-2"
            style={{ viewTransitionName: "site-links" }}
          >
            {profile.links
              .filter((l) => !SAY_HI.includes(l.label))
              .map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  rel="me noopener"
                  class="text-muted hover:text-text text-sm no-underline"
                >
                  {/* Inline, not flex, so the row still aligns on the text. */}
                  {ICONS[l.label] && (
                    <svg
                      viewBox="0 0 24 24"
                      class="mr-1.5 inline-block size-3.5 align-[-0.15em]"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d={ICONS[l.label]} />
                    </svg>
                  )}
                  {l.label}
                </a>
              ))}
            <CircledChoice label="say hi" />
          </span>
        </header>

        <main
          id="main"
          tabIndex={-1}
          class="min-w-0 flex-1 pt-14 pb-16 focus:outline-none in-data-[column=stage]:pt-10"
          style={{
            viewTransitionName: doc.frontmatter.transitionName,
            viewTransitionClass: "page",
          }}
        >
          <Slot />
        </main>

        <footer class="text-muted border-line/50 border-t py-8 text-xs">
          <div class="flex flex-wrap items-center gap-4">
            <span>
              © {buildYear} {profile.name}
            </span>
            <div class="ml-auto flex flex-wrap items-center gap-4">
              <ThemePicker />
              <Link href="/privacy/">Privacy</Link>
              <a href="https://github.com/my-neme-eh-jeff/website">
                Source
                <span class="text-accent font-arrow ml-1" aria-hidden="true">
                  ↗
                </span>
              </a>
            </div>
          </div>
        </footer>

        {/*
         * Announces the new title after a client-side navigation, which a
         * screen reader otherwise does not hear at all: the router has no live
         * region of its own (`grep -c aria-live` on its index.qwik.mjs is 0).
         * Empty until the first navigation — `prevUrl` is unset on a full page
         * load — so it never duplicates the title for someone reading the page.
         */}
        <p aria-live="assertive" aria-atomic="true" class="sr-only">
          {loc.prevUrl ? doc.title : ""}
        </p>
      </div>
    </div>
  );
});
