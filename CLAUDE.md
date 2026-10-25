# CLAUDE.md

Static portfolio site. Qwik 2 (prerelease) → SSG → Cloudflare Workers static assets.
Qwik 2's docs are `next.qwik.dev`; `qwik.dev` is Qwik 1 and none of it applies.
Package manager is **pnpm** — `npm` commands will fight the lockfile.
Styling is Tailwind v4. `dist/` is uploaded as-is; the only server code is
one Worker (`src/worker/`) that answers `/api/*` and nothing else: asset
requests are free, and every Worker invocation counts against 100k/day.

`README.md` is for visitors: what's built, the eval results, and the
commands. No file maps or internals there. Topic-specific rules go in
`.claude/skills/`, not here.

## The anti-rot rule

This repo pins a prerelease framework. A confidently stale note is worse than
no note — it makes a future session skip verification instead of doing it.

**Every fact in this file or in `.claude/skills/` carries a version + date or a
command that re-verifies it.** No command, no trust. Read `node_modules`, not
the docs, when they disagree.

## Comments

Default to none. Code is the source of truth; a comment is a second copy that
nothing keeps in sync. The 2026-10-16 audit found ~50 false comments in ~3,200
lines, nearly all long explanations, claims about other files, or history.

- **Keep** a constraint from something we can't change (browser, Qwik,
  Cloudflare, WCAG) in one line, two if the second is a new fact, dated per the
  anti-rot rule. Also tool directives, and the config rationale in
  `wrangler.jsonc`, `public/_headers` and `public/robots.txt`.
- **Check or delete** any claim about another file, a layout, or "must match
  X": make it a shared constant or a `verify` check, then drop the prose.
- **Delete** what the code already says, history, banners, and measurements
  that justified a past decision (those belong in the commit message).
- **Rename, don't explain** a surprise in our own code.

Don't copy the density of the file you're in. Details, and the places a comment
is not inert (Tailwind and `verify` read them): `.claude/skills/comments/`.

## Invariants

`pnpm run build && pnpm run verify` executes this repo's invariants against the
real build output. Add new ones there, not here. These three are worth knowing
before you write the code:

- **Pin exact. No carets.** Carets don't pin prereleases: `^2.0.0-beta.38`
  silently installed beta.39. verify fails on a caret, but only after the install.
- **Generated geometry is seeded, never `Math.random()`.** SSG runs at build
  time, so random rewrites the HTML every deploy. Unchecked;
  `grep -rn 'Math.random' src` should print nothing.
- **Images on a page are WebP.** Keep the source in `public/` and import it
  with `?jsx`, which emits a WebP srcset under `/assets/`;
  `src/routes/blog/index.tsx` is the example. og:image is the one exception: it
  is never shown on a page and stays a 1200x630 JPEG.
