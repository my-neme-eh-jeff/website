# amannambisan.com

Personal portfolio and blog. Qwik 2 compiled to static HTML, served
from Cloudflare Workers static assets.

|           |                                                                 |
| --------- | --------------------------------------------------------------- |
| Domain    | `amannambisan.com` — Cloudflare Registrar                       |
| Framework | Qwik 2 (`@qwik.dev/core`), SSG via the `ssg` adapter            |
| Styling   | Tailwind v4 via `@tailwindcss/vite`; tokens in `src/global.css` |
| Hosting   | Cloudflare Workers static assets                                |
| Output    | `./dist`, prerendered pages + sitemap                           |
| Deploys   | Workers Builds, on push to `main`                               |
| Cost      | $0 — static asset requests are free and unlimited               |

## Local development

`node` and `npm` are shell functions from a broken nvm lazy-loader on this
machine, and they shadow the real Homebrew binaries. Any non-interactive shell
needs them cleared first:

    unset -f node npm npx; export PATH=/opt/homebrew/bin:$PATH

Then:

    pnpm install --frozen-lockfile   # exact install from pnpm-lock.yaml
    pnpm start        # dev server
    pnpm run build    # client + SSG + type check + lint
    pnpm run verify   # assert build invariants against dist/ (after build)
    pnpm run audit    # Lighthouse against production -> tmp/audit.json (not published)
    pnpm run eval     # on the box: ask the shell's models the test questions and check the answers (usage in evals/run.mjs)
    pnpm run bench    # the same from here, desk only, through an ssh tunnel
    pnpm run preview  # serve the built output
    pnpm run fmt      # prettier, incl. Tailwind class sorting
    pnpm run icons    # regenerate favicon/touch icon from one geometry source
    pnpm run fonts    # re-download the self-hosted webfonts

## Version pinning, and why it looks paranoid

Every dependency is pinned **exact** — no carets, no `latest`. This is not
style. The scaffold shipped `^2.0.0-beta.38`, and on a prerelease `^` resolves
`>=2.0.0-beta.38 <3.0.0`, so a plain install silently pulled `beta.39`. Carets
and prereleases do not mix. `pnpm run verify` asserts this on every build.

The 7-day release-age cooldown is still enforced by hand. pnpm gained a
`minimumReleaseAge` setting that would enforce it in the package manager, but
only in **10.34.0**; this repo develops on 10.12.1, and Cloudflare's build image
ships 10.11.1. Worth revisiting on a pnpm upgrade.

Qwik is pinned to **`2.0.0-rc.3`** and `wrangler` to **`4.150.0`**, both
published 2026-10-13 and adopted the next day in cc34369: an exception to the
7-day cooldown, not the rule. `pnpm view @qwik.dev/core time` re-checks the
dates.

## Architecture

### Static, except `/api/*`

Requests served directly from `dist/` are free and unlimited on Workers. The
one Worker script, `src/worker/index.ts`, runs only for `/api/*` via
`run_worker_first: ["/api/*"]`; `true` would route every page view through it
and bill each against the 100,000/day free tier. `pnpm run verify` fails the
build if that scoping is lost.

`POST /api/chat` relays questions typed into the shell to Ollama on
Aman's desk, reached through a Cloudflare Tunnel and a Workers VPC binding, so
the desk has no public hostname. `src/worker/poe.ts` asks Poe instead
(`POE_MODEL`, at most 5 a minute, and only if the `POE_API_KEY` secret is set)
when the desk is off or doesn't answer within 5s, says it's busy because
another model is in use (an eval), or takes the question but sends no answer
text within 30s, or 45s when it must load the model (cold starts took up to
25s). Otherwise the shell says the desk is offline. On the desk a small proxy logs each exchange for 30 days; see
`desk/README.md`. Poe's answers are not in that log.

### Styling: Tailwind v4, and why not a component library

**Qwik UI does not work on Qwik 2.** `@qwik-ui/headless@0.7.7` — the latest, and
the repo's `main` — peer-depends on `@builder.io/qwik` and imports it 200 times;
there is no `@qwik.dev/*` support and no v2 branch. Aliasing the old specifier
to `@qwik.dev/core` builds and then fails at runtime, because v2 changed the
optimizer and serialization contract. Re-check with:

    npm view @qwik-ui/headless peerDependencies

Tailwind v4 was chosen instead. It is a first-party Qwik 2 integration — the
wiring came from `node_modules/@qwik.dev/core/dist/starters/features/tailwind/`,
so it is version-matched to the installed beta — and being CSS-only it is
immune to the Qwik 1/2 split above.

There is no `tailwind.config.js`. The vite plugin is the whole integration and
all theming lives in `src/global.css`. Read that file's header before editing
it: colours are defined in two layers, and the `@theme inline` block is what
lets a single `prefers-color-scheme` media query retint the entire site with
almost no `dark:` variants in markup.

