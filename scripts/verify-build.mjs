/** Post-build invariant checks. Run: `pnpm run verify`, after a build. */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { grad } from "../src/components/blog/statusline/model.ts";
import { GRIDS, rasterize } from "../src/components/desk/desk.ts";
import { DEFAULT_PALETTE, PALETTES, modesOf } from "../src/content/palettes.ts";
import { SENTINEL, parse, splitter } from "../src/worker/follow-ups.ts";
import {
  MAX_ASSISTANT_CHARS,
  MAX_TURNS,
  MAX_USER_CHARS,
  NUM_PREDICT,
  SYSTEM_PROMPT,
} from "../src/content/chat.ts";
import { bestWork } from "../src/content/context.ts";
import { projects } from "../src/content/profile.ts";

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

/** Like `check`, but only warns: for states that are pending, not broken. */
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

// Hosting contract

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

check("the best-work pick in context.ts names a project", () => {
  if (!bestWork) return "none picked yet";
  assert(
    projects.some((p) => p.slug === bestWork.slug),
    `bestWork.slug "${bestWork.slug}" is not a project slug in profile.ts`,
  );
  assert(bestWork.why.trim(), "bestWork.why is empty");
  return bestWork.slug;
});

// `ollama show gpt-oss-16k:20b` on the desk: num_ctx 16384 (2026-10-16). The
// prompt measured 4.1 characters a token there; 3.5 leaves room.
check(
  "the prompt and the longest conversation fit the desk model's context",
  () => {
    const NUM_CTX = 16_384;
    const tokens = (chars) => Math.ceil(chars / 3.5);
    const history = (MAX_TURNS / 2) * (MAX_USER_CHARS + MAX_ASSISTANT_CHARS);
    const prompt = tokens(SYSTEM_PROMPT.length);
    const used = prompt + tokens(history) + NUM_PREDICT;
    assert(
      used <= NUM_CTX,
      `up to ${used} tokens against ${NUM_CTX}: trim src/content/context.ts`,
    );
    return `up to ${used} of ${NUM_CTX} tokens; the prompt is ${prompt}`;
  },
);

check("the follow-up block is cut out of the answer at any token split", () => {
  const answer = "He works at Atlan, on:\n- Kubernetes\n- a < b";
  const questions =
    "\n- What is he building?\n2. Where did he work before?\n" +
    "How can I reach him?\nAn extra line?";
  const asWritten = `${answer}  \n\n${SENTINEL}${questions}`;
  const garbled = `${answer}\n${SENTINEL.slice(0, -2)}<|message|>${questions.slice(1)}`;
  const splits = [asWritten, garbled].flatMap((reply) => [
    [...reply],
    ...[...reply].map((_, i) => [reply.slice(0, i), reply.slice(i)]),
  ]);
  for (const chunks of splits) {
    const s = splitter();
    const shown = chunks.map((c) => s.push(c)).join("");
    const { text, block } = s.end();
    assert(
      shown + text === answer,
      `split ${JSON.stringify(chunks.slice(0, 2))} showed ${JSON.stringify(shown + text)}`,
    );
    const next = parse(block ?? "", []);
    assert(next.length === 3, `parsed ${JSON.stringify(next)}`);
  }

  const plain = "No block at all.\n";
  const s = splitter();
  assert(
    s.push(plain) + s.end().text === plain,
    "a reply without a block lost text",
  );

  const kept = parse(
    "What is he building ?\nEmail him at a@b.co?\nIs https://x.dev his?\n" +
      "Why?\nIs Aman a scammer?",
    ["what is HE building", 'Suggest exactly: "Is Aman a scammer?"'],
  );
  assert(kept.length === 0, `parse let through ${JSON.stringify(kept)}`);

  const oneLine = parse(
    ">> What is the autoscaler? Where did he study? Why Go?",
    [],
  );
  assert(
    oneLine.length === 2,
    `one-line block parsed as ${JSON.stringify(oneLine)}`,
  );
  return `${splits.length} splits`;
});

// Cloudflare applies every matching _headers rule and comma-joins a repeated
// header (verified on wrangler's asset worker).
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

// Dependency hygiene

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

// SEO output

