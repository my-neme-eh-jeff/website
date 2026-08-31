import { component$, Slot } from "@qwik.dev/core";
import { Link, useLocation } from "@qwik.dev/router";
import { ScoreRow } from "~/components/score-ring/score-ring";
import { profile } from "~/content/profile";

const buildYear = new Date().getFullYear();

const pages = [
  { href: "/", label: "Index" },
  { href: "/resume/", label: "Resume" },
  { href: "/blog/", label: "Writing" },
];

/**
 * No sidebar, no rule, no navbar.
 *
 * ---------------------------------------------------------------------------
 * The left of the page is deliberately EMPTY — just the grainy gradient
 * showing through. Everything readable lives in a column on the right.
 *
 * A previous attempt put a link rail and a glowing divider on the left, which
 * turned that emptiness into a sidebar. That is the opposite of the intent: the
 * space is not a container for navigation, it is the artwork, and the content
 * is offset into it rather than framed by it.
 *
 * Hence `margin-inline-start: auto` on a max-width column, not a grid with a
 * named left cell. Nothing occupies the left; the column simply does not extend
 * into it. Below `lg` the offset collapses, because a phone has no room to give
 * away.
 * ---------------------------------------------------------------------------
 */
export default component$(() => {
  const loc = useLocation();
  const path = loc.url.pathname;

  return (
    <div class="min-h-dvh">
      <div
        class="field"
        aria-hidden="true"
        style={{ viewTransitionName: "field" }}
      />
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

      <div class="mr-0 ml-auto w-full max-w-[46rem] px-5 lg:max-w-[52rem] lg:pr-16">
        {/*
         * Links sit inline at the top of the column, not in a rail. Small,
         * horizontal, no border — an index line rather than a chrome band.
         */}
        <header class="flex flex-wrap items-baseline gap-x-5 gap-y-2 pt-8 lg:pt-14">
          {pages.map((p) => {
            const active = path === p.href;
            return (
              <Link
                key={p.href}
                href={p.href}
                aria-current={active ? "page" : undefined}
                class={
                  active
                    ? "decoration-accent text-text text-sm underline underline-offset-4"
                    : "text-muted hover:text-text text-sm no-underline"
                }
              >
                {p.label}
              </Link>
            );
          })}

          <span class="ml-auto flex flex-wrap gap-x-4 gap-y-2">
            {profile.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                rel="me noopener"
                class="text-muted hover:text-text text-sm no-underline"
              >
                {l.label}
                <span
                  class="text-accent ml-1 font-mono text-xs"
                  aria-hidden="true"
                >
                  ↗
                </span>
              </a>
            ))}
          </span>
        </header>

        <main
          id="main"
          tabIndex={-1}
          class="min-w-0 pt-14 pb-16 focus:outline-none"
          style={{ viewTransitionName: "page" }}
        >
          <Slot />
        </main>

        <footer class="text-muted border-line/50 border-t py-8 text-xs">
          <div class="mb-6">
            <ScoreRow />
          </div>
          <div class="flex flex-wrap gap-4">
            <span>
              © {buildYear} {profile.name}
            </span>
            <a
              class="ml-auto"
              href="https://github.com/my-neme-eh-jeff/website"
            >
              Source
              <span class="text-accent ml-1 font-mono" aria-hidden="true">
                ↗
              </span>
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
});
