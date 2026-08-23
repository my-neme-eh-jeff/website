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

import { readFileSync, existsSync } from "node:fs";
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
      "plain `npm install` silently upgrades the beta. Pin exact.",
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
