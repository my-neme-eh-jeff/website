Aman Nambisan's portfolio and blog, at
[amannambisan.com](https://amannambisan.com).

## Highlights

- **Built with [Qwik 2](https://next.qwik.dev),** still a release candidate.
  Every page is prerendered to static HTML, and Qwik resumes it instead of
  hydrating, so code runs only when something on the page needs it.
- **$0 to host.** Cloudflare serves `dist/` as static assets, which are free.
  The one Worker runs only for `/api/*`, so page views never count against its
  100k-a-day free tier.
- **A chat served from a home PC.** Type `chat` in the shell and Gemma 4
  26B-A4B answers from Ollama on the desk, through a Cloudflare Tunnel. Poe
  answers when the desk is off or busy.
- **The model was picked by evals, not by eye.** A test set of 184 questions,
  judges from several AI companies, and every run committed here.
  [Results below](#evals).
- **An ASCII desk lit by WebGL.** The home page's desk is drawn in text, and a
  shader draws its lamp light. Every animation honours
  `prefers-reduced-motion`.
- **Invariants run against the real build.** `pnpm run verify` checks `dist/`
  after every build: no caret versions, WCAG AA contrast in every palette,
  WebP-only images, a per-page CSP, and the Worker scoped to `/api/*`.

## Evals

The chat is tested the way visitors meet it. The runner imports the site's
prompt and the Worker's relay code, asks every test question, and grades the
answers with code checks and a panel of judge models. Judges come from
different companies, and none grades a model from its own maker. Prompts are
tuned on one set of wordings and checked on held-out ones.

Runs execute on the desk (`pnpm run eval`), and `pnpm run eval --publish <run>`
copies a run into [`evals/results/runs/`](evals/results/runs/), so every
number below has its raw answers and judge votes in the repo.

**Choosing the desk model.** Six open models that fit on the desk ran against
gpt-oss-20b, the model it served at the time, on 117 questions. The two best
then answered all 184 wordings three times each.

| Model                     | Bake-off: accurate / all right | Final round: accurate / all right | First word |
| ------------------------- | ------------------------------ | --------------------------------- | ---------- |
| gpt-oss-20b (previous)    | 82% / 65%                      | —                                 | 1.8s       |
| Qwen3.6-35B-A3B           | 96% / 62%                      | 88% / 52%                         | 2.0s       |
| **Gemma 4 26B-A4B** (now) | 91% / 89%                      | 86% / **84%**                     | **0.8s**   |

_Accurate_ means right on facts and behaviour. _All right_ also requires the
formatting and the three suggested follow-up questions to be right. The winner
rule was written before grading: accuracy was a statistical tie, so answers
fully right decided it.

More in [`evals/README.md`](evals/README.md) and the write-ups:
[prompt rules](evals/results/2026-10-19-prompt-rules.md),
[the bake-off](evals/results/2026-10-20-desk-model-bake-off.md),
[the final round](evals/results/2026-10-22-desk-model-finalists.md).

## Layout

Only what a filename doesn't say; `ls` for the rest.

    wrangler.jsonc              Worker config, apex Custom Domain; free-tier rationale in its comments
    adapters/ssg/vite.config.ts SSG adapter (origin must match the real domain)
    scripts/verify-build.mjs    post-build invariant checks (pnpm run verify)
    scripts/csp.mjs             per-page Content-Security-Policy, appended to dist/_headers by build
    scripts/make-icons.mjs      favicon + touch icon (pnpm run icons); never hand-edit the output
    scripts/make-og.mjs         og:image (pnpm run og)
    scripts/make-og-video.mjs   og:video, recorded from dist/ (pnpm run og.video)
    desk/                       runs on Aman's desk, not the site: the chat log proxy
    evals/                      the chat's test questions, the runner and the judges: how and why in its README
    evals/results/              every eval run's raw data, and what it showed (start at its README)
    public/                     copied verbatim into dist/
      _headers                  cache + security headers, rationale in its comments
      robots.txt                crawler allow/deny, rationale in its comments
    src/
      worker/                   the one Worker, /api/* only
      global.css                design tokens, theme swap, shared patterns (read the header)
      content/profile.ts        every fact the pages render
      content/chat.ts           what the chat's model is told, which links it may print, and
                                where its suggested next questions lead
      content/context.ts        what the model knows beyond the CV, in Aman's own words
      content/seo.ts            meta tags + JSON-LD
      content/palettes.ts       every palette's values; theme.ts applies the saved one
      components/desk/          the home page desk, as text and as the WebGL light
      components/terminal/      the shell; theme-pick.tsx is its `theme` picker

## Getting started

Needs Node 24 (`.node-version`) and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm start           # dev server
pnpm run build       # client + SSG + type check + lint
pnpm run verify      # check the build's invariants against dist/
pnpm run preview     # serve the built output
```

Also: `fmt` (Prettier with Tailwind class sorting), `audit` (Lighthouse
against production), `icons`, `fonts`, `og` and `og.video` (regenerate those
assets), and `eval` / `bench` ([Evals](#evals)).

Every push to `main` deploys through Cloudflare Workers Builds.

## How it works

```text
browser ─┬─ every page ──► Cloudflare static assets (dist/)            free
         └─ /api/chat ───► Worker ─┬─► Workers VPC ─► Tunnel ─► desk proxy ─► Ollama
                                   └─► Poe, when the desk is off, busy or slow
```

`wrangler.jsonc` sets `run_worker_first: ["/api/*"]`; `true` would route every
page view through the Worker, and `verify` fails the build if that happens. The
desk proxy keeps each exchange as an OpenTelemetry trace for 30 days; see
[`desk/README.md`](desk/README.md).
