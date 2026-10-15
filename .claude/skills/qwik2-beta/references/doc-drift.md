# Known doc drift: next.qwik.dev vs rc.3

Re-check before trusting either side. Linked from `../SKILL.md`.

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
  against `public.d.ts` (`../SKILL.md`, "Where the truth lives"), not the API page.
- `DocumentHeadTags` "normally only runs once, during SSR" (`/docs/api` and the
  router's `.d.ts`): it re-renders on navigation, so title, description and
  `og:` tags follow a client-side click.
  `grep -n 'trackWholeStore(useDocumentHead())' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- `ssrPreloads: 0` "will disable all preload links": the preloader, bundle-graph
  and core links stay (`../SKILL.md`, the preloader traps).
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
