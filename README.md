# amannambisan.com

Personal portfolio, blog and resume. Qwik 2 compiled to static HTML, served
from Cloudflare Workers static assets.

| | |
|---|---|
| Domain | `amannambisan.com` — Cloudflare Registrar |
| Framework | Qwik 2 (`@qwik.dev/core`), SSG via the `ssg` adapter |
| Hosting | Cloudflare Workers static assets |
| Output | `./dist` (4 prerendered pages + sitemap) |
| Deploys | Workers Builds, on push to `main` |
| Cost | $0 — static asset requests are free and unlimited |

## Local development

`node` and `npm` are shell functions from a broken nvm lazy-loader on this
machine, and they shadow the real Homebrew binaries. Any non-interactive shell
needs them cleared first:

    unset -f node npm npx; export PATH=/opt/homebrew/bin:$PATH

Then:

    npm ci          # reproducible install from package-lock.json
    npm start       # dev server
    npm run build   # client + SSG + type check + lint
    npm run preview # serve the built output

## Version pinning, and why it looks paranoid

Every dependency is pinned **exact** — no carets, no `latest`. This is not
style. The scaffold shipped `^2.0.0-beta.38`, and on a prerelease `^` resolves
`>=2.0.0-beta.38 <3.0.0`, so a plain `npm install` silently pulled `beta.39`.
Carets and prereleases do not mix.

Qwik is pinned to **`2.0.0-beta.38`** (published 2026-07-16) rather than the
newest beta, to satisfy the 7-day release-age cooldown. `beta.39` was 3 days
old and `beta.40` was 1 day old at the time of writing.

## Architecture

### Why static, and why that is load-bearing

`wrangler.jsonc` has no `main` and no `assets.binding`. Requests served
directly from `dist/` are free and unlimited on Workers. Adding a script plus
`run_worker_first: true` would route every request through the Worker and make
each one a billable invocation against the 100,000/day free tier.

When the AI endpoints land, scope them as `run_worker_first: ["/api/*"]` so
page views stay on the free asset path. Do not use `true`.

### Why `www` is a Redirect Rule, not code

Redirect Rules run *before* Workers in Cloudflare's pipeline and cost zero
invocations. Doing the redirect in a Worker would require intercepting every
request, which is exactly what the point above avoids.

## Layout

    wrangler.jsonc              Worker config, apex Custom Domain, assets dir
    adapters/ssg/vite.config.ts SSG adapter (origin must match the real domain)
    scripts/emit-404.mjs        copies dist/404/index.html -> dist/404.html
    public/                     copied verbatim into dist/
      _headers                  immutable caching for hashed bundles
    src/
      content/profile.ts        ALL site content lives here
      components/               stream-text, generative-mesh
      routes/                   layout + index + resume + blog + 404

### Content

`src/content/profile.ts` holds every fact on the site. Editing content means
touching one typed file, and it keeps a future framework port cheap — you
rewrite components, not content.

`roles` and `skills` ship **empty on purpose.** Inventing someone's job history
is not a placeholder. Fill them in; the pages render empty-state notes until
you do.

## Qwik best practices applied

Audited against <https://next.qwik.dev/docs/guides/best-practices/>:

- **No `useVisibleTask$` anywhere.** The token-stream reveal is pure CSS. A JS
  typewriter starting from an empty string would prerender a page with no text,
  which defeats SSG for SEO and for no-JS readers. The text ships in the HTML;
  CSS only animates its arrival.
- **Computation hoisted out of component bodies.** Mesh geometry is memoised
  per seed outside the component; the blog sort runs once at module scope.
- **No `window.location`** — routing goes through Qwik's own helpers.
- **Deterministic generative art.** The mesh uses a seeded PRNG, not
  `Math.random()`. SSG runs at build time, so random values would rewrite the
  HTML on every deploy and churn the diff.
- `prefers-reduced-motion` is honoured by every animation.

## Setup status

- [x] Domain registered — Cloudflare Registrar
- [x] Repo connected — Workers Builds on `my-neme-eh-jeff/website`
- [x] Apex Custom Domain — declared in `routes`, provisioned by Workers Builds.
      Verified: HTTP 200, TLS valid
- [ ] **Workers Builds build command** — currently empty, which was right for
      hand-written HTML and is now wrong. Must be set to `npm run build` in the
      dashboard, or deploys will publish nothing. Dashboard-only setting.
- [ ] **`www` redirect** — two manual dashboard steps:

      a. DNS -> Records -> Add: type A, name `www`, IPv4 `192.0.2.1`, Proxied.
         192.0.2.1 is a reserved documentation address; nothing routes there,
         the proxy intercepts and the rule below fires.

      b. Rules -> Redirect Rules -> Create:
         If    hostname equals `www.amannambisan.com`
         Then  Dynamic redirect, 301, preserve query string
               concat("https://amannambisan.com", http.request.uri.path)

## Verifying

    curl -sI https://amannambisan.com | head -3
    curl -sI https://www.amannambisan.com | head -3   # expect 301
    curl -s https://amannambisan.com/sitemap.xml

If curl says "Could not resolve host" while `dig +short A amannambisan.com`
returns records, that is a stale negative entry in the local resolver, not an
outage. Flush with
`sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`.

## Open items

- **Rolldown migration is coming.** `adapters/ssg/vite.config.ts` uses
  `build.rollupOptions`, because beta.38 ships vite 7.3.1 on rollup ^4.43.0.
  Qwik's `main` template already uses `rolldownOptions`, and the lead
  maintainer's active repos are rolldown deploy experiments. Expect to rename
  that key when upgrading past beta.38.
- **`staticAdapter` is deprecated** in favour of `ssgAdapter`. The v1 docs at
  `qwik.dev` still show the old name; v2 docs live at `next.qwik.dev`.
- **Qwik 2 is a beta with no ship date.** Prerelease since alpha.10
  (2025-05-19). Pin exact, upgrade deliberately, read changelogs.
- **AI / generative UI endpoints are not built.** Inference provider and cost
  controls are undecided. Whatever lands needs a server-side key as a Worker
  secret, per-IP rate limiting, and a spend ceiling before it goes public.
- **No CSP.** Qwik's resumability uses inline scripts, so a policy needs
  nonce/hash plumbing rather than a one-line guess.

## Gotchas

- Registrar domains are locked to Cloudflare nameservers.
- A Custom Domain cannot attach to a hostname that already has a CNAME record.
- A Worker on the apex does not receive `www.` requests; matching is exact.
- The footer year is baked at build time by SSG, not read from a live clock.
- Deleting a Custom Domain leaves its Advanced Certificate behind.
