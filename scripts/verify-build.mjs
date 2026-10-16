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

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { grad } from "../src/components/blog/statusline/model.ts";
import { GRIDS, rasterize } from "../src/components/desk/desk.ts";

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

/*
 * The pages every per-page check runs on. Posts are discovered in dist/blog/
 * rather than listed, so a new post is checked without anyone adding it here.
 */
const PAGES = [
  "index.html",
  "blog/index.html",
  "privacy/index.html",
  ...(existsSync(p("dist", "blog"))
    ? readdirSync(p("dist", "blog"), { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            existsSync(p("dist", "blog", d.name, "index.html")),
        )
        .map((d) => `blog/${d.name}/index.html`)
    : []),
];

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

check("wrangler.jsonc runs the Worker on /api/* only", () => {
  // JSONC: full-line comments and trailing commas are the only extensions
  // this file uses. Strip both and parse it properly.
  const w = read("wrangler.jsonc")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n")
    .replace(/,(\s*[}\]])/g, "$1");
  const config = JSON.parse(w);
  if (!config.main) return "assets-only";
  const first = config.assets?.run_worker_first;
  assert(
    Array.isArray(first) &&
      first.length > 0 &&
      first.every((r) => typeof r === "string" && r.startsWith("/api/")),
    "wrangler.jsonc declares `main` without scoping it. Static asset requests " +
      "are free and unlimited; a Worker invocation counts against the 100k/day " +
      "free tier. Server code belongs behind " +
      'run_worker_first: ["/api/*"], never `true` and never unscoped.',
  );
  const pending = (config.vpc_services ?? []).filter(
    (v) => !v.service_id || v.service_id === "PENDING",
  );
  assert(
    pending.length === 0,
    `vpc_services has a placeholder service_id (${pending.map((v) => v.binding).join(", ")}). ` +
      "Create it with `wrangler vpc service create` and paste the real ID.",
  );
  return `Worker on ${first.join(", ")}`;
});

/*
 * Cloudflare applies every _headers rule whose path matches and comma-joins a
 * header set twice, so a Cache-Control in the catch-all would be appended to
 * every immutable /build/ and /assets/ file. Verified on wrangler's asset worker.
 */
check("_headers sets no Cache-Control in its catch-all block", () => {
  const blocks = read("public", "_headers").split(/\n(?=\/)/);
  const all = blocks.find((b) => b.startsWith("/*\n"));
  assert(all, "no `/*` block in public/_headers -- did its shape change?");
  assert(
    !/^\s+Cache-Control:/im.test(all),
    "the `/*` block sets Cache-Control, which every asset rule then inherits",
  );
  return `${blocks.length - 1} rules, none caching through the catch-all`;
});

check("_headers ships in dist", () => {
  assert(
    existsSync(p("dist", "_headers")),
    "dist/_headers is missing, so hashed bundles lose their immutable " +
      "Cache-Control and every asset costs a revalidation round trip.",
  );
});

/*
 * scripts/csp.mjs gives each page a policy that allows its inline scripts by
 * hash. They are hashed again here from the served pages, so a stale policy
 * fails the build instead of being blocked in the browser. The parse is
 * checked as well: every <script> a page opens must be one parsed here, and
 * nothing may need what a hash cannot allow, an on*= handler or a javascript:
 * URL.
 */
const SCRIPT =
  /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;
const attrsOf = (s) =>
  new Map(
    [
      ...s.matchAll(
        /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
      ),
    ].map((a) => [a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? ""]),
  );