Shared patterns (`pill`, `hairline`, `callout`) are `@utility` blocks in
the same file rather than components, because each one lands on several
different elements — `pill` is used on a Qwik `<Link>`, a plain `<a>` and an
`<li>`.

### Types: strict, plus the checks `strict` misses

`tsconfig.json` turns on `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly` and
the unused-code checks. Each is commented in place with what it costs.

`skipLibCheck` is the one deliberate loosening — Qwik 2's shipped `.d.ts` files
pull in the type surface of every adapter it supports, so checking them fails
the build on upstream errors in code this site never imports. Retest on each
Qwik bump: `pnpm exec tsc --noEmit --skipLibCheck false`.

### CI gates, Cloudflare deploys

`.github/workflows/ci.yml` runs format, lint, types, a real build, and then
`scripts/verify-build.mjs`. It holds **no Cloudflare credentials** and cannot
publish — deploys stay with Workers Builds watching `main`.

`pnpm run verify` is the interesting part: it executes the repo's invariants
against real build output, and prints each one it checks. Add invariants there
rather than to a doc.

It also _warns_, without failing, if the homepage's `description` or
`og:description` contains `TODO` text, which is what a search result and a
shared link would display. It warns rather than fails because it began as a
known pending content state, and a CI job that is red from day one gets
ignored.

### Why `www` is a Redirect Rule, not code

Redirect Rules run _before_ Workers in Cloudflare's pipeline and cost zero
invocations. Doing the redirect in a Worker would require intercepting every
request, which is exactly what the point above avoids.

## Layout

Only what a filename doesn't say; `ls` for the rest.

    wrangler.jsonc              Worker config, apex Custom Domain; free-tier rationale in its comments
    adapters/ssg/vite.config.ts SSG adapter (origin must match the real domain)
    scripts/verify-build.mjs    post-build invariant checks (pnpm run verify)
    scripts/make-icons.mjs      favicon + touch icon (pnpm run icons); never hand-edit the output
    scripts/make-og.mjs         og:image (pnpm run og)
    scripts/make-og-video.mjs   og:video, recorded from dist/ (pnpm run og.video)
    desk/                       runs on Aman's desk, not the site: the chat log proxy
    evals/                      the shell's test questions (cases.mjs), the runner that asks them, and
                                the judges that grade the answers: how and why in its README
    evals/results/              every eval run's raw data, and what it showed (start at its README)
    public/                     copied verbatim into dist/
      _headers                  cache + security headers, rationale in its comments
      robots.txt                crawler allow/deny, rationale in its comments
    src/
      worker/                   the one Worker, /api/* only
      global.css                design tokens, theme swap, shared patterns (read the header)
      content/profile.ts        every fact the pages render
      content/chat.ts           what the shell's model is told, which links it may print, and
                                where its suggested next questions lead
      content/context.ts        what the model knows beyond the CV, in Aman's own words
      content/seo.ts            meta tags + JSON-LD
      content/palettes.ts       every palette's values; theme.ts applies the saved one
      components/desk/          the home page desk, as text and as the WebGL light
      components/terminal/      the shell; theme-pick.tsx is its `theme` picker

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
- [x] **Workers Builds build command** — leave it **empty**. An earlier note
      here said it had to be set to `pnpm run build`; that was wrong. The build
      is versioned in `wrangler.jsonc` as `build.command`, and wrangler runs it
      itself. Verified 2026-10-04 on wrangler 4.147.0:

          pnpm exec wrangler deploy --dry-run   # prints "[custom build]" then builds

      Workers Builds' default deploy command is already `npx wrangler deploy`,
      so filling in the dashboard field as well would build twice.

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

- **`staticAdapter` is deprecated** in favour of `ssgAdapter`. The v1 docs at
  `qwik.dev` still show the old name; v2 docs live at `next.qwik.dev`.
- **Qwik 2 is a release candidate, not stable.** Prerelease since alpha.10
  (2025-05-19); `rc.0` landed 2026-10-02. Pin exact, upgrade deliberately,
  read changelogs.
- **AI / generative UI endpoints are not built.** Inference provider and cost
  controls are undecided. Whatever lands needs a server-side key as a Worker
  secret, per-IP rate limiting, and a spend ceiling before it goes public.

## Gotchas

- Registrar domains are locked to Cloudflare nameservers.
- A Custom Domain cannot attach to a hostname that already has a CNAME record.
- A Worker on the apex does not receive `www.` requests; matching is exact.
- The footer year is baked at build time by SSG, not read from a live clock.
- Deleting a Custom Domain leaves its Advanced Certificate behind.
