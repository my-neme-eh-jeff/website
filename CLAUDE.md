# CLAUDE.md

Static portfolio site. Qwik 2 (beta) → SSG → Cloudflare Workers static assets.

## The anti-rot rule

This repo pins a **beta** framework. A confidently stale note is worse than no
note — it makes a future session skip verification instead of doing it.

**Every fact in this file or in `.claude/skills/` carries a version + date or a
command that re-verifies it.** No command, no trust. Read `node_modules`, not
the docs, when they disagree.

## Where things live

| Looking for | Go to |
|---|---|
| Commands, local dev, deploy flow | `README.md` |
| Qwik 2 API names, adapters, build config | `.claude/skills/qwik2-beta/` |
| SEO, structured data, AI-crawler policy | `.claude/skills/seo-geo/` |
| Favicon / og:image generation | `scripts/make-icons.mjs` (run it, don't hand-edit) |
| Every fact the pages render | `src/content/profile.ts` (and its comments) |
| Meta tags + JSON-LD generation | `src/content/seo.ts` |
| Hosting + free-tier config, with rationale | `wrangler.jsonc` comments |
| Crawler allow/deny, with rationale | `public/robots.txt` comments |

## Invariants

- **Pin exact. No carets.** `^2.0.0-beta.38` silently installed beta.39 — carets
  don't pin prereleases. Verify: `grep -c '\^' package.json` → `0`.
- **Qwik 2 docs are `next.qwik.dev`.** `qwik.dev` is v1; its APIs aren't here.
- **`wrangler.jsonc` stays assets-only — no `main`.** Asset requests are free and
  unlimited; a Worker script bills every request against 100k/day. For server
  endpoints use `run_worker_first: ["/api/*"]`, never `true`.
- **Cloudflare dashboard build command stays empty** — build config is versioned
  in `wrangler.jsonc` `build.command`.
- **`src/routes/404.tsx` stays a file route**, not a directory route. Qwik's
  sitemap guard tests `endsWith("/404.html")`; Cloudflare's `not_found_handling`
  wants `dist/404.html` exactly there.
- **Generated geometry must be seeded, never `Math.random()`** — SSG runs at
  build time, so random rewrites the HTML every deploy. See
  `src/components/generative-mesh/`.
