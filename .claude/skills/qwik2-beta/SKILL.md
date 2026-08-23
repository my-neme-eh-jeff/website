---
name: qwik2-beta
description: Use when touching Qwik 2 APIs, imports, adapters, SSG/build config, or vite config in this repo — or when a Qwik import fails to resolve, an adapter is deprecated, or docs contradict the installed package. Covers the v1/v2 API rename, the SSG adapter, virtual module names, and rollup-vs-rolldown.
---

# Qwik 2 (beta) in this repo

Qwik 2 is in beta and its published docs have been wrong or version-mismatched
more often than the package. **Verify first, then read the snapshot below.**

## Verify first — these stay true after the next beta

Run from the repo root. Each answers one question the docs get wrong.

```bash
# What is actually installed? Beats any doc page.
node -p "require('./node_modules/@qwik.dev/router/package.json').version"

# Does an import path resolve, and what does it really export?
node -e 'import("@qwik.dev/router/adapters/ssg/vite").then(m=>console.log(Object.keys(m)))'

# Which spelling of a virtual module exists? Highest count wins; 0 means invented.
for n in @qwik-router-config @qwik-city-plan @qwik-router-plan; do
  echo "$n $(grep -rl "$n" node_modules/@qwik.dev/router/lib | wc -l)"
done

# Is the API I'm about to use deprecated?
grep -rn "deprecated" node_modules/@qwik.dev/router/lib --include="*.d.ts"

# Rollup or rolldown? Decides rollupOptions vs rolldownOptions.
node -p "require('./node_modules/rollup/package.json').version"
node -p "require('./node_modules/vite/package.json').version"
```

## Snapshot — verified against `2.0.0-beta.38`, 2026-08-22

| Thing                           | v1 name (wrong here)                  | v2 name               |
| ------------------------------- | ------------------------------------- | --------------------- |
| Core package                    | `@builder.io/qwik`                    | `@qwik.dev/core`      |
| Router package                  | `qwik-city` / `@builder.io/qwik-city` | `@qwik.dev/router`    |
| SSG adapter fn                  | `staticAdapter`                       | `ssgAdapter`          |
| Virtual config module           | `@qwik-city-plan`                     | `@qwik-router-config` |
| Integration name for `qwik add` | `static`                              | `ssg`                 |

Details that cost time to establish:

- **`adapters/ssg/vite` and `adapters/static/vite` are aliases to the same
  module**, and it exports _both_ `ssgAdapter` and `staticAdapter`. So a
  `staticAdapter` import resolves fine and gives no runtime error — it is marked
  `/** @public @deprecated Use ssgAdapter instead. */` in
  `lib/adapters/ssg/vite/index.d.ts`. Deprecation is only visible in the types.
- **`rollupOptions`, not `rolldownOptions`.** beta.38 ships vite 7.3.1 on rollup
  4.62.5. Qwik's `main`-branch template uses `rolldownOptions`, which targets a
  newer rolldown-vite and silently does nothing here. Re-check on every bump.
- **`@qwik-router-plan` does not exist.** It is a plausible-sounding invention;
  the grep above returns 0 files for it.
- **404 must be a file route** (`src/routes/404.tsx`, not `src/routes/404/`).
  The sitemap exclusion is `result.pathname.endsWith("/404.html")` in
  `lib/chunks/system.mjs`, so a directory route emitting `/404/` leaks into
  `sitemap.xml` _and_ fails to produce the `dist/404.html` that Cloudflare's
  `not_found_handling: "404-page"` serves.

## Component libraries: Qwik UI is Qwik 1 only

**Checked 2026-08-22 against `@qwik-ui/headless@0.7.7`** (latest; npm
`time.modified` 2026-06-14). It is **not usable here** and no amount of config
fixes it.

```bash
# Still blocked? If this prints @builder.io/qwik, yes.
npm view @qwik-ui/headless peerDependencies
# How deep does it go? (last check: 200 hits, and zero for @qwik.dev)
npm pack @qwik-ui/headless --silent >/dev/null && tar -xzf qwik-ui-headless-*.tgz \
  && grep -rohc "@builder.io/qwik" package/lib | paste -sd+ | bc
```

