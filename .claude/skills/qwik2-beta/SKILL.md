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

| Thing | v1 name (wrong here) | v2 name |
|---|---|---|
| Core package | `@builder.io/qwik` | `@qwik.dev/core` |
| Router package | `qwik-city` / `@builder.io/qwik-city` | `@qwik.dev/router` |
| SSG adapter fn | `staticAdapter` | `ssgAdapter` |
| Virtual config module | `@qwik-city-plan` | `@qwik-router-config` |
| Integration name for `qwik add` | `static` | `ssg` |

Details that cost time to establish:

- **`adapters/ssg/vite` and `adapters/static/vite` are aliases to the same
  module**, and it exports *both* `ssgAdapter` and `staticAdapter`. So a
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
  `sitemap.xml` *and* fails to produce the `dist/404.html` that Cloudflare's
  `not_found_handling: "404-page"` serves.

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
