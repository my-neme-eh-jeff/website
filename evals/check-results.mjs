/**
 * Checks the runs committed under evals/results/runs before they are pushed:
 *
 *   - every visitor turn is a wording from some committed version of
 *     cases.mjs, so nothing from the visitor log is published (/privacy/
 *     promises that log is deleted after 30 days);
 *   - no file holds a zero byte or another control character, which a power
 *     cut on the box leaves and which makes git store the file as binary.
 *
 *   node evals/check-results.mjs
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = join(root, "evals", "results");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });

const known = new Set();
const tmp = mkdtempSync(join(tmpdir(), "cases-"));
try {
  const shas = git("log", "--format=%H", "--", "evals/cases.mjs").split("\n");
  for (const sha of shas.filter(Boolean)) {
    const file = join(tmp, `${sha}.mjs`);
    const source = git("show", `${sha}:evals/cases.mjs`)
      .replaceAll('from "../', `from "${pathToFileURL(root).href}/`)
      .replaceAll(
        'from "./',
        `from "${pathToFileURL(join(root, "evals")).href}/`,
      );
    writeFileSync(file, source);
    const { CASES } = await import(pathToFileURL(file).href);
    for (const c of CASES)
      for (const w of [].concat(c.ask))
        for (const t of typeof w === "string"
          ? [w]
          : Array.isArray(w)
            ? w
            : [w.q])
          known.add(typeof t === "string" ? t : t.content);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const problems = [];
let turns = 0;
const runs = join(results, "runs");
for (const run of readdirSync(runs)) {
  const file = join(runs, run, "answers.jsonl");
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const a = JSON.parse(line);
    for (const t of a.turns ?? []) {
      if (t.role !== "user") continue;
      turns++;
      if (!known.has(t.content))
        problems.push(`${run} ${a.id}: a visitor turn not in cases.mjs`);
    }
  }
}

const walk = (dir) =>
  readdirSync(dir).flatMap((f) =>
    statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)],
  );
for (const file of walk(results))
  if (/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(readFileSync(file, "utf8")))
    problems.push(`${file.slice(root.length + 1)}: a control character`);

for (const p of problems) console.log(p);
console.log(
  `${turns} visitor turns, ${known.size} wordings in cases.mjs's history: ${problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "all clear"}`,
);
process.exit(problems.length ? 1 : 0);
