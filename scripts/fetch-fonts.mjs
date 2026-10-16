/**
 * Downloads the self-hosted webfonts into public/fonts. Run: `pnpm run fonts`
 *
 * Hanken Grotesk and Fira Mono, both SIL Open Font License via Google Fonts,
 * which permits self-hosting and redistribution.
 *
 * Google's file URLs carry a hash that changes on each re-release, so this
 * asks the CSS API for the current set. The upstream version (`v12`) goes in
 * each filename, so `Cache-Control: immutable` holds when a font updates.
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

/** Google serves woff2 only to a UA it recognises; others get TrueType. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** latin-ext costs nothing until used: every @font-face has a unicode-range. */
const WANTED = new Set(["latin", "latin-ext"]);

const FAMILIES = [
  {
    query: "Hanken+Grotesk:wght@300..800",
    slug: "hanken-grotesk",
  },
  {
    query: "Fira+Mono:wght@400;500",
    slug: "fira-mono",
  },
];

function parseFaces(css) {
  const faces = [];
  // Google precedes each block with a `/* subset */` comment.
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
