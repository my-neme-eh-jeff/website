import { component$, Slot, useStyles$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { profile } from "~/content/profile";

/**
 * Evaluated at build time, because this site is statically generated.
 * The year only advances when the site is rebuilt — acceptable here, since
 * pushes trigger a deploy, but it is a stale value, not a live clock.
 */
const buildYear = new Date().getFullYear();

export default component$(() => {
  useStyles$(`
    .shell { min-height: 100dvh; display: flex; flex-direction: column; }
    .nav {
      border-bottom: 1px solid var(--line);
      position: sticky; top: 0;
      background: color-mix(in oklab, var(--bg) 88%, transparent);
      backdrop-filter: blur(8px);
      z-index: 10;
    }
    .nav-in {
      display: flex; align-items: center; gap: 1.25rem;
      padding: 0.85rem 1.25rem;
      max-width: var(--measure); margin: 0 auto; width: 100%;
    }
    .brand { font-weight: 600; letter-spacing: -0.01em; text-decoration: none; }
    .nav-links { margin-left: auto; display: flex; gap: 1.1rem; font-size: 0.94rem; }
    main { flex: 1; padding: 3rem 0 4rem; }
    .foot {
      border-top: 1px solid var(--line);
      padding: 1.5rem 1.25rem; font-size: 0.85rem; color: var(--muted);
    }
    .foot-in { max-width: var(--measure); margin: 0 auto; display: flex; gap: 1rem; flex-wrap: wrap; }
    .foot-in a { margin-left: auto; }
  `);

  return (
    <div class="shell">
      <nav class="nav">
        <div class="nav-in">
          <Link href="/" class="brand">
            {profile.name}
          </Link>
          <div class="nav-links">
            <Link href="/resume/">Resume</Link>
            <Link href="/blog/">Blog</Link>
          </div>
        </div>
      </nav>

      <main>
        <Slot />
      </main>

      <footer class="foot">
        <div class="foot-in">
          <span>
            © {buildYear} {profile.name}
          </span>
          <a href="https://github.com/my-neme-eh-jeff/website">Source</a>
        </div>
      </footer>
    </div>
  );
});