- Peer dep is `@builder.io/qwik >=1.3.1`; the tarball has **200 imports of
  `@builder.io/qwik`** and **zero** of `@qwik.dev/*`. Same on the repo's `main`.
- `@qwik-ui/styled` (0.4.1) has the identical Qwik 1 peer.
- The repo is alive (`qwikifiers/qwik-ui`, pushed 2026-08-07, ~695 stars) but has
  **no Qwik 2 branch**. It is community-maintained with some core-team overlap —
  not an official Qwik package, despite often being described as one.
- **Do not try a vite `resolve.alias` from `@builder.io/qwik` to
  `@qwik.dev/core`.** It installs and builds, then fails at runtime: v2 renamed
  and removed APIs and changed the optimizer/serialization contract, so `$`
  boundaries compiled against v1 do not resume under v2. Installing Qwik 1
  alongside Qwik 2 means two runtimes and two optimizers.

**The constraint is narrow:** it applies to libraries that import the Qwik
runtime. CSS-only systems (Tailwind, Open Props, Pico) are framework-version
independent and unaffected.

## Styling integrations Qwik 2 ships itself

Read them from the installed package rather than a docs page — these are
version-matched to the beta in `node_modules`:

```bash
ls node_modules/@qwik.dev/core/dist/starters/features/
cat node_modules/@qwik.dev/core/dist/starters/features/tailwind/package.json
```

At beta.38 the styling-relevant ones are `tailwind` (v4), `tailwind-v3`,
`pandacss`, `styled-vanilla-extract`, `postcss`, `bootstrap`, plus `storybook`.
Each manifest's `__qwik__.viteConfig` block is the canonical wiring — e.g.
Tailwind v4 is `@tailwindcss/vite`'s `tailwindcss()` plugin and nothing else, no
`tailwind.config.js`.

Both `useStyles$` and `useStylesScoped$` exist in Qwik 2 (`public.d.ts`).

### Tailwind v4 as wired here (chosen 2026-08-23)

`tailwindcss` + `@tailwindcss/vite`, both pinned `4.3.3`. **No config file** —
the vite plugin is the entire integration and all theming is in
`src/global.css`. Adding a `tailwind.config.js` would be a v3 habit; v4 reads
`@theme` from CSS.

The one non-obvious thing, worth reading `src/global.css`'s header before
editing it: colours go through **two layers**. `:root` holds `--sem-*` values
that a `prefers-color-scheme` block swaps, and `@theme inline` maps those into
Tailwind's colour namespace.

`inline` is load-bearing. Plain `@theme` emits `--color-x: var(--sem-x)` once at
`:root`, which freezes the light value; `inline` substitutes the `var()` into
each utility so the media query still wins. Dropping the keyword produces a site
that silently ignores dark mode. Verify:

```bash
npm run build && grep -c 'var(--sem-bg)' dist/assets/*.css   # must be > 0
```

Ordering also matters: `tailwindcss()` goes **before** `qwikRouter()` in
`vite.config.ts`, so CSS is transformed before Qwik's optimizer collects styles
for SSG.

## Interactive scaffolding does not work headlessly

`npm run qwik add` uses `@clack/prompts`, which ignores piped stdin and did not
accept input through a pty either. Don't burn attempts on it — read the canonical
config from the starter templates instead:

```bash
gh api repos/QwikDev/qwik/contents/starters/adapters   # list valid integration names
```

## Best practices that shape code here

From <https://next.qwik.dev/docs/guides/best-practices/> — the URL that settled
how components in this repo are written:

- No `useVisibleTask$` for anything derivable; prefer `useComputed$`.
- Hoist computation **out of component bodies**; memoise on a deterministic key.
- Declarative events via `useOn`, not manual listeners.
- No `window.location` — use `useLocation()`.

Worked example of the hoist-and-memoise pattern:
`src/components/generative-mesh/generative-mesh.tsx`.
