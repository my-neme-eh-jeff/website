---
name: qwik2-beta
description: Use when touching Qwik 2 APIs, imports, adapters, SSG/build config, or vite config in this repo — or when a Qwik import fails to resolve, an adapter is deprecated, or docs contradict the installed package. Covers the v1/v2 API rename, the SSG adapter, virtual module names, and rollup-vs-rolldown.
---

# Qwik 2 (beta) in this repo

Qwik 2 is a prerelease (beta, now rc) and its published docs have been wrong or version-mismatched
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

# Rollup or rolldown? Vite 8+ is rolldown -> rolldownOptions (rollupOptions is
# only a deprecated alias). Vite 7 is rollup -> rollupOptions.
node -p "require('./node_modules/vite/package.json').version"
grep -rn -E 'rollupOptions|rolldownOptions' node_modules/@qwik.dev/core/dist/starters/adapters/ssg
```

## Snapshot — verified against `2.0.0-rc.2` + vite 8.3.3, 2026-10-13

| Thing                           | v1 name (wrong here)                  | v2 name               |
| ------------------------------- | ------------------------------------- | --------------------- |
| Core package                    | `@builder.io/qwik`                    | `@qwik.dev/core`      |
| Router package                  | `qwik-city` / `@builder.io/qwik-city` | `@qwik.dev/router`    |
| SSG adapter fn                  | `staticAdapter`                       | `ssgAdapter`          |
| Virtual config module           | `@qwik-city-plan` (deprecated alias)  | `@qwik-router-config` |
| Integration name for `qwik add` | `static`                              | `ssg`                 |

Details that cost time to establish:

- **`adapters/ssg/vite` and `adapters/static/vite` are aliases to the same
  module**, and it exports _both_ `ssgAdapter` and `staticAdapter`. So a
  `staticAdapter` import resolves fine and gives no runtime error — it is marked
  `/** @public @deprecated Use ssgAdapter instead. */` in
  `lib/adapters/ssg/vite/index.d.ts`. Deprecation is only visible in the types.
- **`@qwik-city-plan` still resolves** as a deprecated alias (declared in
  `lib/modules.d.ts`), so the grep above counts it. Runtime code that needs the
  route config uses `getRouterConfig()` from `@qwik.dev/router`; the SSG build
  input stays `@qwik-router-config`. Verify:
  `grep -n "qwik-city-plan\|getRouterConfig" node_modules/@qwik.dev/router/lib/{modules,index}.d.ts`
- **`rolldownOptions`, since Vite 8.** At rc.0 and rc.2 the router peers on
  `vite >=8 <9` and an exact `@qwik.dev/core` version, so core, router and
  `eslint-plugin-qwik` move together. Verify:
  `node -p "require('./node_modules/@qwik.dev/router/package.json').peerDependencies"`.
  Qwik's own SSG starter uses `rolldownOptions`. Vite 8 types mark
  `rollupOptions` `@deprecated` (an alias). beta.38's peer range claimed Vite 8
  too, but its client build failed there — trust a build, not the peer range.
- **`@qwik-router-plan` does not exist.** It is a plausible-sounding invention;
  the grep above returns 0 files for it.
- **404 must be a file route** (`src/routes/404.tsx`, not `src/routes/404/`).
  The sitemap exclusion is `result.pathname.endsWith("/404.html")` in
  `lib/chunks/system.mjs` (`routes.mjs` separately forces 404 into the SSG route
  set — `grep -n '404.html' node_modules/@qwik.dev/router/lib/chunks/*.mjs`), so a directory route emitting `/404/` leaks into
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

At rc.0 the styling-relevant ones are `tailwind` (v4), `tailwind-v3`,
`pandacss`, `styled-vanilla-extract`, `postcss`, `bootstrap`, plus `storybook`.
Each manifest's `__qwik__.viteConfig` block is the canonical wiring — e.g.
Tailwind v4 is `@tailwindcss/vite`'s `tailwindcss()` plugin and nothing else, no
`tailwind.config.js`.

Both `useStyles$` and `useStylesScoped$` exist in Qwik 2 (declared in
`dist/core-internal.d.ts`; `public.d.ts` only re-exports).

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
pnpm run build && grep -c 'var(--sem-bg)' dist/assets/*.css   # must be > 0
```

`tailwindcss()` is listed before `qwikRouter()` in `vite.config.ts`, as in the
docs snippet — which gives no reason for the order, so don't treat it as
load-bearing. The check above is what proves the CSS is right.

## Interactive scaffolding does not work headlessly

`pnpm run qwik add` uses `@clack/prompts`, which ignores piped stdin and did not
accept input through a pty either. Don't burn attempts on it — read the canonical
config from the starter templates instead:

```bash
gh api repos/QwikDev/qwik/contents/starters/adapters   # list valid integration names
```

## Best practices that shape code here

From <https://next.qwik.dev/docs/guides/best-practices/> — the URL that settled
how components in this repo are written:

- `useVisibleTask$` is a last resort; derive with `useComputed$` instead.
- Read signals **inside the JSX** rather than into a body variable — the
  optimizer can then update just that binding instead of re-running the
  component. (`layout.tsx` reads `loc.url.pathname` in the template for this.)
- Declarative events via `useOn*`, not manual listeners; pass
  `{ passive: true }` when the handler never calls `preventDefault()`.
- No `window.location` — use `useLocation()`.

**Repo convention, not from the docs:** static data is computed once at module
scope, not in a component body — e.g. `grouped` in `src/routes/resume/index.tsx`.

## Qwik 2 APIs to check before hand-rolling — rc.2, 2026-10-13

```bash
grep -oE '^export declare (const|function) [A-Za-z$]+' node_modules/@qwik.dev/core/dist/core-internal.d.ts
```

- **Prefetch is the preloader, not a service worker.** Configure it with
  `preloader` in `renderToStream` options (`PreloaderOptions | false`; this repo
  passes `false` — see the measured comment in `src/entry.ssr.tsx`).
  `setupServiceWorker` / `service-worker.ts` are `@deprecated`. Verify:
  `grep -n -A25 'interface PreloaderOptions' node_modules/@qwik.dev/core/dist/server.d.ts`
- **`<Link prefetch>` is deprecated** in favour of `prefetchBundles` (default
  `"visible"`) and `prefetchData` (default `"intent"`). Verify:
  `grep -n 'prefetch?:\|prefetchBundles?\|prefetchData?' node_modules/@qwik.dev/router/lib/index.d.ts`
- **`useResource$` is deprecated** — async `useComputed$` replaces it.
- **The root component must never re-render**: `useQwikRouter` throws "can only
  run during SSR" if it does. If root ever needs to read state in its body, use
  `<QwikRouterProvider>` instead. Verify:
  `grep -c 'can only run during SSR' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- New primitives worth knowing: `useConstant`, `createSignal`, `createComputed$`,
  `useSerializer$`, `Show` / `Each` / `Reveal` / `Pending` / `Catch`, and the
  `bind:value` / `passive:` / `capture:` JSX attributes.
- **Docs disagree with themselves on the SSG integration name:**
  `/docs/guides/static-site-generation/` still says `qwik add static`; the
  package and `/docs/deployments/static/` say `ssg`. The package wins.
