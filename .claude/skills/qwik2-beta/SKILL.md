---
name: qwik2-beta
description: Use when touching Qwik 2 APIs, imports, routing, <Link>/prefetching, view transitions, adapters, SSG/build config, or vite config in this repo — or when a Qwik import fails to resolve, an API looks deprecated, or docs and the installed package disagree. An index of where the truth lives (the live docs as markdown, and node_modules), plus the traps this repo has hit, each with a command that re-checks it.
---

# Qwik 2 (rc) in this repo

**This skill is an index, not a reference.** It does not restate the docs; it
says where to read them and how to check them against the package that is
actually installed. Read the page every time — a copy written here goes stale
the next release, and a stale note gets trusted instead of checked. Every claim
below carries a command; if the output disagrees with the prose, the output
wins and the prose gets fixed.

## Where the truth lives, in order

1. **The installed package** — it is what runs.
   - Version: `node -p "require('./node_modules/@qwik.dev/router/package.json').version"`
   - Types: `node_modules/@qwik.dev/core/public.d.ts` is what `@qwik.dev/core`
     exports; `dist/core-internal.d.ts` also declares names only
     `@qwik.dev/core/internal` exports. Router: `router/lib/index.d.ts`; server
     render options: `core/dist/server.d.ts`.
   - Behaviour: `node_modules/@qwik.dev/router/lib/index.qwik.mjs` (Link,
     useQwikRouter, navigation, prefetch), `node_modules/@qwik.dev/core/dist/{core,server,preloader}.mjs`
2. **The live docs, as markdown.** <https://next.qwik.dev/llms.txt> lists every
   page, and any page is served as raw markdown at its path plus `.md`, so grep
   it rather than skim it:
   `curl -s https://next.qwik.dev/docs/api.md | grep -n -A5 prefetchBundles`
   - `qwik.dev` without `next.` is Qwik 1. None of it applies.
   - `/api/*` reference pages are generated from Qwik's main branch and can
     describe APIs newer than what is installed — confirm in the `.d.ts` first.
   - Prose pages contradict each other and the package (below). The package wins.
3. **This repo's executed invariants:** `pnpm run build && pnpm run verify`.

## Where to look, by topic

Docs paths are under `https://next.qwik.dev`; append `.md` for markdown.

