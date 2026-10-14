# CLAUDE.md

Static portfolio site. Qwik 2 (prerelease) → SSG → Cloudflare Workers static assets.
Package manager is **pnpm** — `npm` commands will fight the lockfile.
Styling is Tailwind v4. `dist/` is uploaded as-is; the only server code is
one Worker (`src/worker/`) that answers `/api/*` and nothing else.

## The anti-rot rule

This repo pins a **beta** framework. A confidently stale note is worse than no
note — it makes a future session skip verification instead of doing it.

**Every fact in this file or in `.claude/skills/` carries a version + date or a
command that re-verifies it.** No command, no trust. Read `node_modules`, not
the docs, when they disagree.

That rule covers facts, which carry numbers. Two things it kept missing:

- **A comment describing structure or another file must be backed by a check,
  or not written.** Every stale comment an audit has found here was that shape —
  a layout that changed, a parity claim nothing compared, a guard described as
  stricter than it is. None carried a number, so none attracted verification.
- **Don't match the surrounding comment density.** The long blocks are
  load-bearing measurements, not a house style. Default to none, and earn each
  one: if removing it wouldn't confuse a future reader, don't write it.

## Where things live

| Looking for                                             | Go to                                              |
| ------------------------------------------------------- | -------------------------------------------------- |
| Commands, local dev, deploy flow                        | `README.md`                                        |
| Qwik 2 API names, adapters, build config                | `.claude/skills/qwik2-beta/`                       |
| Why Qwik UI / any Qwik 1 component lib can't be used    | `.claude/skills/qwik2-beta/`                       |
| SEO, structured data, AI-crawler policy                 | `.claude/skills/seo-geo/`                          |
| Design tokens, theme swap, shared patterns              | `src/global.css` (read the header)                 |
| **Accessibility bar for any UI work**                   | `.claude/skills/a11y-ui/`                          |
| Visual design direction for NEW surfaces                | `.claude/skills/frontend-design/` (upstream)       |
| Favicon / og:image generation                           | `scripts/make-icons.mjs` (run it, don't hand-edit) |
| Every fact the pages render                             | `src/content/profile.ts` (and its comments)        |
| What the shell's model is told, what links it may print | `src/content/chat.ts`                              |
| What runs on Aman's desk: the chat log proxy            | `desk/README.md`                                   |
| Meta tags + JSON-LD generation                          | `src/content/seo.ts`                               |
| Hosting + free-tier config, with rationale              | `wrangler.jsonc` comments                          |
| Cache + security headers, with rationale                | `public/_headers` comments                         |
| Crawler allow/deny, with rationale                      | `public/robots.txt` comments                       |

## Invariants

Most of these are **executed**, not just written down — `pnpm run verify` checks
them against the real build output. Add new ones there, not here.

- **Pin exact. No carets.** `^2.0.0-beta.38` silently installed beta.39 — carets
  don't pin prereleases. Verify: `pnpm run verify` (the bare
  `grep -c '\^' package.json` returns 1, not 0 — `engines.node` legitimately
  uses carets, which is why the check parses the dependency blocks instead).
- **Qwik 2 docs are `next.qwik.dev`.** `qwik.dev` is v1; its APIs aren't here.
- **The Worker runs on `/api/*` only.** Asset requests are free and unlimited;
  a Worker invocation counts against 100k/day. `run_worker_first` is a list of
  `/api/*` paths, never `true`. Verify: `pnpm run verify`.
- **Cloudflare dashboard build command stays empty** — build config is versioned
  in `wrangler.jsonc` `build.command`, and wrangler runs it even with no `main`.
  Setting the dashboard field too would build twice.
  Verified 2026-10-04 on wrangler 4.147.0 — prints `[custom build]`:
  `pnpm exec wrangler deploy --dry-run`
- **`src/routes/404.tsx` stays a file route**, not a directory route. Qwik's
  sitemap guard tests `endsWith("/404.html")`; Cloudflare's `not_found_handling`
  wants `dist/404.html` exactly there.
- **Generated geometry must be seeded, never `Math.random()`** — SSG runs at
  build time, so random rewrites the HTML every deploy. (None exists today;
  `grep -rn 'Math.random' src` should print nothing.)
- **Colours come from `--sem-*` via Tailwind utilities**, never a raw hex in a
  component. The `@theme inline` block in `src/global.css` is what makes one
  media query retint the whole site; a hardcoded colour opts out of it.
- **`--sem-accent` is the focus-ring colour**, so its contrast is a conformance
  property, not a style choice. It needs ≥3:1 on `--sem-bg` in BOTH themes —
  which is why light uses `--clay-deep` and dark uses `--clay`. `pnpm run verify`
  recomputes this; see `.claude/skills/a11y-ui/`.
- **No sideways page scroll at any width from 320px up** (320 = 400% zoom,
  WCAG 1.4.10). Wide content scrolls inside its own box, which needs `relative`
  (an `sr-only` child escapes one that isn't) and `scroll-cue` (phones show no
  scrollbar). Checked 2026-10-14 at 25 widths, 320–3440px. Re-check in device
  mode at 320, 390, 768, 1440 and 1920: `document.documentElement.scrollWidth`
  must equal `clientWidth` on every page.
