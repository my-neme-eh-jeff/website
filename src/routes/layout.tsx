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
   * @qwik.dev/router rc.3 jumps to a same-page `#` target and leaves focus on
   * the link. This takes the click instead: it eases the page there on the
   * page transition's curve, cubic-bezier(0.2, 0, 0, 1), and moves focus to
   * the target. Reduced motion jumps. The router's version:
   *   grep -n 'scrollIntoView' node_modules/@qwik.dev/router/lib/index.qwik.mjs
   */
  useOnDocument(
    "click",
    sync$((e: Event) => {
      const m = e as MouseEvent;
      if (m.button || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const id = link?.getAttribute("href")!.slice(1);
      const target = id && document.getElementById(decodeURIComponent(id));
      if (!target) return;
      e.preventDefault();
      if (location.hash !== `#${id}`) history.pushState({}, "", `#${id}`);
      if (!target.hasAttribute("tabindex"))
        target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });

      const w = window as unknown as { hashScroll?: number };
      cancelAnimationFrame(w.hashScroll ?? 0);
      const from = scrollY;
      const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const to = Math.max(
        0,
        Math.min(
          document.documentElement.scrollHeight - innerHeight,
          target.getBoundingClientRect().top + from - margin,
        ),
      );
      const span = to - from;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || !span) {
        scrollTo(0, to);
        return;
      }
      // y for x on the curve; x(t) only rises, so bisection finds t.
      const ease = (x: number) => {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 20; i++) {
          const t = (lo + hi) / 2;
          if (0.6 * t * (1 - t) ** 2 + t ** 3 < x) lo = t;
          else hi = t;
        }
        const t = (lo + hi) / 2;
        return 3 * t * t - 2 * t ** 3;
      };
      const ms = Math.min(560, 320 + Math.abs(span) / 30);
      const stop = () => {
        cancelAnimationFrame(w.hashScroll ?? 0);
        removeEventListener("wheel", stop);
        removeEventListener("touchstart", stop);
      };
      // A wheel or a touch takes the page back from the animation.
      addEventListener("wheel", stop, { passive: true });
      addEventListener("touchstart", stop, { passive: true });
      let start = 0;
      const step = (now: number) => {
        start ||= now;
        const p = Math.min(1, (now - start) / ms);
        scrollTo(0, from + span * ease(p));
        if (p < 1) w.hashScroll = requestAnimationFrame(step);
        else stop();
      };
      w.hashScroll = requestAnimationFrame(step);
    }),
  );

  /*
   * A box that scrolls sideways needs a tab stop, or a keyboard cannot scroll
   * it (WCAG 2.1.1). Chrome gives one to a scroller with nothing focusable
   * inside, but not every browser does. This gives one to each box that
   * overflows right now, and takes back only the ones it gave when they stop.
   * Run once the page is idle and again before every Tab, so a resize or a
   * client-side navigation is caught without a listener on either.
   */
  const scrollStops = sync$((e: Event) => {
    if (e.type === "keydown" && (e as KeyboardEvent).key !== "Tab") return;
    for (const el of document.querySelectorAll<HTMLElement>(
      "main :is(.scroll-cue, pre, .table-wrapper):not([aria-hidden] *)",
    )) {
      const wide = el.scrollWidth > el.clientWidth;
      if (wide && !el.hasAttribute("tabindex")) {
        el.tabIndex = 0;
        el.dataset["scrollStop"] = "";
      } else if (!wide && el.dataset["scrollStop"] !== undefined) {
        el.removeAttribute("tabindex");
        delete el.dataset["scrollStop"];
      }
    }
  });
  useOnDocument("qidle", scrollStops);
  useOnDocument("keydown", scrollStops, { passive: true });

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
                    ? "decoration-accent text-accent underline underline-offset-4"
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
                <span class="sr-only"> code for this site</span>
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
