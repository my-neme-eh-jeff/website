---
name: a11y-ui
description: Use for ANY UI work in this repo - new components, restyling, colour or token changes, layout, animation. Covers the accessibility bar this project holds itself to, what `npm run verify` already enforces, what it cannot check, and the Qwik 2 + Tailwind v4 gotchas that have actually bitten here.
---

# Accessibility for UI work in this repo

Accessibility is treated as a build constraint here, not a review step. A good
share of it is machine-checkable and therefore checked; the rest needs a human
and is listed honestly below.

**Do this first, before reading further:**

```bash
npm run build && npm run verify
```

## What is already enforced

`scripts/verify-build.mjs` fails the build on these. Add to it rather than
writing a new doc.

| Check                                                                     | Bar                  |
| ------------------------------------------------------------------------- | -------------------- |
| `--sem-text` / `--sem-muted` on `--sem-bg`, both themes                   | ≥ 4.5:1 (WCAG 1.4.3) |
| `--sem-accent` on `--sem-bg`, both themes                                 | ≥ 3:1 (WCAG 1.4.11)  |
| Skip link present, first focusable, target exists and has `tabindex="-1"` | per page             |
| `lang` attribute, exactly one `<h1>`, no skipped heading levels           | per page             |
| Every `<img>` has `alt`; every `<svg>` is named or `aria-hidden`          | per page             |

The accent bar is not cosmetic bookkeeping: **`:focus-visible` is drawn in
`--sem-accent`**, so the accent's contrast IS the focus indicator's contrast.
Change the accent and you have changed a conformance property.

## The colour trap this repo already fell into

`--clay` (`#d97757`) is **2.99:1 on `--paper`**. It shipped with a comment
claiming it "clears 4.5:1 on both grounds", which was simply wrong. The light
theme's focus ring was non-conformant by 0.01 — invisible to inspection,
obvious to arithmetic.

Hence two clays: `--clay` for dark grounds (6.05:1 on `#12110d`) and
`--clay-deep` (`#bd5334`, 4.52:1 on `--paper`) for light. **Never assume a
brand colour works on both themes.** Compute it:

```bash
npm run verify   # recomputes from src/global.css on every build
```

## What automation here does NOT check

Do not read a green `verify` as "accessible". These need a person:

- **Keyboard path.** Tab through the whole page. Every interactive element must
  be reachable, in visual order, with a visible ring, and nothing may trap
  focus. Automation cannot see tab order.
- **Focus ring against real backgrounds.** The check tests accent-on-`--sem-bg`.
  A control sitting on `--sem-surface` or on the mesh figure is a different
  pairing.
- **Screen-reader announcement.** VoiceOver: `Cmd+F5`, then `Ctrl+Opt+U` for
  the rotor. Landmarks and headings should describe the page; link text should
  make sense out of context ("Source" in the footer is borderline).
- **400% zoom and 320px reflow** (WCAG 1.4.10). No horizontal page scroll, no
  clipped content. The two-column hero must collapse.
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
- **`not-sr-only` and positioning utilities collide.** `not-sr-only` sets
  `position: static`; `focus:absolute` sets `absolute`. Equal specificity, so
  source order decides, and it currently works only because Tailwind emits
  position utilities later. If a focused skip link ever pushes the page down
  instead of overlaying it, this is why.
- **Qwik switches CSS delivery based on size, so check which mode you are in
  before trying to patch it.** Below roughly 15 kB it inlines the whole
  stylesheet into a `<style>` tag and emits no `<link rel="stylesheet">`, so
  `dist/assets/*-style.css` is present but never fetched (referenced only as
  `data-src`) and editing it does nothing. Above that it links the file and the
  inline style disappears. This repo crossed the threshold on 2026-08-23 when
  the webfonts and atmosphere layer landed (15.4 kB to 21.5 kB). Always check:
  `grep -c 'rel="stylesheet"' dist/index.html` gives 1 for linked, 0 for inlined.
- **Reduced motion** is handled globally in `global.css` AND per-element with
  `motion-reduce:` in components. The global rule only shortens durations, so
  anything that must not animate at all needs the variant too.

## Verifying a theme branch deterministically

Chrome's `--force-light-mode` does **not** override `prefers-color-scheme`, and
a headless screenshot inherits the OS theme -- which silently tested dark twice.
Disable the dark branch instead, in whichever file actually carries the CSS (see
the delivery note above).

**Serve each variant from its own document root.** Asset paths are absolute
(`/assets/...`), so serving `light/` and `dark/` as subdirectories of one root
makes both pages request `/assets/...` from that shared root. They load no CSS
at all and render identically -- which looks exactly like "the theme swap is
broken".

    rm -rf /tmp/t && mkdir -p /tmp/t/light && cp -r dist/* /tmp/t/light/
    # Linked mode: patch the stylesheet. Inlined mode: patch index.html.
    python3 -c "import glob; f=glob.glob('/tmp/t/light/assets/*-style.css')[0]; \
      s=open(f).read(); open(f,'w').write(s.replace('@media(prefers-color-scheme:dark){','@media not all{'))"
    cd /tmp/t/light && python3 -m http.server 8082   # own root, not a subpath

## Precedence when guidance conflicts

1. **Accessibility constraints win.** A contrast or focus requirement is not a
   style opinion to trade away.
2. **This repo's existing token system wins** over generic design advice. The
   `frontend-design` skill is written for greenfield identity work — "take an
   aesthetic risk", "reject templated proposals". `src/global.css` is a settled
   system, and there is still an undecided visual direction on file, so treat
   that skill as input for NEW surfaces, not licence to restyle what exists.
3. Colours come from `--sem-*` via Tailwind utilities, never a raw hex.

## If deeper coverage is wanted

`axe-core` is the industry standard and would catch ARIA and name-computation
rules this script does not. It needs a real DOM, so it means a new dev
dependency (axe-core plus a browser driver) and therefore explicit approval
under the repo's dependency policy. `anthropics/skills` also ships
`webapp-testing` (Playwright) — not installed, same reason. Ask before adding
either.
