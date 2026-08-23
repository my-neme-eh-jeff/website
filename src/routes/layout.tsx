import { component$, Slot } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { profile } from "~/content/profile";

/**
 * Evaluated at build time, because this site is statically generated.
 * The year only advances when the site is rebuilt — acceptable here, since
 * pushes trigger a deploy, but it is a stale value, not a live clock.
 */
const buildYear = new Date().getFullYear();

/**
 * Nav, footer and page bodies all use `wrap`, so every page shares one left
 * edge. Prose is clamped inside it with `max-w-measure` rather than by
 * narrowing the container, which would give the text its own centre line.
 */
export default component$(() => {
  return (
    <div class="flex min-h-dvh flex-col">
      {/*
       * Skip link. First thing in the tab order, invisible until focused.
       *
       * Uses `focus:` and NOT `focus-visible:`. The link is only ever reached
       * by Tab, so focus-visible's keyboard heuristic buys nothing -- while
       * programmatic .focus() (from a script, or some assistive tech) does not
       * always match :focus-visible, which would leave the link focused and
       * still invisible. That is the failure mode worth avoiding.
       *
       * Without it a keyboard or screen-reader user traverses the whole nav on
       * every single page before reaching content. It is a plain <a>, not a
       * Qwik <Link>: this is an in-page fragment jump, and routing it through
       * the client router would push a history entry and lose the focus move.
       */}
      <a
        href="#main"
        class="focus:bg-surface focus:text-text focus:border-line sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:border focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <nav
        aria-label="Main"
        class="bg-bg/85 border-line sticky top-0 z-10 border-b backdrop-blur-md"
      >
        <div class="wrap flex items-center gap-5 py-3">
          <Link href="/" class="font-semibold tracking-tight no-underline">
            {profile.name}
          </Link>
          <div class="ml-auto flex gap-4 text-[0.9375rem]">
            <Link href="/resume/">Resume</Link>
            <Link href="/blog/">Blog</Link>
          </div>
        </div>
      </nav>

      {/*
       * tabIndex={-1} makes the fragment jump actually move focus. Without it
       * some browsers scroll the region into view but leave focus on the skip
       * link, so the next Tab returns to the nav -- the exact thing the link
       * exists to avoid.
       */}
      <main
        id="main"
        tabIndex={-1}
        class="flex-1 pt-12 pb-16 focus:outline-none"
      >
        <Slot />
      </main>

      <footer class="border-line text-muted border-t py-6 text-sm">
        <div class="wrap flex flex-wrap gap-4">
          <span>
            © {buildYear} {profile.name}
          </span>
          <a class="ml-auto" href="https://github.com/my-neme-eh-jeff/website">
            Source
          </a>
        </div>
      </footer>
    </div>
  );
});
