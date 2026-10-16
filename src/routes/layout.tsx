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

/** Routes set `column`; this layout's `head` sets the rest. */
export type Frontmatter = {
  column?: "reading" | "stage";
  navHref?: string;
  navCurrent?: "page" | "true";
  transitionName?: string;
};

/**
 * Unique per page, so the old and new pages never morph into each other:
 * @qwik.dev/router rc.3 scrolls to the top only after the transition starts.
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
 * Everything that differs per page comes from head, which @qwik.dev/router
 * rc.3 updates before the view transition captures the new page, and
 * `useLocation()` readers only after:
 *   grep -n 'const headUpdated\|forceStoreEffects(routeLocation, "url")' node_modules/@qwik.dev/router/lib/index.qwik.mjs
 * Read from head in JSX, each value is a signal binding (`pnpm run verify`
 * checks), so a click never re-runs this layout.
 */
export const head: DocumentHead = ({ url }) => {
  const path = url.pathname;
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

export default component$(() => {
  const loc = useLocation();
  // Not `head`: the optimizer counts that name as this module's export, so
  // nothing reading it would become a binding.
  const doc = useDocumentHead<Frontmatter>();

  /*
   * @qwik.dev/router rc.3 cancels every same-page `#` click and scrolls
   * instead, leaving focus on the link. This moves it to the target, inline:
   *   grep -n 'scrollIntoView' node_modules/@qwik.dev/router/lib/index.qwik.mjs
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
      <div class="field" aria-hidden="true" />
      <div class="grain-page" aria-hidden="true" />

      <a
        href="#main"
        class="focus:bg-surface focus:text-text focus:border-line sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:border focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <div
        class="site-column flex min-h-dvh w-full flex-col"
        data-column={doc.frontmatter.column}
      >
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
         * @qwik.dev/router rc.3 has no live region (`grep -c aria-live` on its
         * index.qwik.mjs prints 0), so this announces the title after a
         * client-side navigation. `prevUrl` is unset on a full load.
         */}
        <p aria-live="assertive" aria-atomic="true" class="sr-only">
          {loc.prevUrl ? doc.title : ""}
        </p>
      </div>
    </div>
  );
});
