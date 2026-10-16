---
name: a11y-ui
description: Use for ANY UI work in this repo - new components, restyling, colour or token changes, layout, animation. Covers the accessibility bar this project holds itself to, what `pnpm run verify` already enforces, what it cannot check, and the Qwik 2 + Tailwind v4 gotchas that have actually bitten here.
---

# Accessibility for UI work in this repo

Accessibility is treated as a build constraint here, not a review step. A good
share of it is machine-checkable and therefore checked; the rest needs a human
and is listed honestly below.

**Do this first, before reading further:**

```bash
pnpm run build && pnpm run verify
```

## What is already enforced

`scripts/verify-build.mjs` fails the build on these. Add to it rather than
writing a new doc.

| Check                                                                     | Bar                  |
| ------------------------------------------------------------------------- | -------------------- |
| `--sem-text` / `--sem-muted` on `--sem-bg`, every palette and mode        | ≥ 4.5:1 (WCAG 1.4.3) |
| `--sem-accent` on `--sem-bg`, every palette and mode (the focus ring)     | ≥ 3:1 (WCAG 1.4.11)  |
| `--sem-accent` / `--sem-danger` on `--sem-bg` and `--sem-surface` (text)  | ≥ 4.5:1 (WCAG 1.4.3) |
| Core tokens are six-digit hex (the desk's WebGL light parses them)        | every palette        |
| `--sem-alt` / `--sem-cta` on `--sem-bg` and `--sem-surface` (text)        | ≥ 4.5:1 (WCAG 1.4.3) |
| Skip link present, first focusable, target exists and has `tabindex="-1"` | per page             |
| `lang` attribute, exactly one `<h1>`, no skipped heading levels           | per page             |
| Every `<img>` has `alt`; every `<svg>` is named or `aria-hidden`          | per page             |
| `text-x` on a `bg-y/n` tint, over `--sem-bg` and `--sem-surface`          | ≥ 4.5:1 (WCAG 1.4.3) |
| Overflowing sideways scrollers get a tab stop (the layout's handler)      | per page (2.1.1)     |
| No control is named by a `<label>` that wraps a live region               | per page (4.1.2)     |
| The shell's mute button is labelled from storage before first paint       | home (4.1.2)         |
| Its light/dark button: labelled likewise, disabled on one-mode themes     | home (4.1.2)         |

The accent bar is not cosmetic bookkeeping: **`:focus-visible` is drawn in
`--sem-accent`**, so the accent's contrast IS the focus indicator's contrast.
Change the accent and you have changed a conformance property.

## The colour trap this repo already fell into

The original palette's clay (`#d97757`) is **2.99:1 on its light page
(`#fbfaf8`)**. It shipped with a comment claiming it "clears 4.5:1 on both
grounds", which was simply wrong. The light theme's focus ring was
non-conformant by 0.01 — invisible to inspection, obvious to arithmetic.

Hence two clays in the `paper` palette: `#d97757` on dark grounds (6.05:1 on
`#12110d`) and `#bd5334` (4.52:1) on light. The same arithmetic moved Wada's
light accent from Raw Sienna (3.31:1) to Burnt Sienna (4.52:1). **Never assume
a colour works on both grounds.** Compute it:

```bash
pnpm run verify   # recomputes every palette in src/content/palettes.ts
```

## What automation here does NOT check

Do not read a green `verify` as "accessible". These need a person:

- **Keyboard path.** Tab through the whole page. Every interactive element must
  be reachable, in visual order, with a visible ring, and nothing may trap
  focus. Automation cannot see tab order.
- **Focus ring against real backgrounds.** The check tests accent-on-`--sem-bg`.
  A control sitting on `--sem-surface` or on the mesh figure is a different
  pairing. Never draw the ring on the blog's terminal ground (`--term-bg`,
  `#14130f`): the light palettes' accents are under 3:1 there (modus light
  1.78, acme light 1.29, computed 2026-10-16). `statusline/terminal.tsx` rings
  the frame instead, on the page's ground.
- **Text over the field wash.** Every `--sem-*` check measures against flat
  `--sem-bg`, and the field gradient is not flat. Text used to sit on it:
  muted and accent fell to 2.36–3.22:1 in five palette modes (rendered pixels,
  2026-10-16). `src/global.css` now masks the wash out under the column of
  text and the post's side rail (WHERE THE WASH STOPS), and verify checks every
  column a page uses has a mask. Text placed outside the column, such as a new
  rail, is back on the wash. Every palette passed at 390 and 1280 on
  2026-10-16. Re-measure, slowly:
  `pnpm run build && node scripts/measure-a11y.mjs --contrast`, or narrow it
  with `--only amber-dark --widths 390`.
- **Screen-reader announcement.** VoiceOver: `Cmd+F5`, then `Ctrl+Opt+U` for
  the rotor. Landmarks and headings should describe the page; link text should
  make sense out of context ("Source" in the footer is borderline).
