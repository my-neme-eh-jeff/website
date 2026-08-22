# amannambisan.com

Personal portfolio. Static site on Cloudflare Workers (static assets).

| | |
|---|---|
| Domain | `amannambisan.com` — Cloudflare Registrar |
| Hosting | Cloudflare Workers, static assets (not Pages — see below) |
| Worker name | `amannambisan` |
| Served from | `./public` |
| Cost | $0 on the Workers free tier |

## Why Workers and not Pages

Cloudflare points new projects at Workers static assets. Workers reached
feature parity with Pages in March 2026; Pages still gets bug fixes but
Workers gets the roadmap. Nothing is deprecated — this is a greenfield
default, not a migration.

## Layout

    wrangler.jsonc     Worker + assets config
    package.json       pins wrangler; Workers Builds reads this
    public/
      index.html       placeholder — replace with the real site
      404.html         served for unmatched paths (not_found_handling)

`wrangler.jsonc` omits both `main` and `assets.binding` on purpose.
Assets-only Workers are explicitly supported, and `binding` is only
valid alongside a `main` script. Add both together if this site ever
needs server-side code.

## First-time setup

Steps 1 and 3 need a Cloudflare account and a payment method.

1. **Register the domain.** dash.cloudflare.com → Domain Registration →
   Register Domains → `amannambisan.com`. Account email must be verified
   first. Contact details must be ASCII-only.

2. **Push this repo.** Workers Builds deploys from GitHub, so
   `wrangler.jsonc` and `public/` must exist on the remote. As of this
   writing the remote has only the initial commit — connecting the repo
   before pushing deploys an empty site.

3. **Create the Worker from the repo.** Workers & Pages → Create →
   Workers → connect `my-neme-eh-jeff/website`. Leave **build command
   empty** — it is optional and only needed for frameworks that compile
   (Next, Remix). The deploy command defaults to `npx wrangler deploy`.

4. **Attach the domain.** Worker → Settings → Domains & Routes → Add →
   Custom Domain → `amannambisan.com`. DNS record and TLS cert are
   created automatically because the zone is in the same account.

5. **Handle `www` separately.** A Worker on the apex does *not* receive
   `www.` requests — hostname matching is exact. Add a proxied DNS
   record for `www` plus a redirect rule to the apex.

## Deploying

Push to the default branch. Workers Builds deploys automatically.

Local preview needs the `wrangler` CLI (pinned at 4.123.0):

    npx wrangler dev        # local preview
    npx wrangler deploy     # manual deploy, bypasses git

## Open items

- **No lockfile.** `wrangler` is pinned to an exact version in
  `package.json` (no caret), which is the reproducibility guarantee for
  now. A real lockfile needs a working local node to generate — see
  below. Wrangler's own transitive deps stay unpinned until then.
- **Local node is inert.** `node` and `npm` resolve on PATH but report no
  version — version-manager shims with nothing activated. Only affects
  local preview; Cloudflare builds are unaffected.

## Gotchas

- Registrar domains are locked to Cloudflare nameservers. External DNS
  is not possible without transferring the domain out.
- A Custom Domain cannot be attached to a hostname that already has a
  CNAME record.
- Deleting a Custom Domain leaves its Advanced Certificate behind; clean
  it up by hand.
