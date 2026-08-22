# amannambisan.com

Personal portfolio. Static site on Cloudflare Workers (static assets).

| | |
|---|---|
| Domain | `amannambisan.com` — Cloudflare Registrar |
| Hosting | Cloudflare Workers, static assets (not Pages — see below) |
| Worker name | `amannambisan` |
| Served from | `./public` |
| Deploys | Workers Builds, on push to `main` |
| Cost | $0 — static asset requests are free and unlimited |

## Why Workers and not Pages

Cloudflare points new projects at Workers static assets. Workers reached
feature parity with Pages in March 2026; Pages still gets bug fixes but
Workers gets the roadmap. Nothing is deprecated — this is a greenfield
default, not a migration.

## Why this stays assets-only

`wrangler.jsonc` has no `main` and no `assets.binding`. That is load-bearing,
not laziness: requests served directly from `./public` are free and
unlimited. Adding a script plus `run_worker_first` would route every request
through the Worker and make each one a billable invocation against the
100,000/day free tier.

That is also why `www` is a Redirect Rule rather than a few lines of
JavaScript. Redirect Rules run *before* Workers in Cloudflare's pipeline and
cost no invocations.

## Layout

    wrangler.jsonc     Worker + assets config, and the apex Custom Domain
    package.json       pins wrangler; Workers Builds reads this
    public/
      index.html       placeholder — replace with the real site
      404.html         served for unmatched paths (not_found_handling)

## Setup status

- [x] **1. Domain registered** — Cloudflare Registrar, NS `simone`/`clay`.
- [x] **2. Repo connected** — Workers Builds on `my-neme-eh-jeff/website`,
      branch `main`. Build command empty; deploy defaults to
      `npx wrangler deploy`.
- [x] **3. Apex Custom Domain** — declared in `wrangler.jsonc` `routes` and
      provisioned by `wrangler deploy` inside Workers Builds. The DNS record
      and TLS certificate are created automatically.
- [ ] **4. `www` redirect** — needs two manual steps in the dashboard,
      because Wrangler does not manage arbitrary DNS or Rules:

      a. DNS -> Records -> Add record
         Type A, Name `www`, IPv4 `192.0.2.1`, Proxy status Proxied.
         192.0.2.1 is a reserved documentation address; nothing routes
         there, because the proxy intercepts and the rule below fires.

      b. Rules -> Redirect Rules -> Create rule
         If    hostname equals `www.amannambisan.com`
         Then  Dynamic redirect, status 301, preserve query string
               concat("https://amannambisan.com", http.request.uri.path)

      Dynamic rather than static so deep links keep their path instead of
      collapsing to the homepage.

## Deploying

Push to `main`. Workers Builds deploys automatically.

Local preview needs the `wrangler` CLI (pinned at 4.123.0) and a working
node — see Open items.

    npx wrangler dev        # local preview
    npx wrangler deploy     # manual deploy, bypasses git

## Verifying

    curl -sI https://amannambisan.com | head -3
    curl -sI https://www.amannambisan.com | head -3   # expect 301

## Open items

- **Local node is broken.** `node`, `npm`, and `npx` are nvm shims that fail
  with `command not found: _load_nvm` outside an interactive shell. Nothing
  can run Wrangler locally until a node version is activated. Cloudflare-side
  builds are unaffected.
- **No lockfile.** `wrangler` is pinned to an exact version in
  `package.json`, which is the reproducibility guarantee for now. A real
  lockfile needs working local node. Transitive deps stay unpinned.
- **Custom-domain provisioning in CI is unverified.** Cloudflare's docs do
  not state whether `wrangler deploy` provisions a Custom Domain
  non-interactively. If a build stalls or errors on a prompt, set the
  Workers Builds deploy command to `npx wrangler deploy --yes`.

## Gotchas

- Registrar domains are locked to Cloudflare nameservers. External DNS is
  not possible without transferring the domain out.
- A Custom Domain cannot be attached to a hostname that already has a CNAME
  record.
- A Worker on the apex does **not** receive `www.` requests. Hostname
  matching is exact — hence step 4.
- Deleting a Custom Domain leaves its Advanced Certificate behind; clean it
  up by hand.
