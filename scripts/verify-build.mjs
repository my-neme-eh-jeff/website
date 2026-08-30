/**
 * Post-build invariant checks. Run: `node scripts/verify-build.mjs`
 *
 * These are the repo's invariants from CLAUDE.md, executed instead of merely
 * written down. Each one has already been broken at least once, or would fail
 * silently in production rather than at build time -- which is the whole reason
 * to assert it here rather than trust a comment.
 *
 * A script rather than inline CI YAML so it runs identically on a laptop and in
 * Actions, and so the reasoning lives next to the assertion.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => join(ROOT, ...s);
const read = (...s) => readFileSync(p(...s), "utf8");

const failures = [];
const warnings = [];
const passes = [];

/** @param {string} name @param {() => string | void} fn */
function check(name, fn) {
  try {
    const note = fn();
    passes.push(note ? `${name} — ${note}` : name);
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

/**
 * Same as `check`, but does not fail the build.
 *
 * For states that are genuinely pending rather than broken. A CI job that is
 * red from day one gets ignored, and an ignored CI job protects nothing.
 */
function warn(name, fn) {
  try {
    fn();
    passes.push(name);
  } catch (err) {
    warnings.push(`${name}\n    ${err.message}`);
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --- Hosting contract ------------------------------------------------------

check("dist/404.html exists at the exact path Cloudflare serves", () => {
  assert(
    existsSync(p("dist", "404.html")),
    'Missing dist/404.html. `not_found_handling: "404-page"` in wrangler.jsonc ' +
      "serves precisely this path, so a missing file means every unknown URL " +
      "returns a bare Workers error page. It is emitted by src/routes/404.tsx " +
      "being a FILE route -- converting it to src/routes/404/index.tsx breaks this.",
  );
});

check("sitemap.xml excludes the 404 page", () => {
  // Scoped to <loc> paths, not the whole document: a bare /404/ match would
  // also fire on a legitimate future URL such as /blog/debugging-a-404/.
  const locs = [
    ...read("dist", "sitemap.xml").matchAll(/<loc>([^<]*)<\/loc>/g),
  ].map((m) => m[1]);
  assert(
    !locs.some((u) => /\/404(\/|\.html)?$/.test(u)),
    "sitemap.xml references a 404 URL. Qwik's SSG guard tests " +
      'pathname.endsWith("/404.html"), so a directory route emitting /404/ ' +
      "slips past it and submits a soft-404 to Search Console.",
  );
  return `${locs.length} URLs`;
});

check("wrangler.jsonc stays assets-only (no `main`)", () => {
  // Comments make this not-quite-JSON, so match on the key rather than parse.
  const w = read("wrangler.jsonc");
  const uncommented = w
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert(
    !/^\s*"main"\s*:/m.test(uncommented),
    "wrangler.jsonc declares `main`. Static asset requests are free and " +
      "unlimited; adding a Worker script bills every page view against the " +
      "100k/day free tier. Server code belongs behind " +
      'run_worker_first: ["/api/*"], never a bare `main`.',
  );
});

check("_headers ships in dist", () => {
  assert(
    existsSync(p("dist", "_headers")),
    "dist/_headers is missing, so hashed bundles lose their immutable " +
      "Cache-Control and every asset costs a revalidation round trip.",
  );
});

// --- Dependency hygiene ---------------------------------------------------

check("no caret ranges on dependencies", () => {
  const pkg = JSON.parse(read("package.json"));
  const ranges = { ...pkg.dependencies, ...pkg.devDependencies };
  const loose = Object.entries(ranges).filter(([, v]) => /[\^~]/.test(v));
  assert(
    loose.length === 0,
    `Loose ranges: ${loose.map(([k, v]) => `${k}@${v}`).join(", ")}. ` +
      "On a prerelease, ^2.0.0-beta.38 resolves >=2.0.0-beta.38 <3.0.0, so a " +
      "plain a plain install silently upgrades the beta. Pin exact.",
  );
  return `${Object.keys(ranges).length} deps, all exact`;
});

// --- SEO output -----------------------------------------------------------

check("exactly one JSON-LD block per page", () => {
  for (const page of ["index.html", "resume/index.html", "blog/index.html"]) {
    const html = read("dist", page);
    /*
     * Count opening TAGS, not occurrences of the string. Qwik serialises the
     * DocumentHead into its resumability state blob, so `application/ld+json`
     * appears twice per page while only one of them is a real script element.
     * A naive string count reports a duplicate that no crawler ever sees.
     */
    const tags = html.match(/<script[^>]*application\/ld\+json[^>]*>/g) ?? [];
    assert(
      tags.length === 1,
      `${page} has ${tags.length} JSON-LD script tags, expected 1. Google ` +
        "reads one @graph per page; sibling blocks compete rather than combine.",
    );
    const m = html.match(
      /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/,
    );
    assert(m, `${page} has no parseable JSON-LD block.`);
    const graph = JSON.parse(m[1]); // throws on malformed output
    assert(
      Array.isArray(graph["@graph"]) && graph["@graph"].length > 0,
      `${page} JSON-LD has no @graph entities.`,
    );
  }
  return "3 pages, all valid @graph";
});

check("exactly one canonical link per page", () => {
  for (const page of ["index.html", "resume/index.html", "blog/index.html"]) {
    const n = (
      read("dist", page).match(/<link[^>]*rel="canonical"[^>]*>/g) ?? []
    ).length;
    assert(
      n === 1,
      `${page} has ${n} canonical tags, expected 1. Qwik's \`links\` are ` +
        "additive, so a route-level canonical stacks on root.tsx's instead of " +
        "replacing it, and two conflicting canonicals get both ignored.",
    );
  }
  return "3 pages";
});

warn("no placeholder text in the homepage's indexable meta tags", () => {
  const html = read("dist", "index.html");
  const metas = [
    ...html.matchAll(
      /<meta[^>]*(?:name|property)="(description|og:description|og:title|twitter:description)"[^>]*content="([^"]*)"/g,
    ),
  ];
  const bad = metas.filter(([, , content]) => /TODO/i.test(content));
  assert(
    bad.length === 0,
    `Placeholder text is live in: ${bad.map(([, k]) => k).join(", ")}. ` +
      "These are what a search result and a shared link actually display, so " +
      'today they read "TODO: one line on what you do" under your name. ' +
      "Fill in `tagline` and `bio` in src/content/profile.ts. This is a " +
      "warning rather than a failure only because the content is known to be " +
      "pending -- it is still the single highest-impact fix on the site.",
  );
});

check("theme-color meta matches --sem-bg in both themes", () => {
  /*
   * These live in two places that cannot reference each other: a meta tag
   * cannot read a CSS variable. A mismatch renders as a visible band of the
   * wrong colour between the browser chrome and the page, so it is asserted
   * rather than trusted to a comment.
   */
  const css = read("src", "global.css");
  const light = css.match(/--sem-bg:\s*var\(--paper\)/)
    ? css.match(/--paper:\s*(#[0-9a-f]{3,8})/i)?.[1]
    : css.match(/--sem-bg:\s*(#[0-9a-f]{3,8})/i)?.[1];
  const darkBlock = css.slice(css.indexOf("prefers-color-scheme: dark"));
  const dark = darkBlock.match(/--sem-bg:\s*(#[0-9a-f]{3,8})/i)?.[1];
  assert(
    light && dark,
    "Could not read --sem-bg for both themes from global.css.",
  );

  const html = read("dist", "index.html");
  const tags = [
    ...html.matchAll(
      /<meta[^>]*name="theme-color"[^>]*media="\(prefers-color-scheme:\s*(light|dark)\)"[^>]*content="([^"]*)"/g,
    ),
  ];
  const got = Object.fromEntries(tags.map(([, k, v]) => [k, v.toLowerCase()]));
  assert(
    tags.length === 2,
    `Expected 2 theme-color tags (light + dark), found ${tags.length}.`,
  );
  assert(
    got.light === light.toLowerCase(),
    `theme-color light is ${got.light}, but --sem-bg light is ${light}.`,
  );
  assert(
    got.dark === dark.toLowerCase(),
    `theme-color dark is ${got.dark}, but --sem-bg dark is ${dark}.`,
  );
  return `${light} / ${dark}`;
});

check("every hero link is also asserted in sameAs", () => {
  /*
   * A visible profile link missing from sameAs wastes the strongest
   * entity-disambiguation signal available, and the drift is silent because
   * both lists render fine independently.
   *
   * Reads the Person node's sameAs array specifically -- NOT the whole HTML.
   * Searching the page for the URL always succeeds, because the hero renders
   * the same href as a visible <a>, so a whole-document check passes even when
   * sameAs is empty. That mistake made this check vacuous once already.
   */
  const src = read("src", "content", "profile.ts");
  const start = src.indexOf("links: [");
  const end = src.indexOf("sameAs:", start);
  assert(start !== -1 && end > start, "Could not locate the links block.");
  const hrefs = [...src.slice(start, end).matchAll(/href:\s*"([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert(hrefs.length > 0, "Parsed zero hero links -- would pass vacuously.");

  const m = read("dist", "index.html").match(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/,
  );
  assert(m, "No JSON-LD block on the homepage.");
  const person = JSON.parse(m[1])["@graph"].find(
    (n) => n["@type"] === "Person",
  );
  assert(person, "No Person node in the homepage @graph.");
  const sameAs = person.sameAs ?? [];
  const missing = hrefs.filter((h) => !sameAs.includes(h));
  assert(
    missing.length === 0,
    `Hero links absent from Person.sameAs: ${missing.join(", ")}. ` +
      `sameAs currently holds ${sameAs.length} URL(s).`,
  );
  return `${hrefs.length} links, all in sameAs`;
});

check("every referenced font file exists and is a real woff2", () => {
  /*
   * A typo in a @font-face url() or a preload href does not error -- the
   * browser silently renders the fallback stack. The site looks fine, just
   * wrong, which is the hardest kind of regression to notice.
   */
  const css = read("src", "global.css");
  const refs = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
  assert(refs.length > 0, "No /fonts/ references in global.css.");

  for (const ref of new Set(refs)) {
    const onDisk = p("dist", ref.replace(/^\//, ""));
    assert(
      existsSync(onDisk),
      `global.css references ${ref}, which is not in dist. Run \`pnpm run fonts\`.`,
    );
    // woff2 files start with the ASCII signature 'wOF2'.
    const sig = readFileSync(onDisk).subarray(0, 4).toString("latin1");
    assert(
      sig === "wOF2",
      `${ref} is not woff2 (signature ${JSON.stringify(sig)}).`,
    );
  }

  // A preload no @font-face claims is fetched and then ignored. (On-disk
  // existence is a separate check, above.)
  const html = read("dist", "index.html");
  for (const m of html.matchAll(
    /<link[^>]*rel="preload"[^>]*href="([^"]+)"[^>]*>/g,
  )) {
    const [tag, href] = m;
    if (!href.startsWith("/fonts/")) continue;
    assert(
      refs.includes(href),
      `Preloading ${href}, which no @font-face uses -- so it is downloaded and ignored.`,
    );
    /*
     * Fonts are always fetched in CORS mode. A preload without crossorigin is
     * a DIFFERENT cache entry than the @font-face request, so the file gets
     * downloaded twice -- a silent doubling, not an error.
     */
    assert(
      /crossorigin/i.test(tag),
      `Font preload for ${href} lacks crossorigin, so the file downloads twice.`,
    );
  }
  return `${new Set(refs).size} files`;
});

check("every class in the output has a CSS rule", () => {
  /*
   * Tailwind does not error on a class it does not recognise -- it emits
   * nothing, and the element renders unstyled. `class="mono"` shipped that way
   * in 8 places: a leftover from before the Tailwind migration, where the real
   * utility is `font-mono`. The page looked almost right, which is why nobody
   * would catch it by eye.
   *
   * So: collect every class token the built HTML actually uses, and assert each
   * one appears as a selector in the built CSS. Semantic classes (wrap, pill,
   * eyebrow) have rules too, so there are no legitimate orphans.
   */
  const cssFile = readdirSync(p("dist", "assets")).find((f) =>
    f.endsWith(".css"),
  );
  assert(cssFile, "No stylesheet in dist/assets.");
  const css = read("dist", "assets", cssFile);

  /*
   * Tailwind escapes `:` `.` `/` `[` in generated class names, so the token
   * regex must accept an escaped anything (`\\.`) but NOT a bare `,` `.` or
   * `:`. An earlier version allowed those, and on a grouped selector like
   *   .border-line,.border-line\\/60{...}
   * it matched the whole run as ONE token — recording neither real class name
   * and reporting `border-line` as an orphan when its rule was right there.
   * A false positive in a guard is worse than no guard, so: bare `,` ends a
   * token, bare `:` starts a pseudo-class, bare `.` starts the next selector.
   */
  const base = (c) => c.replace(/\\/g, "").split(":")[0];
  const selectors = new Set(
    [...css.matchAll(/\.((?:\\.|[-\w[\]()/%#])+)/g)].map((m) => base(m[1])),
  );

  const used = new Set();
  for (const page of [
    "index.html",
    "resume/index.html",
    "blog/index.html",
    "404.html",
  ]) {
    for (const m of read("dist", page).matchAll(/class="([^"]*)"/g)) {
      m[1]
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => used.add(c));
    }
  }

  /*
   * Tailwind's variant MARKERS are real classes with no rule of their own, by
   * design: `group` exists only so `group-hover:*` has something to select
   * against, and the rule generated is `.group:hover .group-hover\\:x`, which
   * never contains a bare `.group` selector. Same for `peer`. They are the one
   * legitimate orphan, so they are named here rather than the check being
   * loosened -- a typo like `gorup` must still fail.
   */
  const MARKERS = new Set(["group", "peer"]);

  const orphans = [...used].filter(
    (c) => !MARKERS.has(c) && !selectors.has(base(c)),
  );
  assert(
    orphans.length === 0,
    `Classes used in HTML with no CSS rule: ${orphans.join(", ")}. ` +
      `Either a typo, or a utility that does not exist -- both render silently ` +
      `as no styling at all.`,
  );
  return `${used.size} tokens, all resolved`;
});

check("og:image is referenced only if it exists and is a real image", () => {
  /*
   * A referenced-but-missing og:image is worse than none: the platform reserves
   * the card's space and renders it blank. So if the tag is emitted, the file
   * must be in dist AND actually be an image.
   */
  const html = read("dist", "index.html");
  const tag = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
  if (!tag) return "not emitted (allowed)";

  const url = tag[1];
  const rel = url.replace(/^https?:\/\/[^/]+/, "").replace(/^\//, "");
  const onDisk = p("dist", rel);
  assert(existsSync(onDisk), `og:image points at ${url}, absent from dist.`);

  const buf = readFileSync(onDisk);
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf.subarray(1, 4).toString("latin1") === "PNG";
  assert(jpeg || png, `${rel} is neither JPEG nor PNG.`);

  /*
   * Scrapers fetch this before rendering a preview, and several give up on
   * large files. A gradient card as lossless PNG lands near 900 kB, which is
   * why this exists as a ceiling rather than a comment.
   */
  const kb = Math.round(buf.length / 1024);
  assert(
    buf.length < 400_000,
    `${rel} is ${kb} kB. Social scrapers fetch this before rendering; keep it ` +
      `under ~400 kB (JPEG, not PNG, for a gradient).`,
  );

  // Every platform crops from 1200x630; anything else gets cropped oddly.
  if (png) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert(w === 1200 && h === 630, `${rel} is ${w}x${h}, expected 1200x630.`);
  }

  const twitter = html.match(
    /<meta[^>]*name="twitter:card"[^>]*content="([^"]+)"/,
  );
  assert(
    twitter?.[1] === "summary_large_image",
    `twitter:card is "${twitter?.[1]}" but an og:image exists — it should be ` +
      `summary_large_image, or X renders the small card and wastes the image.`,
  );

  return `${rel}, ${kb} kB`;
});

// --- Accessibility -------------------------------------------------------
//
// Structural and colour checks only. These catch regressions, they do not
// certify the site: keyboard order, screen-reader announcement and 400% zoom
// still need a human. See .claude/skills/a11y-ui/ for what is NOT covered.

/** sRGB relative luminance, per WCAG 2.x. */
function luminance(hexColour) {
  let h = hexColour.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

check("colour contrast meets WCAG AA in both themes", () => {
  const css = read("src", "global.css");
  const val = (name, scope = css) =>
    scope.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, "i"))?.[1];
  const raw = {
    paper: val("paper"),
    ink: val("ink"),
    cream: val("cream"),
    clay: val("clay"),
    "clay-deep": val("clay-deep"),
    ember: val("ember"),
    "ember-deep": val("ember-deep"),
  };
  const darkBlock = css.slice(css.indexOf("prefers-color-scheme: dark"));

  // Resolve one indirection: `--sem-x: var(--raw)` or a literal.
  const sem = (name, scope) => {
    const m = scope.match(new RegExp(`--sem-${name}:\\s*([^;]+);`));
    assert(m, `--sem-${name} not found`);
    const v = m[1].trim();
    const ref = v.match(/^var\(--([a-z-]+)\)$/);
    return ref ? raw[ref[1]] : v;
  };

  const themes = {
    light: {
      bg: sem("bg", css),
      surface: sem("surface", css),
      text: sem("text", css),
      muted: sem("muted", css),
      accent: sem("accent", css),
      danger: sem("danger", css),
    },
    dark: {
      bg: sem("bg", darkBlock),
      surface: sem("surface", darkBlock),
      text: sem("text", darkBlock),
      muted: sem("muted", darkBlock),
      accent: sem("accent", darkBlock),
      danger: sem("danger", darkBlock),
    },
  };

  const results = [];
  for (const [name, t] of Object.entries(themes)) {
    // 4.5:1 -- WCAG 1.4.3, normal-size body text.
    for (const key of ["text", "muted"]) {
      const r = contrast(t[key], t.bg);
      assert(
        r >= 4.5,
        `${name}: --sem-${key} on --sem-bg is ${r.toFixed(2)}:1, needs 4.5:1 ` +
          `(WCAG 1.4.3, body text).`,
      );
    }
    /*
     * 3:1 -- WCAG 1.4.11. The :focus-visible ring is drawn in --sem-accent,
     * and focus is a component STATE, so its indicator is non-text contrast
     * rather than decoration. This is the check that caught #d97757 at
     * 2.99:1 on the light ground.
     */
    const focus = contrast(t.accent, t.bg);
    assert(
      focus >= 3,
      `${name}: --sem-accent on --sem-bg is ${focus.toFixed(2)}:1, needs 3:1. ` +
        `The focus ring uses this colour, so keyboard focus would be ` +
        `non-conformant (WCAG 1.4.11).`,
    );
    /*
     * 4.5:1 -- WCAG 1.4.3 again, but measured against BOTH grounds, because
     * --sem-danger is only ever used for text and that text is only ever on
     * the glass panel, not on the page. The panel is --sem-surface under a
     * backdrop-filter, so --sem-bg alone would have cleared a colour that is
     * still unreadable where it actually renders.
     *
     * This is the check that would have caught #e0715c, which sat inline in
     * terminal.tsx as `text-[#e0715c]` at 3.01:1 on --paper and 3.14:1 on the
     * light surface. A hex in a component is invisible to this file, which is
     * the whole argument for the no-raw-colours invariant.
     */
    for (const ground of ["bg", "surface"]) {
      const r = contrast(t.danger, t[ground]);
      assert(
        r >= 4.5,
        `${name}: --sem-danger on --sem-${ground} is ${r.toFixed(2)}:1, ` +
          `needs 4.5:1 (WCAG 1.4.3). The shell renders error lines in this ` +
          `colour on the glass panel.`,
      );
    }

    /*
     * --sem-accent has to clear the TEXT bar too, not just the 3:1 focus bar
     * checked above, because it is no longer only a ring. The shell renders
     * hint lines, the prompt, and now every linkified URL and email address in
     * it -- on the panel, so --sem-surface is the ground that matters as much
     * as --sem-bg. It passes today (light 4.72, dark 5.58); the point of
     * asserting it is that the accent is the colour most likely to be changed
     * for aesthetic reasons, and it now carries a text requirement it did not
     * carry when it was chosen.
     */
    for (const ground of ["bg", "surface"]) {
      const r = contrast(t.accent, t[ground]);
      assert(
        r >= 4.5,
        `${name}: --sem-accent on --sem-${ground} is ${r.toFixed(2)}:1, ` +
          `needs 4.5:1 (WCAG 1.4.3). The shell renders links and hint text ` +
          `in this colour, so it is body text and not just the focus ring.`,
      );
    }
    results.push(
      `${name} focus ${focus.toFixed(2)}:1, danger ` +
        `${contrast(t.danger, t.surface).toFixed(2)}:1`,
    );
  }
  return results.join(", ");
});

check("skip link is present, first, and points at a real target", () => {
  for (const page of ["index.html", "resume/index.html", "blog/index.html"]) {
    const html = read("dist", page);
    const body = html.slice(html.indexOf("<body"));
    const firstAnchor = body.match(/<a\b[^>]*href="([^"]*)"[^>]*>/);
    assert(
      firstAnchor && firstAnchor[1].startsWith("#"),
      `${page}: the first focusable link is not a skip link. Without one, ` +
        `keyboard and screen-reader users traverse the whole nav on every page.`,
    );
    const target = firstAnchor[1].slice(1);
    assert(
      new RegExp(`id="${target}"`).test(html),
      `${page}: skip link points at #${target}, which no element has.`,
    );
    /*
     * The target must be focusable or the fragment jump moves the viewport
     * without moving focus, and the next Tab goes back to the nav.
     */
    const el = html.match(new RegExp(`<[a-z]+[^>]*id="${target}"[^>]*>`, "i"));
    assert(
      el && /tabindex="-1"/i.test(el[0]),
      `${page}: #${target} lacks tabindex="-1", so focus does not follow the jump.`,
    );
  }
  return "3 pages";
});

check("document structure: lang, one h1, no skipped heading levels", () => {
  for (const page of ["index.html", "resume/index.html", "blog/index.html"]) {
    const html = read("dist", page);
    assert(
      /<html[^>]*\slang="[a-z]{2}/i.test(html),
      `${page} has no lang attribute, so screen readers guess pronunciation.`,
    );
    const h1s = html.match(/<h1\b/g) ?? [];
    assert(
      h1s.length === 1,
      `${page} has ${h1s.length} <h1>, expected exactly 1.`,
    );

    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    let prev = 0;
    for (const lvl of levels) {
      assert(
        prev === 0 || lvl <= prev + 1,
        `${page} jumps from h${prev} to h${lvl}. Skipped levels break ` +
          `heading-navigation, which is how screen-reader users scan a page.`,
      );
      prev = lvl;
    }
  }
  return "3 pages";
});

check("every graphic has an accessible name or is hidden", () => {
  for (const page of ["index.html", "resume/index.html", "blog/index.html"]) {
    const html = read("dist", page);
    for (const tag of html.match(/<img\b[^>]*>/g) ?? []) {
      assert(
        /\salt=/.test(tag),
        `${page}: <img> without alt: ${tag.slice(0, 70)}`,
      );
    }
    /*
     * An <svg> is either meaningful (carries an accessible name) or decorative
     * (aria-hidden). Neither means a screen reader announces raw path data.
     */
    for (const tag of html.match(/<svg\b[^>]*>/g) ?? []) {
      const named = /aria-label=|aria-labelledby=/.test(tag);
      const hidden = /aria-hidden="true"/.test(tag);
      assert(
        named || hidden,
        `${page}: <svg> is neither named nor aria-hidden: ${tag.slice(0, 70)}`,
      );
    }
  }
  return "3 pages";
});

warn("published Lighthouse scores still describe the current build", () => {
  /*
   * This is the failure the scores actually had: audit.json said 93 for
   * performance while production measured 98-100, because it was stamped four
   * commits back — taken before the typing animation came out and before the
   * preloader was tuned. Nothing noticed, because a stale number looks exactly
   * like a fresh one.
   *
   * A WARNING rather than a failure, and the reason is structural: the scores
   * are measured against PRODUCTION, so the sequence is push -> deploy ->
   * measure -> commit. The commit immediately after any change is therefore
   * stale by construction, and failing here would make that unresolvable.
   *
   * audit.json is excluded from the comparison, since committing it is itself a
   * change under src/.
   */
  const audit = JSON.parse(read("src", "content", "audit.json"));
  const at = audit.commit;
  assert(at && at !== "unknown", "audit.json has no commit stamp.");

  let changed;
  try {
    changed = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        `${at}..HEAD`,
        "--",
        "src",
        "public",
        ":!src/content/audit.json",
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    // Shallow clone (CI checks out depth 1) or an unknown commit. Not a defect.
    return;
  }

  assert(
    changed.length === 0,
    `Measured at ${at} (${audit.measuredAt}), but ${changed.length} file(s) ` +
      `affecting the output changed since: ${changed.slice(0, 6).join(", ")}` +
      `${changed.length > 6 ? ", …" : ""}. The footer is publishing numbers for ` +
      `a build that no longer exists. Re-run \`pnpm run audit\` after the next ` +
      `deploy lands.`,
  );
});

// --- Cross-file parity -----------------------------------------------------

/*
 * The grain recipe lives in two files, and for a week they disagreed: the OG
 * card kept opacity 0.28 and a bare feTurbulence -- the recipe global.css had
 * already measured as invisible, 1.80 luma levels on the dark wash and 0.013
 * on light -- while a comment above it asserted the two matched.
 *
 * A parity claim written in prose is one nothing re-checks. Asserted here
 * instead, so the claim and the check are the same object.
 */
check("OG card's grain matches grain-page in global.css", () => {
  const decls = (src, open) => {
    const i = src.indexOf(open);
    assert(i !== -1, `could not find \`${open}\` -- was the rule renamed?`);
    const body = src.slice(i + open.length, src.indexOf("}", i));
    const get = (prop) => {
      const m = body.match(new RegExp(`${prop}:\\s*([^;]+);`));
      assert(m, `\`${open}\` declares no ${prop}`);
      return m[1].trim();
    };
    return {
      opacity: get("opacity"),
      "mix-blend-mode": get("mix-blend-mode"),
      "background-image": get("background-image"),
    };
  };

  const site = decls(read("src", "global.css"), "@utility grain-page {");
  const card = decls(read("scripts", "make-og.mjs"), ".grain {");
  for (const prop of Object.keys(site)) {
    assert(
      site[prop] === card[prop],
      `${prop} differs -- global.css: ${site[prop].slice(0, 48)}… / ` +
        `make-og.mjs: ${card[prop].slice(0, 48)}…\n    ` +
        `Sync make-og.mjs and re-run \`pnpm run og\`.`,
    );
  }
  return "opacity, blend mode and noise URI identical";
});

/*
 * A design token nothing uses never reaches the stylesheet, but the header
 * above it goes on describing what it is for. `--container-page` sat here with
 * zero uses and a documented purpose until an audit went looking.
 *
 * Only plain `@theme` is checked. `@theme inline` substitutes its values into
 * each utility rather than emitting the custom property, so its colour tokens
 * are correctly absent from the output by name -- which is the whole reason
 * `inline` is load-bearing here.
 */
check("every plain @theme token reaches the built CSS", () => {
  const css = read("src", "global.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const dist = readdirSync(p("dist", "assets"))
    .filter((f) => f.endsWith(".css"))
    .map((f) => read("dist", "assets", f))
    .join("\n");
  assert(dist.length > 0, "no built CSS in dist/assets -- run `pnpm run build`");

  const dead = [];
  let n = 0;
  for (const m of css.matchAll(/@theme(\s+inline)?\s*\{([^}]*)\}/g)) {
    if (m[1]) continue;
    for (const tok of m[2].match(/--[a-z0-9-]+(?=\s*:)/gi) ?? []) {
      n++;
      if (!dist.includes(tok)) dead.push(tok);
    }
  }
  assert(n > 0, "parsed no tokens -- the @theme block shape changed");
  assert(
    dead.length === 0,
    `declared but never emitted: ${dead.join(", ")}.\n    ` +
      `Tailwind only emits a token something uses, so these are dead. Delete ` +
      `them together with the lines documenting them.`,
  );
  return `${n} tokens, none dead`;
});

/*
 * `field`'s custom properties repeat the 0% keyframe of `field-shift`, and the
 * comment there says they must stay in sync. Nothing compared them.
 *
 * Drift here is close to invisible: the static values are what paints when the
 * animation never runs -- no scroll-timeline support, or reduced motion -- so a
 * mismatch ships the wrong opening palette to exactly the visitors least likely
 * to be the one reviewing it.
 */
check("field's static fallback matches the 0% keyframe", () => {
  const css = read("src", "global.css");

  const declsIn = (body) =>
    Object.fromEntries(
      [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)].map((m) => [
        m[1],
        m[2].trim(),
      ]),
    );

  const util = css.indexOf("@utility field {");
  assert(util !== -1, "no `@utility field` -- was it renamed?");
  const fallback = declsIn(css.slice(util, css.indexOf("}", util)));

  const kf = css.indexOf("@keyframes field-shift {");
  assert(kf !== -1, "no `@keyframes field-shift` -- was it renamed?");
  const zero = css.indexOf("0% {", kf);
  assert(zero !== -1, "field-shift has no 0% keyframe");
  const start = declsIn(css.slice(zero, css.indexOf("}", zero)));

  const names = Object.keys(start);
  assert(names.length > 0, "parsed no declarations from the 0% keyframe");

  const drift = names.filter((n) => fallback[n] !== start[n]);
  assert(
    drift.length === 0,
    `${drift.join(", ")} differ between the two.\n    ` +
      drift
        .map((n) => `${n}: field has ${fallback[n] ?? "(nothing)"}, 0% has ${start[n]}`)
        .join("\n    ") +
      `\n    The fallback is what paints without a scroll timeline or under ` +
      `reduced motion, so a mismatch is a wrong opening palette.`,
  );
  return `${names.length} declarations identical`;
});

// --- Report ---------------------------------------------------------------

for (const ok of passes) console.log(`  ok    ${ok}`);
for (const w of warnings) console.warn(`  WARN  ${w}`);
for (const bad of failures) console.error(`  FAIL  ${bad}`);

if (failures.length) {
  console.error(`\n${failures.length} invariant(s) broken.`);
  process.exit(1);
}
console.log(
  `\n${passes.length} invariants hold` +
    (warnings.length ? `, ${warnings.length} warning(s).` : "."),
);