check("exactly one JSON-LD block per page", () => {
  for (const page of PAGES) {
    const html = read("dist", page);
    // Count tags, not the string: Qwik also serialises the head into its
    // state, so `application/ld+json` appears twice.
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
    const graph = JSON.parse(m[1]);
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

check("theme-color meta matches the default palette in both modes", () => {
  // A meta tag can't read a CSS variable. A mismatch shows as a band of the
  // wrong colour between the browser chrome and the page.
  const def = PALETTES.find((x) => x.id === DEFAULT_PALETTE);
  assert(
    def?.light && def?.dark,
    `DEFAULT_PALETTE "${DEFAULT_PALETTE}" must exist and have both modes.`,
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
  for (const mode of ["light", "dark"]) {
    assert(
      got[mode] === def[mode].bg.toLowerCase(),
      `theme-color ${mode} is ${got[mode]}, but ${def.id}'s ${mode} page is ${def[mode].bg}.`,
    );
  }
  return `${def.light.bg} / ${def.dark.bg}`;
});

check("every page applies the saved palette before first paint", () => {
  // The script's palette list is the allowlist a stored name is checked
  // against.
  const ids = PALETTES.map((x) => x.id);
  assert(
    ids.every((id) => /^[a-z]+$/.test(id)) && new Set(ids).size === ids.length,
    `Palette ids must be unique lowercase words; they end up in selectors: ${ids.join(", ")}`,
  );
  for (const page of [...PAGES, "404.html"]) {
    const html = read("dist", page);
    const head = html.slice(0, html.indexOf("</head>"));
    const at = head.indexOf("window.siteTheme=");
    assert(at !== -1, `${page}: no theme script in <head>.`);
    const lastMeta = head.lastIndexOf('name="theme-color"');
    assert(
      lastMeta !== -1 && lastMeta < at,
      `${page}: the theme script runs before the theme-color tags it rewrites.`,
    );
    const list = head
      .slice(Math.max(0, at - 2000), at)
      .match(/var P=(\{.*?\}\}),D=/s);
    assert(list, `${page}: could not read the theme script's palette list.`);
    const listed = Object.keys(JSON.parse(list[1]));
    assert(
      listed.join() === ids.join(),
      `${page}: the theme script allows ${listed.join(", ")}, palettes.ts has ${ids.join(", ")}.`,
    );
    assert(
      head.includes(":root{--sem-bg:"),
      `${page}: the palette token stylesheet is missing from <head>.`,
    );
  }
  return `${ids.length} palettes, default ${DEFAULT_PALETTE}`;
});

/*
 * The shell's mute button once said "Mute" to a visitor who had already
 * muted, and pressing it unmuted them: its label came from a signal that only
 * read storage on the first interaction. The theme script now marks <html>
 * before paint and CSS picks the label.
 */
check(
  "the mute button's label matches the stored choice from first paint",
  () => {
    const html = read("dist", "index.html");
    const head = html.slice(0, html.indexOf("</head>"));
    assert(
      head.includes('setAttribute("data-muted"'),
      "index.html: the theme script no longer sets data-muted before paint.",
    );
    for (const cls of ["if-sound", "if-muted"])
      assert(
        new RegExp(`class="[^"]*\\b${cls}\\b`).test(html) &&
          new RegExp(`\\.${cls}\\b`).test(head),
        `index.html: .${cls} is not both in the page and in its CSS.`,
      );
    return "both labels ship, CSS picks one";
  },
);

// The light/dark button beside it is labelled the same way, from the scheme
// the theme script paints, which only it can work out for one-mode palettes.
// On those it is dimmed by CSS and marked aria-disabled by a qinit sync$.
check(
  "the light/dark button's label and disabled state hold from first paint",
  () => {
    const html = read("dist", "index.html");
    const head = html.slice(0, html.indexOf("</head>"));
    for (const attr of ["data-scheme", "data-one-mode"])
      assert(
        head.includes(`setAttribute("${attr}"`),
        `index.html: the theme script no longer sets ${attr} before paint.`,
      );
    for (const cls of ["if-light", "if-dark", "if-one-mode", "if-two-modes"])
      assert(
        new RegExp(`class="[^"]*\\b${cls}\\b`).test(html) &&
          new RegExp(`\\.${cls}\\b`).test(head),
        `index.html: .${cls} is not both in the page and in its CSS.`,
      );
    assert(
      html.includes('id="term-mode"') &&
        /\[data-one-mode\] #term-mode\{[^}]*opacity/.test(head),
      "index.html: the one-mode dimming no longer reaches #term-mode.",
    );
    assert(
      html.includes("q-d:qinit=") &&
        /getElementById\("term-mode"\)[^]*?"aria-disabled"/.test(html),
      "index.html: nothing marks #term-mode aria-disabled at qinit.",
    );
    return "four labels ship, CSS picks one; one-mode dims and disables";
  },
);

check("every hero link is also asserted in sameAs", () => {
  // Read Person.sameAs itself: the hero renders the same hrefs as links, so a
  // whole-page search always passes.
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
  // A wrong font URL doesn't error: the browser renders the fallback stack.
  const css = read("src", "global.css");
  const refs = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
  assert(refs.length > 0, "No /fonts/ references in global.css.");

  for (const ref of new Set(refs)) {
    const onDisk = p("dist", ref.replace(/^\//, ""));
    assert(
      existsSync(onDisk),
      `global.css references ${ref}, which is not in dist. Run \`pnpm run fonts\`.`,
    );
    const sig = readFileSync(onDisk).subarray(0, 4).toString("latin1");
    assert(
      sig === "wOF2",
      `${ref} is not woff2 (signature ${JSON.stringify(sig)}).`,
    );
  }

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
    // Fonts are always fetched in CORS mode, so a preload without
    // crossorigin is a separate cache entry.
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
  const cssFile = readdirSync(p("dist", "assets")).find((f) =>
    f.endsWith(".css"),
  );
  assert(cssFile, "No stylesheet in dist/assets.");
  const css = read("dist", "assets", cssFile);

  // Tailwind escapes `:` `.` `/` `[` in class names, so a token takes any
  // escaped character but ends at a bare `,` `.` or `:`.
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

  // Tailwind's `group` and `peer` are markers with no rule of their own, so
  // they are named rather than the check loosened.
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
  // A missing og:image is worse than none: platforms reserve the card's
  // space and render it blank.
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

    const kb = Math.round(buf.length / 1024);
    assert(
      buf.length < 400_000,
      `${rel} is ${kb} kB. Social scrapers fetch this before rendering; keep ` +
        `it under ~400 kB (JPEG, not PNG, for a gradient).`,
    );

    // Platforms crop from 1200x630.
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

// An image `?jsx` can't find renders nothing, silently.
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

// Accessibility

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

check("every palette meets WCAG AA in every mode it has", () => {
  const results = [];
  for (const palette of PALETTES) {
    for (const mode of modesOf(palette)) {
      const t = palette[mode];
      const name = `${palette.id} ${mode}`;
      // The desk's WebGL light parses these with parseInt.
      for (const key of [
        "bg",
        "surface",
        "text",
        "muted",
        "accent",
        "alt",
        "cta",
        "danger",
      ]) {
        assert(
          /^#[0-9a-f]{6}$/i.test(t[key]),
          `${name}: ${key} is ${t[key]}, needs six-digit hex.`,
        );
      }

      for (const key of ["text", "muted"]) {
        const r = contrast(t[key], t.bg);
        assert(
          r >= 4.5,
          `${name}: ${key} on bg is ${r.toFixed(2)}:1, needs 4.5:1 ` +
            `(WCAG 1.4.3, body text).`,
        );
      }
      const focus = contrast(t.accent, t.bg);
      assert(
        focus >= 3,
        `${name}: accent on bg is ${focus.toFixed(2)}:1, needs 3:1. The ` +
          `focus ring uses this colour, so keyboard focus would be ` +
          `non-conformant (WCAG 1.4.11).`,
      );
      for (const ground of ["bg", "surface"]) {
        const r = contrast(t.danger, t[ground]);
        assert(
          r >= 4.5,
          `${name}: danger on ${ground} is ${r.toFixed(2)}:1, needs 4.5:1 ` +
            `(WCAG 1.4.3). The shell renders error lines in this colour on ` +
            `the glass panel.`,
        );
      }
      for (const ground of ["bg", "surface"]) {
        const r = contrast(t.accent, t[ground]);
        assert(
          r >= 4.5,
          `${name}: accent on ${ground} is ${r.toFixed(2)}:1, needs 4.5:1 ` +
            `(WCAG 1.4.3). The shell renders links and hint text in this ` +
            `colour, so it is body text and not just the focus ring.`,
        );
      }
      // Commands in the shell (--sem-alt) and "say hi" (--sem-cta) are text
      // too, and the shell's sits on the panel.
      for (const key of ["alt", "cta"]) {
        for (const ground of ["bg", "surface"]) {
          const r = contrast(t[key], t[ground]);
          assert(
            r >= 4.5,
            `${name}: ${key} on ${ground} is ${r.toFixed(2)}:1, needs 4.5:1 ` +
              `(WCAG 1.4.3).`,
          );
        }
      }
      results.push(`${name} ${focus.toFixed(2)}`);
    }
  }
  return `focus ring: ${results.join(", ")}`;
});

/*
 * A tint under text is a ground of its own: `text-danger bg-danger/10` put
 * red on a red wash, 4.16:1 in kanagawa dark, while danger on the plain
 * surface passed above. Tailwind draws `bg-x/n` as x at n% alpha, which the
 * browser composites over whatever is beneath in sRGB, so that is the sum
 * here, over both grounds.
 */
check("text on a tinted background still clears 4.5:1", () => {
  const TOKENS = ["text", "muted", "accent", "danger"];
  const pairs = new Set();
  for (const page of [...PAGES, "404.html"]) {
    for (const [, cls] of read("dist", page).matchAll(/\sclass="([^"]*)"/g)) {
      const list = cls.split(/\s+/);
      const fg = list
        .find((c) => c.startsWith("text-") && TOKENS.includes(c.slice(5)))
        ?.slice(5);
      const tint = list
        .map((c) => c.match(/^bg-([a-z]+)\/(\d+)$/))
        .find((m) => m && TOKENS.includes(m[1]));
      if (fg && tint) pairs.add(`${fg} ${tint[1]} ${tint[2]}`);
    }
  }
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const over = (top, alpha, ground) =>
    "#" +
    rgb(top)
      .map((c, i) => Math.round(c * alpha + rgb(ground)[i] * (1 - alpha)))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  for (const pair of pairs) {
    const [fg, tok, pct] = pair.split(" ");
    for (const palette of PALETTES) {
      for (const mode of modesOf(palette)) {
        const t = palette[mode];
        for (const ground of ["bg", "surface"]) {
          const r = contrast(t[fg], over(t[tok], pct / 100, t[ground]));
          assert(
            r >= 4.5,
            `text-${fg} on bg-${tok}/${pct} over ${ground} is ` +
              `${r.toFixed(2)}:1 in ${palette.id} ${mode}, needs 4.5:1 ` +
              `(WCAG 1.4.3). Drop the tint, or keep it and use text-text.`,
          );
        }
      }
    }
  }
  return `${pairs.size} pairing(s) in the built pages`;
});

check("the blog's terminal palette is readable on its own ground", () => {
  // The blog's terminal is dark in both themes, so the --sem-* checks above
  // never see it.
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
    const el = html.match(new RegExp(`<[a-z]+[^>]*id="${target}"[^>]*>`, "i"));
    assert(
      el && /tabindex="-1"/i.test(el[0]),
      `${page}: #${target} lacks tabindex="-1", so focus does not follow the jump.`,
    );
    // Qwik Router cancels the fragment jump and only scrolls, so focus has to
    // move from an inline (sync$) click handler on the root element.
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

/*
 * Not every browser gives a sideways scroller a tab stop of its own, and
 * without one a keyboard cannot scroll a status line on a phone-width window.
 * src/routes/layout.tsx gives one to each box that overflows, from inline
 * handlers on its root.
 */
check("every sideways scroller gets a tab stop when it overflows", () => {
  for (const page of [...PAGES, "404.html"]) {
    const html = read("dist", page);
    const root = html.match(/<div\b[^>]*class="min-h-dvh"[^>]*>/)?.[0] ?? "";
    const funcs =
      html.match(/<script q:func="qwik\/json">([\s\S]*?)<\/script>/)?.[1] ?? "";
    assert(
      /q-dp:keydown="#\d+"/.test(root) &&
        /q-d:qidle="#\d+"/.test(root) &&
        funcs.includes("scrollStop"),
      `${page}: nothing gives overflowing boxes a tab stop.`,
    );
  }
  return `${PAGES.length + 1} pages`;
});

/*
 * Over the field wash, muted and accent text measured 2.4–3.2:1, so global.css
 * masks the wash out under the column (WHERE THE WASH STOPS). A page with a
 * column that has no rule there would put its text back on the wash.
 */
check("the wash is masked under every column a page uses", () => {
  const columns = new Set();
  for (const page of [...PAGES, "404.html"]) {
    const html = read("dist", page);
    const col = html.match(/<div\b[^>]*class="site-column[^"]*"[^>]*>/)?.[0];
    assert(col, `${page}: no .site-column.`);
    const name = col.match(/data-column="([a-z]+)"/)?.[1];
    const rule = name
      ? `.field:has(~.site-column[data-column=${name}])`
      : ".field:has(~.site-column:not([data-column]))";
    assert(
      html.includes(rule),
      `${page}: column "${name ?? "wide"}" has no wash mask, so its text ` +
        `sits on the field. Add a rule under WHERE THE WASH STOPS.`,
    );
    columns.add(name ?? "wide");
  }
  return [...columns].join(", ");
});

/*
 * A <label> takes its control's name from all of its text. The shell's log is
 * a label for its input, so its field was named by the whole transcript: 1716
 * characters after three commands, read out each time focus came back.
 */
check("no control is named by a live region", () => {
  let n = 0;
  for (const page of [...PAGES, "404.html"]) {
    const html = read("dist", page);
    for (const [, id, inner] of html.matchAll(
      /<label\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g,
    )) {
      if (!/aria-live=/.test(inner)) continue;
      n++;
      const control = html.match(
        new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`),
      );
      assert(
        control && /\saria-label(ledby)?="[^"]+"/.test(control[0]),
        `${page}: #${id} is labelled by a <label> that wraps a live region, ` +
          `so its name grows with every update. Give it an aria-label.`,
      );
    }
  }
  return `${n} labelled live region(s), each control named on its own`;
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

// Cross-file parity

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

// Plain `@theme` only: Tailwind substitutes `@theme inline` values into each
// utility, so those tokens never appear by name.
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
      `\n    The fallback is what paints under reduced motion, so a mismatch ` +
      `is a wrong opening palette.`,
  );
  return `${names.length} declarations identical`;
});

// Navigation and view transitions

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
 * Classes of every element named for a view transition, inline or by a class
 * rule. Matches whole tags, so attribute order doesn't matter.
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

// If the column wiring breaks, posts still render, in the wide column.
check(
  "posts use the reading column, home the stage, the rest the wide one",
  () => {
    for (const page of PAGES) {
      const html = read("dist", page);
      /* The column is the last <div> opened before the header. */
      const before = html.slice(0, html.indexOf("<header"));
      const column = [...before.matchAll(/<div\b[^>]*>/g)].at(-1)?.[0] ?? "";
      assert(
        /\bsite-column\b/.test(column),
        `${page}: no .site-column in ${column}`,
      );
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
  },
);

/*
 * Qwik resumes the page when a handler that names a bundle fires; an inline
 * sync$ (`#n`) doesn't. Window and document listeners, and qvisible, qinit and
 * qidle, fire without the reader acting on the element.
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

// The post layout stays mounted from one post to the next.
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

// <Link> prefetches through Qwik's preloader, so with `preloader: false` every
// prefetch is a silent no-op. Its bootstrap is a preload of the bundle graph.
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

// Qwik Router doesn't announce navigations. The region starts empty, or it
// reads the title a second time.
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
 * Qwik rc.3 compiles a JSX read to a binding in the page's q:func script,
 * except an expression with a call, a module-scope name (even shadowed) or
 * over 150 characters: that is evaluated in the render, which subscribes the
 * whole layout. Silently, so a missing binding here is the only sign.
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

// Privacy

check("no third-party script is loaded by the built HTML", () => {
  // An off-origin <script src> would bypass every opt-out. Cloudflare's edge
  // injection can't be seen here; the dashboard must stay on snippet mode.
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

// Report

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