- **400% zoom and 320px reflow** (WCAG 1.4.10). No sideways page scroll at any
  width from 320px up, and no clipped content. Wide content scrolls inside its
  own box, which needs `relative` (an `sr-only` child escapes one that isn't)
  and `scroll-cue` (phones show no scrollbar); verify checks it gets a tab
  stop. Checked 2026-10-14 at 25 widths, 320–3440px. Re-check in device mode
  at 320, 390, 768, 1440 and 1920: `document.documentElement.scrollWidth` must
  equal `clientWidth` on every page.
- **Motion.** Set macOS Reduce Motion and reload. `StreamText` and the mesh
  must go static, not merely faster.
- **Target size** (WCAG 2.5.8, 24x24 CSS px minimum). The `pill` utility is
  currently ~34px tall — fine — but a smaller variant would breach it.

## Qwik 2 + Tailwind v4 specifics that cost time here

- **HTML elements take camelCase `tabIndex`**, not `tabindex`. The lowercase
  `tabindex?: number` in `core-internal.d.ts` belongs to the **SVG** attribute
  interface, so copying it onto a `<main>` fails to typecheck. Qwik emits
  `tabIndex="-1"`, which is fine — HTML lowercases attribute names.
- **Skip links use `focus:`, not `focus-visible:`.** The link is only ever
  reached by Tab, so the keyboard heuristic buys nothing, while programmatic
  `.focus()` does not reliably match `:focus-visible` — which would leave it
  focused and still invisible.
- **In-page `#` links do not move focus by themselves.** Qwik Router cancels
  every same-page hash link and only scrolls the target into view, so
  `tabindex="-1"` on the target is not enough: focus stayed on the skip link
  and the next Tab went back to the nav (rc.3, found 2026-10-14).
  `src/routes/layout.tsx` moves focus from an inline (`sync$`) click handler,
  and `pnpm run verify` checks it ships. The router's handler:
  `grep -n 'scrollIntoView' node_modules/@qwik.dev/router/lib/index.qwik.mjs`
- **`not-sr-only` and positioning utilities collide.** `not-sr-only` sets
  `position: static`; `focus:absolute` sets `absolute`. Equal specificity, so
  source order decides, and it currently works only because Tailwind emits
  position utilities later. If a focused skip link ever pushes the page down
  instead of overlaying it, this is why.
- **Qwik switches CSS delivery based on size, so check which mode you are in
  before trying to patch it.** Below a limit it inlines the whole stylesheet
  into a `<style>` tag and emits no `<link rel="stylesheet">`, so
  `dist/assets/*-style.css` is present but never fetched (referenced only as
  `data-src`) and editing it does nothing. Above the limit it links the file
  and the inline style disappears. The limit is the optimizer's
  `inlineStylesUpToBytes`, 20,000 by default at rc.3
  (`grep -n 'inlineStylesUpToBytes: ' node_modules/@qwik.dev/core/dist/optimizer.mjs`).
  This repo's stylesheet passed the default on 2026-08-23 and was linked until
  2026-10-14, when `vite.config.ts` raised the limit to 60,000: it is
  **inlined** now, and `pnpm run verify` fails if it outgrows that. Always
  check: `grep -c 'rel="stylesheet"' dist/index.html` gives 1 for linked, 0
  for inlined.
- **Reduced motion** is handled globally in `global.css` AND per-element with
  `motion-reduce:` in components. The global rule only shortens durations, so
  anything that must not animate at all needs the variant too.

## Verifying a palette or mode deterministically

Chrome's `--force-light-mode` does **not** override `prefers-color-scheme`, and
a headless screenshot inherits the OS theme -- which once silently tested dark
twice. Pick the palette and mode explicitly instead:

- **In a browser:** `siteTheme.set("acme")`, `siteTheme.set(undefined, "dark")`
  and `siteTheme.set("wada", "auto")` in the console. The choice is saved, so
  reloads and other tabs follow.
- **Headless (puppeteer):** emulate the media feature, or seed the stored
  choice before the page's own script runs:

      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
      await page.evaluateOnNewDocument(() => localStorage.setItem("theme:name", "kanagawa"));

The keys and the selectors they drive are in `src/content/palettes.ts`.

## Precedence when guidance conflicts

1. **Accessibility constraints win.** A contrast or focus requirement is not a
   style opinion to trade away.
2. **This repo's existing token system wins** over generic design advice. The
   `frontend-design` skill is written for greenfield identity work — "take an
   aesthetic risk", "reject templated proposals". `src/global.css` is a settled
   system, and there is still an undecided visual direction on file, so treat
   that skill as input for NEW surfaces, not licence to restyle what exists.
3. Colours come from `--sem-*` via Tailwind utilities, never a raw hex. One
   attribute on `<html>` retints the whole site, and a hardcoded colour opts
   out of it (`src/global.css` header).

## If deeper coverage is wanted

`axe-core` catches ARIA and name-computation rules `verify` does not, and it
needs a real DOM. `node scripts/measure-a11y.mjs` runs it on every page,
palette and mode at 320 and 1280, using the axe-core and puppeteer-core that
lighthouse already installs, so it needs no dependency change. It is a script,
not part of `verify`: a green `verify` says nothing about ARIA. Clean on
2026-10-16 (axe-core 4.13.0). Promoting axe to a direct dependency, or adding
Playwright, would still need approval under the repo's dependency policy.
