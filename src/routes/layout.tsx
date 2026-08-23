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
      <nav class="bg-bg/85 border-line sticky top-0 z-10 border-b backdrop-blur-md">
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

      <main class="flex-1 pt-12 pb-16">
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
