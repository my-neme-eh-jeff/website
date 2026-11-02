/**
 * Starts every built HTML file with a UTF-8 byte order mark. Run by
 * `pnpm run build` after csp.mjs.
 *
 * Cloudflare serves HTML as `text/html` with no charset, so a browser looks
 * for <meta charset> in the first 1,024 bytes. Qwik writes its own tags ahead
 * of it, and 404.html's CSP <meta> goes ahead of those. A browser reads a BOM
 * before the header and the meta, so their position stops mattering.
 * `pnpm run verify` prints where the meta would end without it.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

let added = 0;
for (const file of readdirSync(DIST, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const bytes = readFileSync(join(DIST, file));
  if (bytes.subarray(0, 3).equals(BOM)) continue;
  writeFileSync(join(DIST, file), Buffer.concat([BOM, bytes]));
  added++;
}
console.log(`charset: a UTF-8 byte order mark on ${added} HTML files`);
