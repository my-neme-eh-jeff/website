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

## Comments

Default to none. Code is the source of truth; a comment is a second copy that
nothing keeps in sync. The 2026-10-16 audit found ~50 false comments in ~3,200
lines, nearly all long explanations, claims about other files, or history.

- **Keep** a constraint from something we can't change (browser, Qwik,
  Cloudflare, WCAG) in one line, two if the second is a new fact, dated per the
  anti-rot rule. Also tool directives, and the config rationale the table
  below points at.
- **Check or delete** any claim about another file, a layout, or "must match
  X": make it a shared constant or a `verify` check, then drop the prose.
- **Delete** what the code already says, history, banners, and measurements
  that justified a past decision (those belong in the commit message).
- **Rename, don't explain** a surprise in our own code.

Don't copy the density of the file you're in. Details, and the places a comment
is not inert (Tailwind and `verify` read them): `.claude/skills/comments/`.

## Where things live

| Looking for                                             | Go to                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Commands, local dev, deploy flow                        | `README.md`                                                                                 |
| Qwik 2 API names, adapters, build config                | `.claude/skills/qwik2-beta/`                                                                |
| Why Qwik UI / any Qwik 1 component lib can't be used    | `.claude/skills/qwik2-beta/`                                                                |
| SEO, structured data, AI-crawler policy                 | `.claude/skills/seo-geo/`                                                                   |
| Colour palettes, light/dark, the shell's `theme` picker | `src/content/palettes.ts`, `src/content/theme.ts`, `src/components/terminal/theme-pick.tsx` |
| Design tokens, shared patterns                          | `src/global.css` (read the header)                                                          |
| Writing, trimming or deleting a comment                 | `.claude/skills/comments/`                                                                  |
| **Accessibility bar for any UI work**                   | `.claude/skills/a11y-ui/`                                                                   |
| Visual design direction for NEW surfaces                | `.claude/skills/frontend-design/` (upstream)                                                |
| Favicon / og:image generation                           | `scripts/make-icons.mjs` (run it, don't hand-edit)                                          |
| Every fact the pages render                             | `src/content/profile.ts` (and its comments)                                                 |
| What the shell's model is told, what links it may print | `src/content/chat.ts`                                                                       |
| The home page desk, as text and as the WebGL light      | `src/components/desk/` (verify checks they match)                                           |
| What runs on Aman's desk: the chat log proxy            | `desk/README.md`                                                                            |
| Meta tags + JSON-LD generation                          | `src/content/seo.ts`                                                                        |
| Hosting + free-tier config, with rationale              | `wrangler.jsonc` comments                                                                   |
| Cache + security headers, with rationale                | `public/_headers` comments                                                                  |
| Crawler allow/deny, with rationale                      | `public/robots.txt` comments                                                                |

## Invariants

Most of these are **executed**, not just written down — `pnpm run verify` checks
them against the real build output. Add new ones there, not here.

- **Pin exact. No carets.** `^2.0.0-beta.38` silently installed beta.39 — carets
  don't pin prereleases. Verify: `pnpm run verify`, which parses the
  dependency blocks rather than grepping the whole file.
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
  component. Every palette's values live in `src/content/palettes.ts`; the
  `@theme inline` block in `src/global.css` is what lets one attribute on
  `<html>` retint the whole site, and a hardcoded colour opts out of it.
- **`--sem-accent` is the focus-ring colour and hint/link text**, so its
  contrast is a conformance property, not a style choice: ≥3:1 on `--sem-bg`
  and ≥4.5:1 on `--sem-bg` and `--sem-surface`, in every mode of every palette.
  Core tokens are six-digit hex, because the desk's WebGL light parses them.
  `pnpm run verify` checks both; see `.claude/skills/a11y-ui/`.
- **No sideways page scroll at any width from 320px up** (320 = 400% zoom,
  WCAG 1.4.10). Wide content scrolls inside its own box, which needs `relative`
  (an `sr-only` child escapes one that isn't) and `scroll-cue` (phones show no
  scrollbar). Checked 2026-10-14 at 25 widths, 320–3440px. Re-check in device
  mode at 320, 390, 768, 1440 and 1920: `document.documentElement.scrollWidth`
  must equal `clientWidth` on every page.
- **Images on a page are WebP.** Keep the source in `public/` and import it
  with `?jsx`, which emits a WebP srcset under `/assets/` (the router's
  vite-imagetools, through sharp); `src/routes/blog/index.tsx` is the example.
  The one exception is og:image, which is never shown on a page and stays a
  1200x630 JPEG, the format the og check measures. Verify: `pnpm run verify`.
