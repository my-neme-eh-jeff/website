/**
 * Post-SSG fixups. Two jobs, both because Qwik's output and Cloudflare's
 * expectations don't quite line up.
 *
 * 1. Qwik SSG writes the 404 route to dist/404/index.html, but Cloudflare's
 *    `not_found_handling: "404-page"` looks for the nearest `404.html`.
 *
 * 2. Qwik's sitemap lists every generated route, including /404/. A sitemap
 *    advertises canonical, indexable pages; an error page is neither.
 *    We can't just exclude /404 from SSG — job 1 needs that file to exist.
 *
 * Both fail loudly. A silently missing 404 or a sitemap advertising an error
 * page only shows up later as a wrong status code or a Search Console warning.
 */
import { copyFile, access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";

const SRC_404 = "dist/404/index.html";
const OUT_404 = "dist/404.html";
const SITEMAP = "dist/sitemap.xml";

// --- 1. put the 404 where Cloudflare looks -------------------------------
try {
  await access(SRC_404, constants.R_OK);
} catch {
  console.error(`postbuild: expected ${SRC_404} to exist. Did the 404 route build?`);
  process.exit(1);
}
await copyFile(SRC_404, OUT_404);
console.log(`postbuild: ${SRC_404} -> ${OUT_404}`);

// --- 2. drop the error page from the sitemap ------------------------------
let xml;
try {
  xml = await readFile(SITEMAP, "utf8");
} catch {
  console.error(`postbuild: ${SITEMAP} missing. Did the ssgAdapter run?`);
  process.exit(1);
}

const before = (xml.match(/<url>/g) ?? []).length;
// Each entry is a self-contained <url>...</url>; drop any whose loc is /404/.
const cleaned = xml.replace(/<url>(?:(?!<\/url>)[\s\S])*?\/404\/[\s\S]*?<\/url>\s*/g, "");
const after = (cleaned.match(/<url>/g) ?? []).length;

if (after === before) {
  console.error("postbuild: no /404/ entry found in the sitemap. Did Qwik change its output?");
  process.exit(1);
}
await writeFile(SITEMAP, cleaned);
console.log(`postbuild: sitemap ${before} -> ${after} urls (dropped /404/)`);
