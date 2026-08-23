/**
 * Downloads the self-hosted webfonts. Run: `node scripts/fetch-fonts.mjs`
 *
 * Fonts: Hanken Grotesk (sans) and Fira Mono (mono), both SIL Open Font
 * License via Google Fonts. Identified from vana.org, which self-hosts the
 * same pair -- its @font-face families are `__Hanken_Grotesk_*` and
 * `__Fira_Mono_*`. OFL permits self-hosting and redistribution, so these are
 * committed to the repo.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCRIPT AND NOT A <link> TO fonts.googleapis.com
 *
 * Self-hosted is strictly better here: no third-party DNS + TLS + connection
 * before the first byte of font data, no dependency on another origin's
 * uptime, and no request to Google from every visitor. The whole site is
 * static assets on one origin already.
 *
 * WHY IT QUERIES THE API INSTEAD OF HARDCODING URLS
 *
 * Google's font file URLs carry an opaque hash that changes whenever they
 * re-release a family, so hardcoded URLs eventually 404. This asks the CSS API
 * for the current set and extracts what it returns.
 *
 * WHY THE VERSION IS IN THE FILENAME
 *
 * Output is `hanken-grotesk-v12-latin.woff2`, taking `v12` from the upstream
 * path. Stable filenames plus `Cache-Control: immutable` is the trap the
 * favicons already hit: a stable URL can never propagate a change. Putting the
 * upstream version in the name makes the URL content-versioned, so immutable
 * is honest -- a font update produces a new filename.
 *
 * A MODERN USER-AGENT IS REQUIRED. Google serves woff2 only to browsers it
 * recognises; a default fetch UA gets TrueType, which is roughly twice the
 * size.
 * ---------------------------------------------------------------------------
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "fonts",
);

/** Chrome UA, so the API returns woff2 rather than TrueType. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Only latin and latin-ext are kept. The other subsets Google returns
 * (cyrillic, greek, vietnamese) are dead weight for this site -- and because
 * every @font-face carries a unicode-range, keeping latin-ext costs nothing
 * until a page actually uses an accented character.
 */
const WANTED = new Set(["latin", "latin-ext"]);

const FAMILIES = [
  {
    // Variable: one file spans weight 300-800, so no per-weight downloads.
    query: "Hanken+Grotesk:wght@300..800",
    slug: "hanken-grotesk",
  },
  {
    // Fira Mono is not variable; 400 for body, 500 for emphasis in the CLI.
    query: "Fira+Mono:wght@400;500",
    slug: "fira-mono",
  },
];

/** Split a Google Fonts CSS payload into one record per @font-face. */
function parseFaces(css) {
  const faces = [];
  // Each block is preceded by a `/* subset */` comment.
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const [, subset, body] = m;
    const url = body.match(/url\(([^)]+)\)/)?.[1];
    const weight = body.match(/font-weight:\s*([^;]+);/)?.[1]?.trim();
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (url && weight && range) faces.push({ subset, url, weight, range });
  }
  return faces;
}

mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const { query, slug } of FAMILIES) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  const res = await fetch(cssUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${cssUrl} -> HTTP ${res.status}`);
  const css = await res.text();

  const faces = parseFaces(css).filter((f) => WANTED.has(f.subset));
  if (faces.length === 0) {
    throw new Error(
      `No latin faces parsed for ${slug}. Google may have changed the CSS ` +
        `format -- inspect the response before trusting this script again:\n  ${cssUrl}`,
    );
  }

  for (const face of faces) {
    // .../s/hankengrotesk/v12/<hash>.woff2  ->  v12
    const version = face.url.match(/\/(v\d+)\//)?.[1] ?? "v0";
    // A variable file spans a range ("300 800") and needs no weight in the name.
    const isRange = /\s/.test(face.weight);
    const name =
      [slug, version, isRange ? null : face.weight, face.subset]
        .filter(Boolean)
        .join("-") + ".woff2";

    const bin = await fetch(face.url, { headers: { "User-Agent": UA } });
    if (!bin.ok) throw new Error(`${face.url} -> HTTP ${bin.status}`);
    const buf = Buffer.from(await bin.arrayBuffer());

    // woff2 files begin with the signature 'wOF2'.
    const sig = buf.subarray(0, 4).toString("latin1");
    if (sig !== "wOF2") {
      throw new Error(
        `${name} is not woff2 (signature ${JSON.stringify(sig)}). The ` +
          `User-Agent is probably no longer recognised as a modern browser.`,
      );
    }

    writeFileSync(join(OUT, name), buf);
    manifest.push({
      name,
      weight: face.weight,
      range: face.range,
      bytes: buf.length,
    });
  }
}

console.log("wrote public/fonts/:");
for (const m of manifest) {
  console.log(
    `  ${m.name.padEnd(38)} ${String(m.bytes).padStart(6)} B  weight ${m.weight}`,
  );
}
console.log(
  `\ntotal ${manifest.reduce((n, m) => n + m.bytes, 0)} B across ${manifest.length} files`,
);
console.log(
  "\nunicode-range values for the @font-face blocks in src/global.css:\n",
);
for (const m of manifest) console.log(`  ${m.name}\n    ${m.range}\n`);
