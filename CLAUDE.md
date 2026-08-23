# CLAUDE.md

Static portfolio site. Qwik 2 (beta) → SSG → Cloudflare Workers static assets.
Styling is Tailwind v4. No server code; `dist/` is uploaded as-is.

## The anti-rot rule

This repo pins a **beta** framework. A confidently stale note is worse than no
note — it makes a future session skip verification instead of doing it.

**Every fact in this file or in `.claude/skills/` carries a version + date or a
command that re-verifies it.** No command, no trust. Read `node_modules`, not
the docs, when they disagree.

## Where things live

| Looking for                                          | Go to                                              |
| ---------------------------------------------------- | -------------------------------------------------- |
| Commands, local dev, deploy flow                     | `README.md`                                        |
| Qwik 2 API names, adapters, build config             | `.claude/skills/qwik2-beta/`                       |
| Why Qwik UI / any Qwik 1 component lib can't be used | `.claude/skills/qwik2-beta/`                       |
| SEO, structured data, AI-crawler policy              | `.claude/skills/seo-geo/`                          |
| Design tokens, theme swap, shared patterns           | `src/global.css` (read the header)                 |
| **Accessibility bar for any UI work**                | `.claude/skills/a11y-ui/`                          |
| Visual design direction for NEW surfaces             | `.claude/skills/frontend-design/` (upstream)       |
| Favicon / og:image generation                        | `scripts/make-icons.mjs` (run it, don't hand-edit) |
| Every fact the pages render                          | `src/content/profile.ts` (and its comments)        |
| Meta tags + JSON-LD generation                       | `src/content/seo.ts`                               |
| Hosting + free-tier config, with rationale           | `wrangler.jsonc` comments                          |
| Cache + security headers, with rationale             | `public/_headers` comments                         |
| Crawler allow/deny, with rationale                   | `public/robots.txt` comments                       |

## Invariants

Most of these are **executed**, not just written down — `npm run verify` checks
them against the real build output. Add new ones there, not here.

- **Pin exact. No carets.** `^2.0.0-beta.38` silently installed beta.39 — carets
  don't pin prereleases. Verify: `npm run verify` (the bare
  `grep -c '\^' package.json` returns 1, not 0 — `engines.node` legitimately
  uses carets, which is why the check parses the dependency blocks instead).
- **Qwik 2 docs are `next.qwik.dev`.** `qwik.dev` is v1; its APIs aren't here.
- **`wrangler.jsonc` stays assets-only — no `main`.** Asset requests are free and
  unlimited; a Worker script bills every request against 100k/day. For server
  endpoints use `run_worker_first: ["/api/*"]`, never `true`.
- **Cloudflare dashboard build command stays empty** — build config is versioned
  in `wrangler.jsonc` `build.command`, and wrangler runs it even with no `main`.
  Setting the dashboard field too would build twice.
  Verified 2026-08-23 — prints `[custom build]`:
  `npx wrangler deploy --dry-run`
- **`src/routes/404.tsx` stays a file route**, not a directory route. Qwik's
  sitemap guard tests `endsWith("/404.html")`; Cloudflare's `not_found_handling`
  wants `dist/404.html` exactly there.
- **Generated geometry must be seeded, never `Math.random()`** — SSG runs at
  build time, so random rewrites the HTML every deploy. See
  `src/components/generative-mesh/`.
- **Colours come from `--sem-*` via Tailwind utilities**, never a raw hex in a
  component. The `@theme inline` block in `src/global.css` is what makes one
  media query retint the whole site; a hardcoded colour opts out of it.
- **`--sem-accent` is the focus-ring colour**, so its contrast is a conformance
  property, not a style choice. It needs ≥3:1 on `--sem-bg` in BOTH themes —
  which is why light uses `--clay-deep` and dark uses `--clay`. `npm run verify`
  recomputes this; see `.claude/skills/a11y-ui/`.
