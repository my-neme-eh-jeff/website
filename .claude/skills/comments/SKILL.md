---
name: comments
description: Use whenever writing, editing, reviewing or deleting a code comment in this repo, including a doc comment on a new function, a note during a refactor, or a comment cleanup pass. Covers what earns a comment here, what to cut, and the places a comment is not inert (Tailwind scans it, verify regex-parses it, lint needs it, it ships inside a template string).
---

# Comments in this repo

Code is the source of truth. A comment is a second copy of a fact that nothing
keeps in sync, so the default is none.

Before writing one, ask whether a reader with the code open would get something
wrong without it. If not, don't write it. If so, ask whether a name, a type, a
shared constant or a check in `scripts/verify-build.mjs` would carry the fact
instead. Prefer those: they fail when they go wrong, and prose doesn't.

## What survives

- **A constraint we can't change**: a browser quirk, Qwik or router behaviour,
  Cloudflare, a vendor API, a WCAG rule. One line, two if the second line is a
  new fact. Name the version and date, or a command that re-checks it:
  `// @qwik.dev/router rc.3 (2026-10-16): <what breaks, and how this avoids it>`
- **A contract the type can't state**, on an exported function or field: units,
  ranges, what an empty value means, side effects.
- **Tool directives**: `eslint-disable`, `@ts-expect-error`, `prettier-ignore`,
  `/// <reference>`, JSDoc `@type`, and the comment inside an empty `catch`
  (`no-empty` in `js.configs.recommended` rejects an empty block).
- **Config rationale that CLAUDE.md routes readers to**: `wrangler.jsonc`,
  `public/_headers`, `public/robots.txt`, the field notes in `profile.ts`.
  Still short: one reason per setting.
- **Credits and licences.**

## What goes

| Shape                                                | Instead                                      |
| ---------------------------------------------------- | -------------------------------------------- |
| Restates the code, the name or the signature         | nothing                                      |
| History: "used to", "replaced", "no longer", "was"   | the commit message                           |
| A claim about another file, a layout, "must match X" | a shared constant or a `verify` check        |
| A measurement that justified a past decision         | the commit message                           |
| Banners, ALL CAPS headings, dashed rules, narration  | nothing, or one sentence-case line           |
| Explaining a surprise in our own code                | a rename or an extract that makes it obvious |
| "Per the repo's guidance…"                           | nothing; CLAUDE.md is already loaded         |

The long blocks were the ones that rotted. In the 2026-10-16 audit, the
longest notes in `global.css` were contrast measurements taken on a palette
that had stopped being the default, and the measuring script could no longer
reproduce them.

## Where a comment is not inert

- **Tailwind turns class names in comments into CSS.** `@import "tailwindcss"
source(".")` in `src/global.css` limits the scan to `src/`, but a utility
  named in a comment there (`text-[#abc]`) still ships. To check, build and
  search `dist/assets/*-style.css` for the class.
- **`verify` reads some source files as text.** List them with
  `grep -nE 'read\("(src|scripts|public|wrangler)' scripts/verify-build.mjs`.
  - `wrangler.jsonc`: only full-line `//` comments are stripped, so never add a
    trailing comment or a `/* */` block.
  - `profile.ts`: a comment holding `href: "…"`, `slug: ` or `minutes: N`
    inside the parsed spans gets read as data.
  - `global.css`: a comment inside `@utility field {`, `@utility grain-page {`
    or `@keyframes field-shift {` must not contain `}`, `--name: value;` or
    `0% {`.
  - `make-og.mjs`: `pick()` takes the first `name:`, `tagline:`, `jobTitle:` or
    `city:` in `profile.ts`, with no word boundary.
- **Template strings ship.** Text inside the inline theme and analytics
  scripts, and inside the SVG template in `scripts/make-icons.mjs`, is page
  bytes, not a comment.

## A cleanup pass

Change only comments in the commit, never code, strings or formatting. Prove it:

1. Build on the base commit and keep a copy of `dist/`.
2. Strip comments and whitespace from each changed file, before and after, and
   compare. For TS/JS, print with TypeScript's printer and
   `{ removeComments: true }`.
3. Build again and diff `dist/` tag by tag, ignoring hashed names and Qwik
   instance ids. The only expected change is CSS from class names that lived
   in comments.
4. Run `fmt.check`, `lint`, `build.types`, `build` and `verify`.

Sources: the comment taxonomy and the one-line rule draw on
`miqdadbadjuber/anti-slop` `antislop-code` (MIT). "Encode the constraint, then
delete the comment" is from Cursor's `comment-sicko` agent. The contract comment
is Ousterhout's interface comment (_A Philosophy of Software Design_, ch. 13).