| Topic                                 | Read                                                                                                   | Check in the package                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `<Link>`, useNavigate, useLocation    | `/docs/api` (#link, #prefetch, #uselocation)                                                           | `grep -n 'var Link' -A60 node_modules/@qwik.dev/router/lib/index.qwik.mjs`                                     |
| Preloader, bundle prefetch            | `/docs/advanced/modules-prefetching`, `/docs/advanced/speculative-module-fetching`, `/api/qwik-server` | `grep -n -A25 'interface PreloaderOptions' node_modules/@qwik.dev/core/dist/server.d.ts`                       |
| View transitions                      | `/docs/cookbook/view-transition`, `/api/qwik-router` (QwikRouterProps)                                 | `grep -n 'startViewTransition' node_modules/@qwik.dev/router/lib/index.qwik.mjs`                               |
| `head`, DocumentHeadTags, frontmatter | `/docs/pages` (#head-export)                                                                           | `grep -n -A8 'var resolveDocumentHead' node_modules/@qwik.dev/router/lib/chunks/head.qwik.mjs`                 |
| Layouts, 404, route groups            | `/docs/layout`, `/docs/advanced/routing`                                                               | `grep -n 'contents\[i\].default' node_modules/@qwik.dev/router/lib/index.qwik.mjs`                             |
| SSG adapter                           | `/docs/deployments/static`                                                                             | `node -e 'import("@qwik.dev/router/adapters/ssg/vite").then(m=>console.log(Object.keys(m)))'`                  |
| MDX                                   | `/docs/guides/mdx`                                                                                     | `grep -n 'table-wrapper\|rehypeAutolinkHeadings' node_modules/@qwik.dev/router/lib/vite/index.mjs`             |
| Integrations (Tailwind, images, …)    | `/docs/integrations`                                                                                   | `ls node_modules/@qwik.dev/core/dist/starters/features/` — each `package.json` holds the canonical vite wiring |
| Hooks and primitives that exist       | `/api/qwik`, `/docs/guides/best-practices`                                                             | `sed -n '/^export {/,/^}/p' node_modules/@qwik.dev/core/public.d.ts`                                           |
| Renamed or removed since v1           | `/docs/upgrade`, `/docs/deprecated-features`                                                           | `grep -rn deprecated node_modules/@qwik.dev/router/lib --include="*.d.ts"`                                     |

## Traps this repo has hit

Each cost real time, and none is stated accurately on the docs site.

- **`preloader: false` silently disables every `<Link>` prefetch.** Link hands
  bundle names to the preloader, and core drops them until the preloader module
  has set `globalThis.qPreload`. Measured cost and the trade: `src/entry.ssr.tsx`.
  `grep -n -A3 'const requestPreload' node_modules/@qwik.dev/core/dist/core.mjs`
- **`maxIdlePreloads` caps concurrency, not volume, and `0` is ignored.**
  `grep -n 'options.maxIdlePreloads' node_modules/@qwik.dev/core/dist/server.mjs`
- **`useLocation()` readers update after the view transition captures the new
  page**, so anything that should look right in the transition must come from
  head instead; `src/routes/layout.tsx` reads `head.frontmatter`. `headUpdated`
  runs in the update callback, the forced `url` effects in `.finally` after
  `ready`:
  `grep -n 'const headUpdated\|forceStoreEffects(routeLocation, "url")' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- **A transition name shared by consecutive pages morphs one into the other**,
  across any scroll offset. Name content per page from head (`layout.tsx`'s
  `head` function keys it on the path). Renaming in a `qviewtransition`
  handler's `updateCallbackDone.then` does not work: Chrome has already
  captured the new page by then.
- **A JSX expression only becomes a signal binding if it has no function or
  method call, names nothing from module scope, and is at most 150 characters.**
  Otherwise rc.3 evaluates it in the render, which subscribes the whole
  component, so it re-runs on every change -- silently. "Module scope" is by
  name: a local `head` in a route file that also exports `head` counts, and
  blocks every expression that uses it. A long Tailwind ternary is enough to
  trip the length limit. The bindings a page got are its serialised functions:
  `grep -o '<script q:func="qwik/json">.*</script>' dist/index.html`. For the
  root layout this is a `pnpm run verify` invariant. To see compiled output,
  `pnpm run build.client` (4 s) and read `dist/build/`; `createOptimizer` is in
  `optimizer.d.ts` but not exported at runtime:
  `node --input-type=module -e 'import("@qwik.dev/core/optimizer").then(m=>console.log(Object.keys(m)))'`
- **The preloader's own two links cost first paint even with `ssrPreloads: 0`**
  (the default). The server always puts the preloader module and the bundle
  graph in `<head>`, ahead of the stylesheet, though the bootstrap only uses
  them after load and an idle callback. Measured trade: `src/entry.ssr.tsx`.
  `grep -n -A50 'var preloaderPre' node_modules/@qwik.dev/core/dist/server.mjs`
- **The cookbook says Qwik un-captures root during navigation; in Chrome it does
  not** — the injected selector is a descendant `& :root`.
  `grep -o 'active-view-transition-type(qwik-navigation){[^}]*}' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- **Never name a full-viewport or blended layer for a transition.** Why:
  `src/global.css`, view-transition note. Asserted by `pnpm run verify`; see what
  a transition looks like with `node scripts/measure-nav.mjs --frames <dir>`.
- **Root must never re-render** — `useQwikRouter` throws if it does. Read route
  state in root only inside JSX bindings (the canonical link does).
  `grep -c 'can only run during SSR' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- **404 is a file route** (`src/routes/404.tsx`). A directory route leaks into
  the sitemap and never produces the `dist/404.html` Cloudflare serves. Asserted
  by verify. `grep -n '404.html' node_modules/@qwik.dev/router/lib/chunks/*.mjs`
- **MDX:** `~/` does not resolve from an `.mdx` file (use relative imports);
  heading autolinks are off in `vite.config.ts`; refractor `token` classes and
  `div.table-wrapper` need rules under `.post` or verify's class check fails.
  Frontmatter and an explicit `head` export cannot coexist: any frontmatter
  makes the plugin emit its own `head`, and the build fails with
  `Duplicated export 'head'` -- posts use `postHead()`.
  `grep -n 'createExport(mdast, "head"' node_modules/@qwik.dev/router/lib/vite/index.mjs`
- **Vite 8 is rolldown:** `rolldownOptions`, not the deprecated `rollupOptions`.
  `grep -rn -E 'rollupOptions|rolldownOptions' node_modules/@qwik.dev/core/dist/starters/adapters/ssg`
- **Virtual config module:** `@qwik-router-config`. `@qwik-city-plan` is a
  deprecated alias; `@qwik-router-plan` does not exist.
  `for n in @qwik-router-config @qwik-city-plan @qwik-router-plan; do echo "$n $(grep -rl "$n" node_modules/@qwik.dev/router/lib | wc -l)"; done`
- **Qwik UI, and any library importing `@builder.io/qwik`, is Qwik 1 only.**
  Aliasing v1 to v2 builds and then fails at runtime. Still blocked if this
  prints `@builder.io/qwik`: `npm view @qwik-ui/headless peerDependencies`.
  CSS-only systems are unaffected.
- **`pnpm run qwik add` needs a real terminal** and ignores piped input. Read
  the starters instead: `ls node_modules/@qwik.dev/core/dist/starters/{adapters,features}/`
- **Tailwind v4 has no config file here**, and `@theme inline` is load-bearing
  for dark mode — read the header of `src/global.css` before touching colour.

## Known doc drift

Re-check before trusting either side.

- SSG integration: `/docs/guides/static-site-generation` says `qwik add static`;
  `/docs/deployments/static` says `ssg`. The adapter module exports both
  `ssgAdapter` and the deprecated `staticAdapter`.
- Service-worker prefetching is still described as current on some pages; it is
  deprecated. `grep -n deprecated node_modules/@qwik.dev/router/lib/service-worker.d.ts`
- `/docs/api` says `useLocation` in root.tsx is unsupported, then uses it there
  in its own `DocumentHeadTags` sample. A JSX-only read like `href={url.href}` is
  compiled to a signal binding and does not re-render root.
- Several pages still import from `@builder.io/qwik`.
- `/api/qwik` documents names `@qwik.dev/core` does not export (e.g.
  `unwrapStore`, `forceStoreEffects`, `TaskOptions`); they live in
  `@qwik.dev/core/internal`, and `tsc` rejects them from the main entry. Check
  against `public.d.ts` (the table above), not the API page.
- `DocumentHeadTags` "normally only runs once, during SSR" (`/docs/api` and the
  router's `.d.ts`): it re-renders on navigation, so title, description and
  `og:` tags follow a client-side click.
  `grep -n 'trackWholeStore(useDocumentHead())' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- `ssrPreloads: 0` "will disable all preload links": the preloader, bundle-graph
  and core links stay (see the preloader trap).
- `bind:value` is typed `Signal<number>` on any input, but only
  `type="number"` converts; a bound range input writes strings.
  `grep -n -A5 'function _val' node_modules/@qwik.dev/core/dist/core.mjs`
- `/docs/deprecated-features` is the v1 list. rc.3's deprecations are in the
  types, including the router's subfolders (`staticAdapter` is in
  `lib/adapters/ssg/vite/`):
  `grep -rn '@deprecated' node_modules/@qwik.dev/router/lib node_modules/@qwik.dev/core/dist --include='*.d.ts'`
- The `.md` mirrors drop JSX tags inside inline code and some lists (`/docs/upgrade`,
  `/docs/integrations`). If a section reads empty, open the HTML page.
- `/docs/guides/mdx` says `useContent().headings` exist only on the client;
  rc.3 fills them during SSG.
  `grep -n 'headings: pageModule.headings' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- There is no `q-data.json` in rc.3, whatever the deployment pages say: loader
  data is `q-loader-<id>.<hash>.json`, and SSG writes it only for `immutable`
  loaders (this site has none). `grep -rl q-data node_modules/@qwik.dev/router/lib | wc -l` is 0.
- The build prints "Qwik Router SSG was skipped ... no pages were
  prerendered", then prerenders every page (rc.3 on Vite 8: two plugin
  instances). Trust `pnpm run verify`'s page counts, not that line.
- `?jsx` image imports (built into `qwikRouter()`; the docs promise avif too)
  emit WebP only, at quality 75 and widths 200-1200, with `loading="lazy"` and
  no `src` or `sizes`: an image above the fold needs `loading="eager"` and a
  real `sizes` passed in.
  `grep -n -A12 'function createImageJsxDirectives' node_modules/@qwik.dev/router/lib/vite/index.mjs`
- Paths the docs get wrong: `extendConfig` is exported from
  `@qwik.dev/router/vite`, the SSG adapter is `.../adapters/ssg/vite` (not
  `/vite/ssg`), and there is no Cloudflare Workers adapter -- its starter
  aliases `cloudflarePagesAdapter`. `node -p "Object.keys(require('./node_modules/@qwik.dev/router/package.json').exports)"`

**Repo convention, not from the docs:** static data is computed once at module
scope, not in a component body (e.g. `sorted` in `src/routes/blog/index.tsx`).
