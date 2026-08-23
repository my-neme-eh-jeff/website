import { component$, Slot } from "@qwik.dev/core";
import { Link, useLocation } from "@qwik.dev/router";
import { ScoreRow } from "~/components/score-ring/score-ring";
import { profile } from "~/content/profile";

/**
 * Evaluated at build time, because this site is statically generated.
 * The year only advances when the site is rebuilt.
 */
const buildYear = new Date().getFullYear();

const pages = [
  { href: "/", label: "Index" },
  { href: "/resume/", label: "Resume" },
  { href: "/blog/", label: "Writing" },
];

/**
 * Two columns: a narrow rail of links, a rule, and everything else.
 *
 * ---------------------------------------------------------------------------
 * The full-width top navbar is gone. It was a border and four words — it spent
 * a whole band of the viewport saying almost nothing, and it made every page
 * open the same bland way.
 *
 * The rail replaces it and does more with less: pages, then profiles, then the
 * measured scores, stacked in one column with the rule as the only divider. The
 * rule sits at 13rem rather than near centre, so the content column keeps the
 * room it needs and the rail reads as an index rather than a sidebar.
 *
 * Below `lg` the rail collapses to a horizontal strip, because a 13rem column
 * on a phone leaves nothing for the text.
 *
 * `view-transition-name` is the load-bearing detail for navigation: the rail
 * and the atmosphere are named, so the browser carries them across a route
 * change untouched and only the content animates. Names must be unique per
 * page — two elements sharing one aborts the whole transition.
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
      {/* Grain is its own layer so it can cover the full viewport uniformly —
          the field above is masked to fade out, and grain that faded with it
          would look like a gradient of noise rather than film. */}
      <div
        class="grain-page"
        aria-hidden="true"
        style={{ viewTransitionName: "grain" }}
      />

      <a
        href="#main"
        class="focus:bg-surface focus:text-text focus:border-line sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:border focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <div class="lg:grid lg:grid-cols-[13rem_1fr]">
        <div
          class="border-line lg:sticky lg:top-0 lg:h-dvh lg:border-r"
          style={{ viewTransitionName: "rail" }}
        >
          <div class="flex h-full flex-col gap-8 px-5 py-6 lg:py-8">
            <Link
              href="/"
              class="text-base font-semibold tracking-tight no-underline"
            >
              {profile.name}
            </Link>

            <nav aria-label="Pages">
              <ul class="flex flex-row gap-4 p-0 lg:flex-col lg:gap-1.5">
                {pages.map((p) => {
                  const active = path === p.href;
                  return (
                    <li class="list-none" key={p.href}>
                      <Link
                        href={p.href}
                        aria-current={active ? "page" : undefined}
                        class={
                          active
                            ? "text-text decoration-accent underline underline-offset-4"
                            : "text-muted hover:text-text no-underline"
                        }
                      >
                        {p.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <nav aria-label="Profiles" class="hidden lg:block">
              <ul class="flex flex-col gap-1.5 p-0">
                {profile.links.map((l) => (
                  <li class="list-none" key={l.href}>
                    <a
                      href={l.href}
                      rel="me noopener"
                      class="text-muted hover:text-text no-underline"
                    >
                      {l.label}
                      <span
                        class="text-accent ml-1 font-mono text-xs"
                        aria-hidden="true"
                      >
                        ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Scores sit at the foot of the rail on desktop: there for anyone
                who looks, never competing with the content. */}
            <div class="mt-auto hidden lg:block">
              <p class="eyebrow mb-3">Measured</p>
              <ScoreRow compact />
              <p class="text-muted mt-6 mb-0 text-xs">
                © {buildYear}
                <br />
                <a href="https://github.com/my-neme-eh-jeff/website">Source</a>
              </p>
            </div>
          </div>
        </div>

        <main
          id="main"
          tabIndex={-1}
          class="min-w-0 py-10 focus:outline-none lg:py-16"
          style={{ viewTransitionName: "page" }}
        >
          <Slot />

          {/* The rail hides its lower half below lg, so the same information
              has to land somewhere on a phone. */}
          <div class="border-line mt-16 border-t px-5 pt-8 lg:hidden">
            <p class="eyebrow mb-3">Measured</p>
            <ScoreRow compact />
            <div class="text-muted mt-6 flex flex-wrap gap-4 text-xs">
              <span>
                © {buildYear} {profile.name}
              </span>
              <a
                class="ml-auto"
                href="https://github.com/my-neme-eh-jeff/website"
              >
                Source
              </a>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
});
