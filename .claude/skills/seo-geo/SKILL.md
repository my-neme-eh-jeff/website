---
name: seo-geo
description: Use when working on SEO, structured data, JSON-LD, meta tags, sitemaps, robots.txt, AI-crawler policy, or making this site citable by AI answer engines (ChatGPT, Claude, Perplexity, AI Overviews). Includes a disconfirmed list — check it before building llms.txt or similar.
---

# SEO and generative-engine optimisation

Researched 2026-08-22. The **disconfirmed** section is the most valuable part —
read it before building anything, because these ideas keep resurfacing.

## Disconfirmed — do not build these

- **`llms.txt` / `llms-full.txt`.** Not merely unproven; there is evidence
  against it. Google states in writing that Search "doesn't use them"; John
  Mueller compared it to the keywords meta tag and noted server logs show AI
  services don't request the file. An SE Ranking study across ~300,000 domains
  found no significant correlation with AI citations — and _removing_ the feature
  **improved** their model's accuracy, i.e. it was noise. Claims that Claude or
  Perplexity "confirmed" reading it appear only in SEO blogs, never in either
  company's crawler documentation.
- **Keyword stuffing.** The one peer-reviewed study in this space (KDD '24,
  <https://arxiv.org/abs/2311.09735>) scored it **worse than baseline** —
  17.8 vs 19.3. Citations, quotations and statistics were the levers that
  lifted visibility ~40%.
- **A Wikidata entry for yourself.** Gets deleted as self-promotion without
  independent coverage.
- **`SearchAction` in JSON-LD.** Google retired the sitelinks search box in
  October 2024. Emitting it does nothing.
- **`BreadcrumbList` on a flat site.** Nothing to describe.
- **AI-visibility SaaS dashboards.** No verified methodology found.

## Retrieval vs training crawlers — the distinction everything conflates

Two separate questions with separate controls. Getting this wrong either blocks
citations or opts into training by accident.

| Bot                | Purpose                  | Blocking it means                   |
| ------------------ | ------------------------ | ----------------------------------- |
| `OAI-SearchBot`    | ChatGPT **retrieval**    | ChatGPT can't cite the site         |
| `GPTBot`           | OpenAI **training**      | Excluded from model weights         |
| `Claude-SearchBot` | Claude **retrieval**     | Claude can't cite the site          |
| `ClaudeBot`        | Anthropic **training**   | Excluded from model weights         |
| `PerplexityBot`    | Perplexity **retrieval** | Not in Perplexity answers           |
| `Google-Extended`  | Gemini **training** only | No effect on Search or AI Overviews |
| `CCBot`            | Common Crawl             | Excluded from many training sets    |

**`ChatGPT-User` and `Perplexity-User` ignore robots.txt by their own
documentation.** They fetch live when a user asks about you. So for
"who is this person?" queries, robots.txt is nearly irrelevant — what matters is
that the page loads fast and says something true in its first 200 words.

Current policy and how to flip it: `public/robots.txt` comments.

## Structured data rules that bite

- **One `@graph` per page**, with `@id` cross-references between entities. Not
  several sibling `<script>` blocks.
- **`ProfilePage` requires `mainEntity`.** Without it the markup is inert.
- **There is no standalone `Person` rich result.** `Person` earns its place by
  disambiguating an entity, not by producing a search feature.
- **`JSON.stringify` does not escape `<`.** An unescaped `</script>` in any
  content field breaks out of the tag. See `ld()` in `src/content/seo.ts`.
- **Emit canonical in exactly one place.** `links` are additive in Qwik, so a
  route-level canonical on top of `root.tsx`'s creates two conflicting tags.
- **`sameAs` is the strongest entity-disambiguation tool available** — and a
  stale or wrong URL there actively harms it. Only list confirmed-live profiles,
  and make them reciprocal (each profile links back to the domain).

Generator for all of the above: `src/content/seo.ts`. Verify the built output,
not the source:

```bash
pnpm run build
grep -o 'application/ld+json' dist/index.html | wc -l   # expect exactly 1
node -e 'const h=require("fs").readFileSync("dist/index.html","utf8");
 const m=h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
 console.log(JSON.parse(m[1])["@graph"].map(n=>n["@type"]));'
```

## Ranked by value per minute

1. **Check Cloudflare → AI Crawl Control** isn't set to Block for Search/Agent/
   Training, and that the legacy "Block AI bots" toggle is off. A spoofed-user-agent
   curl **cannot** detect this — Cloudflare verifies bots by IP and reverse DNS —
   so it must be checked in the dashboard. Failure mode is total invisibility.
2. **Content.** Both research passes independently put this at ~80% of the
   achievable outcome. Retrieval systems select passages; a page of placeholders
   has no passages to select.
3. **Google Search Console** as a _Domain_ property, DNS-verified via a Cloudflare
   TXT record — keeps the token out of the repo. Then Bing Webmaster Tools.
4. Structured data and meta tags — already implemented; low remaining upside.

## Where the site is weakest, structurally

For "recruiter asks an AI about this person", LinkedIn and GitHub are
higher-leverage surfaces than this site — they're searched directly and indexed
heavily. This site's distinctive job is being the one canonical, self-authored
page an engine can quote _accurately_ rather than reconstructing from a profile
blob. Optimise for quotability, not for ranking.

A mismatch between the GitHub handle and the domain/display name weakens entity
resolution, because nothing textually connects them. Cheapest fix that breaks
nothing: set the GitHub display name and website field to match the site exactly.