check(
  "every page's inline scripts are allowed by its CSP, and only by hash",
  () => {
    const lines = read("dist", "_headers").split("\n");
    const long = lines.filter((l) => l.length > 2000);
    assert(
      long.length === 0,
      "Cloudflare ignores a _headers line over 2,000 characters, so these " +
        `lose their header: ${long.map((l) => l.trim().slice(0, 50)).join("; ")}`,
    );
    const paths = lines.filter((l) => l.startsWith("/"));
    assert(
      paths.length <= 100,
      `${paths.length} _headers rules: Cloudflare reads only the first 100.`,
    );

    const csp = new Map();
    let rule = "";
    for (const l of lines) {
      if (l.startsWith("/")) rule = l.trim();
      assert(
        !/^\s+Content-Security-Policy-Report-Only:/.test(l),
        `${rule} sends a report-only CSP, which blocks nothing`,
      );
      const m = /^\s+Content-Security-Policy:\s*(.+)$/.exec(l);
      if (m) {
        assert(!csp.has(rule), `two policies for ${rule}`);
        csp.set(rule, m[1]);
      }
    }
    assert(
      !csp.has("/*"),
      "The /* block sets a CSP. Every page would then carry two policies and " +
        "need to satisfy both, so the per-page hashes would be blocked.",
    );

    // Every page csp.mjs writes a policy for, not only PAGES.
    const pages = readdirSync(p("dist"), { recursive: true }).filter((f) =>
      f.endsWith("index.html"),
    );
    const rendered = new Map();
    let scripts = 0;
    for (const page of pages) {
      const html = read("dist", page);
      const path = `/${page.slice(0, -"index.html".length)}`;
      const policy = csp.get(path);
      assert(policy, `${page}: no Content-Security-Policy rule for ${path}`);
      const scriptSrc =
        policy
          .split(";")
          .map((d) => d.trim())
          .find((d) => d.startsWith("script-src ")) ?? "";
      assert(
        scriptSrc && !/'unsafe-(inline|eval)'/.test(scriptSrc),
        `${path}: script-src is missing or allows unsafe-inline/unsafe-eval`,
      );

      const found = [...html.matchAll(SCRIPT)];
      const opened = html.match(/<script[\s>]/gi)?.length ?? 0;
      assert(
        found.length === opened,
        `${path}: ${opened} <script> tags, but only ${found.length} parse, ` +
          "so a script may be missing from the policy.",
      );
      const markup = html
        .replace(SCRIPT, "")
        .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "");
      for (const [, raw] of markup.matchAll(
        /<[a-z][^\s/>]*((?:[^>"']|"[^"]*"|'[^']*')*)>/gi,
      )) {
        for (const [name, value] of attrsOf(raw)) {
          assert(
            !/^on[a-z]/.test(name),
            `${path}: an ${name}= handler, which no hash can allow`,
          );
          assert(
            !/^\s*javascript:/i.test(value),
            `${path}: a javascript: URL, which no hash can allow`,
          );
        }
      }

      const own = [];
      for (const [, raw, body] of found) {
        const attrs = attrsOf(raw);
        const type = attrs.get("type") ?? "";
        if (attrs.has("src") || body === "") continue;
        if (/^(application\/(ld\+)?json|qwik\/.+)$/i.test(type)) continue;
        const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
        assert(
          scriptSrc.includes(hash),
          `${path}: the inline <script${raw.slice(0, 40)}> (${body.length} B) ` +
            "is not in its CSP, so the browser would refuse to run it.",
        );
        // Rendered by a component (Qwik marks those with a `:` attribute).
        if (attrs.has(":")) own.push(hash);
        scripts++;
      }
      rendered.set(path, own.sort().join(" "));
    }
    /*
     * After a client-side navigation the first page's policy still applies, so
     * a script a component renders on one page only would be blocked when it
     * is reached that way. Those must be the same on every page.
     */
    assert(
      new Set(rendered.values()).size <= 1,
      "Component-rendered inline scripts differ between pages, so one would " +
        "run under another page's policy after a client-side navigation.",
    );
    return `${pages.length} pages, ${scripts} inline scripts, each allowed by hash`;
  },
);

check("q-manifest.json stays out of the upload, and nothing fetches it", () => {
  const ignore = existsSync(p("dist", ".assetsignore"))
    ? read("dist", ".assetsignore")
    : "";
  assert(
    /^q-manifest\.json$/m.test(ignore),
    "dist/.assetsignore does not list q-manifest.json, so wrangler uploads " +
      "the build's map of the source tree as a public file.",
  );
  const served = readdirSync(p("dist"), { recursive: true }).filter(
    (f) => /\.(html|js|json)$/.test(f) && !f.endsWith("q-manifest.json"),
  );
  const refs = served.filter((f) => read("dist", f).includes("q-manifest"));
  assert(
    refs.length === 0,
    `${refs.join(", ")} mention q-manifest, so leaving it out of the upload ` +
      "could break them.",
  );
  return `${served.length} served files never mention it`;
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
  for (const page of PAGES) {
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
  return `${PAGES.length} pages, all valid @graph`;
});

check("exactly one canonical link per page", () => {
  for (const page of PAGES) {
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
  return `${PAGES.length} pages`;
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

check("the stylesheet is inlined into every page, not linked", () => {
  for (const page of [...PAGES, "404.html"]) {
    const html = read("dist", page);
    assert(
      !/<link[^>]*rel="stylesheet"/.test(html),
      `${page} links its stylesheet: the CSS has outgrown ` +
        "inlineStylesUpToBytes in vite.config.ts. Raise the limit, or accept " +
        "the render-blocking request and update this check and the a11y-ui skill.",
    );
    assert(
      /<style[^>]*data-src="\/assets\/[^"]+-style\.css"/.test(html),
      `${page} has neither a linked nor an inlined stylesheet.`,
    );
  }
  return `${PAGES.length + 1} pages`;
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
   * one appears as a selector in the built CSS. Semantic classes (pill,
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
  for (const page of [...PAGES, "404.html"]) {
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

/** Width and height from a JPEG's first frame header (SOFn marker). */
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const sof = marker >= 0xc0 && marker <= 0xcf;
    if (sof && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

check("og:image is referenced only if it exists and is a real image", () => {
  /*
   * A referenced-but-missing og:image is worse than none: the platform reserves
   * the card's space and renders it blank. So if the tag is emitted, the file
   * must be in dist AND actually be an image. Every page, because a post can
   * carry its own cover instead of the site card.
   */
  const files = new Set();
  for (const page of PAGES) {
    const html = read("dist", page);
    const tag = html.match(
      /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/,
    );
    if (!tag) continue;

    const url = tag[1];
    const rel = url.replace(/^https?:\/\/[^/]+/, "").replace(/^\//, "");
    const onDisk = p("dist", rel);
    assert(
      existsSync(onDisk),
      `${page}: og:image points at ${url}, absent from dist.`,
    );

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
      `${rel} is ${kb} kB. Social scrapers fetch this before rendering; keep ` +
        `it under ~400 kB (JPEG, not PNG, for a gradient).`,
    );

    // Every platform crops from 1200x630; anything else gets cropped oddly.
    const size = png
      ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
      : jpegSize(buf);
    assert(size, `${rel}: could not read its dimensions.`);
    assert(
      size.w === 1200 && size.h === 630,
      `${rel} is ${size.w}x${size.h}, expected 1200x630.`,
    );

    const twitter = html.match(
      /<meta[^>]*name="twitter:card"[^>]*content="([^"]+)"/,
    );
    assert(
      twitter?.[1] === "summary_large_image",
      `${page}: twitter:card is "${twitter?.[1]}" but an og:image exists — it ` +
        `should be summary_large_image, or X renders the small card and ` +
        `wastes the image.`,
    );
    files.add(`${rel} ${kb} kB`);
  }
  return files.size ? [...files].join(", ") : "not emitted (allowed)";
});

/*
 * /blog/ draws each post twice through `?jsx` (src/routes/blog/index.tsx): its
 * cover as a print for phones, and a backdrop for hover, which is
 * src/content/backdrops/<slug>.png or else the cover again. Each is found by
 * its path, and one it cannot find renders nothing, silently.
 */
check("every post's cover and backdrop reach /blog/ as WebP srcsets", () => {
  const covers = (
    read("src", "content", "profile.ts").match(/^\s+cover: \{/gm) ?? []
  ).length;
  const imgs = [
    ...read("dist", "blog", "index.html").matchAll(/<img\b[^>]*>/g),
  ];
  assert(
    imgs.length === covers * 2,
    `profile.ts gives ${covers} post(s) a cover, each drawn twice (print ` +
      `and backdrop); /blog/ shows ${imgs.length} images`,
  );
  for (const [img] of imgs) {
    assert(
      /srcSet="[^"]*\.webp \d+w/.test(img) && !/\ssrc=/.test(img),
      `a /blog/ cover is not the ?jsx WebP srcset: ${img.slice(0, 100)}`,
    );
  }
  return `${imgs.length} image(s) for ${covers} post(s)`;
});

/*
 * A post's "N min read" is a number in profile.ts, so it goes stale when the
 * post changes. Recounted here from the built article the way profile.ts
 * describes: words outside figures, code blocks and the contents list, at 238
 * a minute, plus 12 s a figure.
 */
check("every post's reading time matches its built text", () => {
  const profile = read("src", "content", "profile.ts");
  const posts = PAGES.filter((pg) => /^blog\/[^/]+\/index\.html$/.test(pg));
  for (const page of posts) {
    const slug = page.split("/")[1];
    const entry = profile
      .split(/\bslug: /)
      .find((b) => b.startsWith(`"${slug}"`));
    const stated = Number(entry?.match(/\bminutes: (\d+)/)?.[1]);
    const html = read("dist", page);
    const article = html.slice(
      html.indexOf("<article"),
      html.indexOf("</article>"),
    );
    const figures = (article.match(/<figure\b/g) ?? []).length;
    const words = (
      article
        .replace(/<(figure|pre|details|script)\b[\s\S]*?<\/\1>/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z#0-9]+;/g, " ")
        .match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []
    ).length;
    const minutes = Math.max(1, Math.round(words / 238 + (figures * 12) / 60));
    assert(
      stated === minutes,
      `${slug}: profile.ts says minutes: ${stated}; ${words} words and ` +
        `${figures} figures make it ${minutes}. Set minutes: ${minutes}.`,
    );
  }
  return `${posts.length} post(s)`;
});

/*
 * Every image a page shows is WebP, from `?jsx` (CLAUDE.md, Invariants). An
 * og:image is not shown on a page, so it stays the JPEG the og check measures.
 */
check("every <img> on every page is a WebP srcset or an SVG", () => {
  let n = 0;
  for (const page of PAGES) {
    for (const [img] of read("dist", page).matchAll(/<img\b[^>]*>/g)) {
      n++;
      assert(
        /srcSet="[^"]*\.webp \d+w/.test(img) || /\ssrc="[^"]+\.svg"/.test(img),
        `${page}: an <img> that is neither WebP nor SVG: ${img.slice(0, 100)}`,
      );
    }
  }
  return `${n} image(s) on ${PAGES.length} pages`;
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

check("the blog's terminal palette is readable on its own ground", () => {
  /*
   * The status-line figures draw a dark terminal in BOTH themes, so the
   * --sem-* pairings above never see it. Its text tokens need 4.5:1 on
   * --term-bg, and so does every colour the context gradient can produce.
   * That one is computed from a percentage at render time, so the whole
   * 0-100 range is walked through the same grad() the figures call.
   */
  const css = read("src", "global.css");
  const term = (name) => {
    const m = css.match(new RegExp(`--term-${name}:\\s*(#[0-9a-f]{6})`, "i"));
    assert(m, `--term-${name} not found in src/global.css.`);
    return m[1];
  };
  const bg = term("bg");
  const hex = (rgb) =>
    "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("");
  const pairs = [
    ...["fg", "dim", "cyan", "yellow"].map((n) => [`--term-${n}`, term(n)]),
    ...Array.from({ length: 101 }, (_, i) => [
      `gradient at ${i}%`,
      hex(grad(i)),
    ]),
  ];
  let worst = { r: Infinity, name: "" };
  for (const [name, colour] of pairs) {
    const r = contrast(colour, bg);
    if (r < worst.r) worst = { r, name };
    assert(
      r >= 4.5,
      `${name} (${colour}) on --term-bg is ${r.toFixed(2)}:1, needs 4.5:1 ` +
        `(WCAG 1.4.3). Darken --term-bg or change the colour.`,
    );
  }
  return `worst is ${worst.name}, ${worst.r.toFixed(2)}:1`;
});

check("skip link is present, first, and points at a real target", () => {
  for (const page of PAGES) {
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
    /*
     * Focusable is not enough here: Qwik Router cancels the jump and only
     * scrolls. src/routes/layout.tsx moves focus from an inline (sync$) click
     * handler on its root element.
     */
    const root = html.match(/<div\b[^>]*class="min-h-dvh"[^>]*>/)?.[0] ?? "";
    const funcs =
      html.match(/<script q:func="qwik\/json">([\s\S]*?)<\/script>/)?.[1] ?? "";
    assert(
      /q-dp:click="#\d+"/.test(root) && funcs.includes("preventScroll"),
      `${page}: nothing moves focus to #${target}; the router only scrolls.`,
    );
  }
  return `${PAGES.length} pages`;
});

check("document structure: lang, one h1, no skipped heading levels", () => {
  for (const page of PAGES) {
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
  return `${PAGES.length} pages`;
});

check("every graphic has an accessible name or is hidden", () => {
  for (const page of PAGES) {
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
  return `${PAGES.length} pages`;
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
/*
 * The desk is drawn twice: as text in the page, and over it by the worker
 * that lights it. Both come from rasterize(), and this re-runs it here, so
 * the text the page ships is the grid the light lands on.
 */
check("the desk in the page is the grid rasterize() draws", () => {
  const html = read("dist", "index.html");
  for (const [size, { cols, rows }] of Object.entries(GRIDS)) {
    const m = new RegExp(
      `<pre\\b[^>]*data-desk-grid="${size}"[^>]*>([\\s\\S]*?)</pre>`,
    ).exec(html);
    assert(m, `index.html: no ${size} desk grid`);
    const shipped = m[1]
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
    const desk = rasterize(cols, rows);
    const want = Array.from({ length: rows }, (_, r) =>
      desk.chars.slice(r * cols, (r + 1) * cols).join(""),
    ).join("\n");
    assert(
      shipped === want,
      `index.html: the ${size} desk differs from rasterize(${cols}, ${rows})`,
    );
  }
  return Object.keys(GRIDS).join(", ");
});

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
  assert(
    dist.length > 0,
    "no built CSS in dist/assets -- run `pnpm run build`",
  );

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
        .map(
          (n) =>
            `${n}: field has ${fallback[n] ?? "(nothing)"}, 0% has ${start[n]}`,
        )
        .join("\n    ") +
      `\n    The fallback is what paints without a scroll timeline or under ` +
      `reduced motion, so a mismatch is a wrong opening palette.`,
  );
  return `${names.length} declarations identical`;
});

// --- Navigation and view transitions ----------------------------------------

/** Classes whose built rule satisfies `test`, e.g. `.grain-page{…mix-blend-mode:overlay…}`. */
function classesWhere(test) {
  const css = readdirSync(p("dist", "assets"))
    .filter((f) => f.endsWith(".css"))
    .map((f) => read("dist", "assets", f))
    .join("\n");
  const found = new Set();
  for (const m of css.matchAll(/\.([a-zA-Z0-9_-]+)\{([^}]*)\}/g)) {
    if (test(m[2])) found.add(m[1]);
  }
  return found;
}

/**
 * The classes of every element named for a view transition, whether the name
 * is inline in the HTML or set by a class rule.
 *
 * Match the whole tag first and pull `class` out of it. Anchoring on
 * `<div class="…"` instead silently matches nothing the moment the serialiser
 * reorders attributes, and a check that matches nothing passes for ever.
 */
function namedElements() {
  const namedByCss = classesWhere((rule) =>
    /view-transition-name:\s*(?!none)/.test(rule),
  );
  const found = [];
  for (const page of PAGES) {
    for (const tag of read("dist", page).match(/<[^>]*>/g) ?? []) {
      const classes = (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
      if (
        tag.includes("view-transition-name") ||
        classes.some((c) => namedByCss.has(c))
      ) {
        found.push({ page, classes });
      }
    }
  }
  assert(
    found.length > 0,
    "parsed no view-transition-name attributes -- check the extraction",
  );
  return found;
}

/*
 * A blended layer must never carry a view-transition-name.
 *
 * `grain-page` did. A named element is captured into the view transition's own
 * layer, where it has no backdrop to blend against, so `mix-blend-mode:
 * overlay` degraded to normal compositing and the grain painted as raw grey
 * noise at opacity 0.38 over the whole viewport. Measured over resume -> blog:
 * a one-frame +34.5 mean luma spike against a 38.3 steady state, with the
 * darkest histogram bucket going from 56% of pixels to 3%.
 *
 * Written as a general rule rather than a grain-specific one, because the trap
 * belongs to the combination, not to that element.
 */
check("no blended element carries a view-transition-name", () => {
  const blended = classesWhere((rule) =>
    /mix-blend-mode:\s*(?!normal)/.test(rule),
  );
  assert(
    blended.size > 0,
    "found no blended classes -- did the selector shape change?",
  );
  const named = namedElements();
  for (const { page, classes } of named) {
    const clash = classes.filter((c) => blended.has(c));
    assert(
      clash.length === 0,
      `${page}: .${clash.join(", .")} sets mix-blend-mode AND a ` +
        `view-transition-name. During a transition the element is snapshotted ` +
        `into its own layer with no backdrop, so the blend silently stops ` +
        `applying and the layer composites raw over the page.`,
    );
  }
  return `${named.length} named elements, ${blended.size} blended classes, no overlap`;
});

/*
 * Nor may a full-viewport layer. `field` was named: named groups paint above
 * the root snapshot, so its opaque gradient covered everything left in root
 * and the header, footer and grain vanished for the length of every
 * transition. The mean-luma measurement behind the name could not see that;
 * one frame of `node scripts/measure-nav.mjs --frames <dir>` does.
 */
check("no full-viewport layer carries a view-transition-name", () => {
  const full = classesWhere(
    (rule) => /position:fixed/.test(rule) && /inset:0(?![.\d])/.test(rule),
  );
  assert(
    full.has("field"),
    "`.field` is no longer a fixed, inset:0 rule -- did the selector shape change?",
  );
  for (const { page, classes } of namedElements()) {
    const clash = classes.filter((c) => full.has(c));
    assert(
      clash.length === 0,
      `${page}: .${clash.join(", .")} covers the viewport AND carries a ` +
        `view-transition-name. Named groups paint above the root snapshot, so ` +
        `it hides everything unnamed for the whole transition.`,
    );
  }
  return `${full.size} full-viewport classes, none named`;
});

/*
 * The reading column comes from head frontmatter set in
 * src/routes/blog/(post)/layout.tsx, not from the URL; src/routes/layout.tsx
 * says why. If that wiring breaks, posts still render — in the wide column —
 * so this is the only place it shows.
 */
check("posts use the reading column, home the stage, the rest the wide one", () => {
  for (const page of PAGES) {
    const html = read("dist", page);
    /* The column is the last <div> opened before the header. */
    const before = html.slice(0, html.indexOf("<header"));
    const column = [...before.matchAll(/<div\b[^>]*>/g)].at(-1)?.[0] ?? "";
    assert(/\bsite-column\b/.test(column), `${page}: no .site-column in ${column}`);
    const got = /\bdata-column="([^"]*)"/.exec(column)?.[1] ?? "wide";
    const want =
      page === "index.html"
        ? "stage"
        : page.startsWith("blog/") && page !== "blog/index.html"
          ? "reading"
          : "wide";
    assert(got === want, `${page}: ${got} column, expected ${want}`);
  }
  return `${PAGES.length} pages`;
});

/*
 * Qwik loads nothing and runs no component code until a handler that names a
 * bundle fires; then it resumes the page (q:container "paused" -> "resumed").
 * An element's own handlers fire when the reader acts on that element, which
 * is what they are for. These fire without that: window and document
 * listeners, on any scroll, click or key anywhere, and qvisible, qinit and
 * qidle by themselves. Each must be an inline sync$ (`#n`), which runs without
 * waking Qwik, or be listed in WAKES with the reason it may name a bundle.
 * The say-hi choice and the post's checkpoint rail both first shipped as a
 * plain $(). `node scripts/measure-wake.mjs` watches it in a browser.
 */
const WAKES = [
  { listener: "d:qcinit", why: "Qwik Router's startup: scroll memory" },
  { listener: "d:qrouterpopstate", why: "back and forward, a reader action" },
  {
    listener: "e:qvisible",
    page: "privacy/index.html",
    why: "the analytics switch must read this browser's choice to show it",
  },
];
check("nothing wakes Qwik before the reader acts on it", () => {
  const used = new Set();
  const named = [];
  let inline = 0;
  for (const page of [...PAGES, "404.html"]) {
    for (const [, scope, event, value] of read("dist", page).matchAll(
      /\bq-(wp?|dp?|ep?):([a-z-]+)="([^"]*)"/g,
    )) {
      if (scope[0] === "e" && !["qvisible", "qinit", "qidle"].includes(event))
        continue;
      if (value.split("|").every((qrl) => qrl.startsWith("#"))) {
        inline++;
        continue;
      }
      const listener = `${scope[0]}:${event}`;
      const allowed = WAKES.find(
        (w) => w.listener === listener && (!w.page || w.page === page),
      );
      if (allowed) used.add(allowed);
      else named.push(`${page}: q-${scope}:${event}="${value}"`);
    }
  }
  assert(
    named.length === 0,
    "These name a bundle and fire without the reader acting, so each wakes " +
      "Qwik. Make it a sync$ (state goes through attributes), or add it to " +
      `WAKES with why:\n      ${named.join("\n      ")}`,
  );
  const stale = WAKES.filter((w) => !used.has(w));
  assert(
    stale.length === 0,
    `In WAKES but no longer found, so the exception can go: ` +
      stale.map((w) => w.listener).join(", "),
  );
  return `${inline} inline, ${WAKES.length} allowed by WAKES`;
});

/*
 * The rail reads its post's headings once, untracked, and lives in the post
 * layout, which stays mounted from one post to the next. Without a per-page
 * key, client-side navigation to another post kept the first post's sections.
 */
check("the checkpoint rail is remounted for each post", () => {
  const rail = read("src", "components", "blog", "checkpoints.tsx");
  const layout = read("src", "routes", "blog", "(post)", "layout.tsx");
  if (!/untrack\(/.test(rail)) return "the rail reads its headings tracked";
  assert(
    /<Checkpoints\s+key=\{[^}]+\}/.test(layout),
    "src/routes/blog/(post)/layout.tsx renders <Checkpoints> without a key, " +
      "so it keeps the first post's sections after navigating to another.",
  );
});

/*
 * <Link> prefetches through Qwik's preloader. With `preloader: false` the
 * preloader module never loads, so every visible, hover and click prefetch is
 * a silent no-op and a click fetches the next route as a waterfall. Its
 * bootstrap is a preload of the bundle graph. Numbers in src/entry.ssr.tsx.
 */
check("the preloader ships, so <Link> prefetch has something to call", () => {
  for (const page of PAGES) {
    assert(
      /<link\b[^>]*\brel="preload"[^>]*bundle-graph\.json/.test(
        read("dist", page),
      ),
      `${page}: no bundle-graph preload -- is \`preloader: false\` back in ` +
        `src/entry.ssr.tsx?`,
    );
  }
  return `${PAGES.length} pages`;
});

/*
 * Client-side navigation is silent to a screen reader unless something
 * announces it; the router does not. The region must start empty, or it reads
 * the title out a second time to anyone browsing the page.
 */
check("every page has an empty route announcer", () => {
  for (const page of PAGES) {
    const regions =
      read("dist", page).match(
        /<p\b[^>]*aria-live="assertive"[^>]*>[^<]*<\/p>/g,
      ) ?? [];
    assert(regions.length === 1, `${page}: ${regions.length} route announcers`);
    assert(
      /><\/p>$/.test(regions[0]),
      `${page}: the route announcer has text at load: ${regions[0]}`,
    );
  }
  return `${PAGES.length} pages`;
});

/*
 * A click must not re-run the root layout. Each value it shows per page is read
 * in JSX, which the optimizer compiles to a signal binding and serialises into
 * the page's q:func script. For an expression with a call, a module-scope name
 * (even a shadowed one, like the route's own `head` export) or over 150
 * characters, rc.3 instead evaluates it in the render, which subscribes the
 * whole layout -- silently, so a missing function here is the only sign.
 */
check("the root layout's per-page values are bindings, not re-renders", () => {
  const reads = [
    "frontmatter.column",
    "frontmatter.navHref",
    "frontmatter.navCurrent",
    "frontmatter.transitionName",
    "prevUrl",
  ];
  for (const page of PAGES) {
    const funcs =
      read("dist", page).match(
        /<script q:func="qwik\/json">([\s\S]*?)<\/script>/,
      )?.[1] ?? "";
    assert(
      funcs,
      `${page}: no q:func script -- has Qwik changed how it serialises bindings?`,
    );
    const missing = reads.filter((r) => !funcs.includes(r));
    assert(
      missing.length === 0,
      `${page}: no binding reads ${missing.join(", ")}, so src/routes/layout.tsx ` +
        `re-renders on every navigation. Keep that JSX expression free of calls ` +
        `and module-scope names, and under 150 characters.`,
    );
  }
  return `${reads.length} bindings on ${PAGES.length} pages`;
});

// --- Report ---------------------------------------------------------------

// --- Privacy ---------------------------------------------------------------

check("no third-party script is loaded by the built HTML", () => {
  /*
   * The one third-party script, Cloudflare's analytics beacon, is created at
   * runtime by the guarded loader in src/content/analytics.ts, never written
   * as a tag. A <script src> pointing off-origin would bypass every opt-out.
   * (Scripts Cloudflare injects at the edge can't be seen here — the site
   * must be switched to snippet mode in the dashboard for that.)
   */
  for (const page of PAGES) {
    const html = read("dist", page);
    for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
      assert(m[1].startsWith("/"), `${page}: third-party script ${m[1]}`);
    }
  }
  return `${PAGES.length} pages`;
});

check("analytics loads only through the guarded loader", () => {
  const required = [
    "globalPrivacyControl",
    "doNotTrack",
    "analytics:off",
    "/cdn-cgi/trace",
    // A sample of the exclusion list: EU, EEA, UK, CH.
    '"DE"',
    '"FR"',
    '"IE"',
    '"NO"',
    '"IS"',
    '"GB"',
    '"CH"',
  ];
  for (const page of PAGES) {
    const html = read("dist", page);
    const n = html.split("static.cloudflareinsights.com").length - 1;
    assert(n === 1, `${page}: beacon URL appears ${n} times, expected 1`);
    for (const r of required) {
      assert(html.includes(r), `${page}: loader lacks ${r}`);
    }
  }
  return `${PAGES.length} pages`;
});

check("every page links the privacy notice from the footer", () => {
  for (const page of [...PAGES, "404.html"]) {
    const footer =
      read("dist", page).match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    assert(
      /href="\/privacy\/"/.test(footer),
      `${page}: no /privacy/ link in footer`,
    );
  }
  return `${PAGES.length + 1} pages`;
});

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
