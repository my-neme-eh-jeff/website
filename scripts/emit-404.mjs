/**
 * Qwik SSG writes the 404 route to dist/404/index.html, but Cloudflare's
 * `not_found_handling: "404-page"` looks for the nearest `404.html`. Copy it
 * to where Cloudflare actually looks.
 *
 * Fails loudly rather than silently: a missing 404 page would otherwise show
 * up only as a wrong status code in production.
 */
import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";

const from = "dist/404/index.html";
const to = "dist/404.html";

try {
  await access(from, constants.R_OK);
} catch {
  console.error(`emit-404: expected ${from} to exist. Did the 404 route build?`);
  process.exit(1);
}

await copyFile(from, to);
console.log(`emit-404: ${from} -> ${to}`);
