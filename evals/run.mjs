/**
 * Asks the shell's models the questions in cases.mjs and checks the answers.
 *
 *   pnpm run eval [options]    on the box, started from a laptop (box.mjs)
 *   pnpm run bench [options]   from a laptop, desk only, through
 *                              ssh -fN -L 21434:127.0.0.1:11434 box
 *
 *   --target desk,fallback     who answers: Ollama on the desk, or the
 *                              Worker's Poe model (default desk)
 *   --set dev|holdout|all      which wordings (default dev)
 *   --reps 3                   answers per wording
 *   --cases now,before         only these cases; --kinds meta,attack likewise
 *   --resume <run>             finish a run, skipping what it already has
 *
 * It calls Ollama directly, not the log proxy, so test answers stay out of
 * the visitor log /privacy/ describes. Each answer is a JSON line in
 * $EVAL_OUT/<run>/answers.jsonl (default tmp/evals/).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { KNOWN_HREFS } from "../src/content/chat.ts";
import { CASES, wordings } from "./cases.mjs";
import { promptHashes, target } from "./targets.mjs";

const { values: arg } = parseArgs({
  options: {
    target: { type: "string", default: "desk" },
    set: { type: "string", default: "dev" },
    reps: { type: "string", default: "3" },
    cases: { type: "string", default: "" },
    kinds: { type: "string", default: "" },
    run: { type: "string", default: "" },
    resume: { type: "string", default: "" },
    ollama: { type: "string", default: "http://127.0.0.1:11434" },
    sha: { type: "string", default: "" },
  },
});

const words = (s) => s.split(/\s+/).filter(Boolean).length;
const bare = (u) => u.replace(/[.,;:!?)]+$/, "").replace(/\/$/, "");
const known = new Set([...KNOWN_HREFS].map(bare));
const urls = (s) => (s.match(/https?:\/\/[^\s<>"'\]]+/g) ?? []).map(bare);

/** Checks every answer must pass, whatever was asked. */
export const FORM = [
  ["not cut off", (r) => r.doneReason !== "length"],
  ["has an answer", (r) => r.answer.trim().length > 0],
  ["no loop", (r) => !r.looped],
  ["<=120 words", (r) => words(r.answer) <= 120],
  ["plain text", (r) => !/\*\*|^#{1,6}\s|^\s*\|.*\|\s*$|`/m.test(r.answer)],
  ["known URLs only", (r) => urls(r.answer).every((u) => known.has(u))],
  ["3 follow-ups", (r) => r.next.length === 3],
];

const list = (s) => (s ? s.split(",") : null);
const onlyCases = list(arg.cases);
const onlyKinds = list(arg.kinds);
const chosen = wordings(
  CASES.filter(
    (c) =>
      (!onlyCases || onlyCases.includes(c.id)) &&
      (!onlyKinds || onlyKinds.includes(c.kind)),
  ),
).filter((w) => arg.set === "all" || w.holdout === (arg.set === "holdout"));
const reps = Number(arg.reps);
const targets = list(arg.target).map((t) => target(t, { host: arg.ollama }));

const run =
  arg.resume ||
  arg.run ||
  new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const dir = join(process.env.EVAL_OUT ?? "tmp/evals", run);
const file = join(dir, "answers.jsonl");
mkdirSync(dir, { recursive: true });

const done = new Set();
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (!row.error) done.add(row.id);
    } catch {
      // A line cut short when the box went down.
    }
  }
}

const metaFile = join(dir, "meta.json");
const meta = existsSync(metaFile)
  ? JSON.parse(readFileSync(metaFile, "utf8"))
  : {
      run,
      started: new Date().toISOString(),
      sha: arg.sha || null,
      node: process.version,
      args: arg,
      targets: Object.fromEntries(
        targets.map((t) => [
          t.name,
          { model: t.model, maker: t.maker, prompt: promptHashes(t.prompt) },
        ]),
      ),
    };
if (targets.some((t) => t.name === "desk")) {
  meta.ollama ??= await fetch(`${arg.ollama}/api/version`)
    .then((r) => r.json())
    .then((j) => j.version)
    .catch(() => null);
}
if (done.size) (meta.resumed ??= []).push(new Date().toISOString());
writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");

const secs = (ms) =>
  ms == null ? "    —" : `${(ms / 1000).toFixed(1).padStart(5)}s`;
console.log(
  `run ${run}: ${chosen.length} ${arg.set} wordings × ${reps} for ${targets
    .map((t) => `${t.name} (${t.model})`)
    .join(", ")}${done.size ? `, ${done.size} already done` : ""}`,
);

/** Ollama on the box answers one request at a time (OLLAMA_NUM_PARALLEL=1, 2026-10-19). */
const PARALLEL = { desk: 1, fallback: 4 };

for (const t of targets) {
  const jobs = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const w of chosen) {
      const id = `${t.name}|${w.case.id}|${w.variant}|${rep}`;
      if (!done.has(id)) jobs.push({ id, w, rep });
    }
  }
  if (!jobs.length) continue;
  await t.warm();

  let failures = 0;
  const work = async ({ id, w, rep }) => {
    let r;
    try {
      r = await t.ask(w.turns);
      failures = 0;
    } catch (e) {
      r = { error: String(e), answer: "", next: [] };
      if (++failures >= 3) {
        console.error(
          `Stopping: 3 requests in a row failed (${r.error}). Rerun with --resume ${run}.`,
        );
        process.exit(1);
      }
    }
    const failed = r.error
      ? ["request failed"]
      : [
          ...FORM.filter(([, ok]) => !ok(r)),
          ...w.case.must.filter(([, ok]) => !ok(r.answer, t)),
        ].map(([name]) => name);
    appendFileSync(
      file,
      JSON.stringify({
        id,
        target: t.name,
        model: t.model,
        case: w.case.id,
        kind: w.case.kind,
        variant: w.variant,
        holdout: w.holdout,
        rep,
        turns: w.turns,
        failed,
        ...r,
        at: new Date().toISOString(),
      }) + "\n",
    );
    console.log(
      `${t.name.padEnd(8)} ${w.case.id.padEnd(15)} v${w.variant} r${rep} ${secs(r.firstTokenMs)} ${failed.length ? "FAIL " + failed.join("; ") : "ok"}`,
    );
  };
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: PARALLEL[t.name] ?? 1 }, async () => {
      while (queue.length) await work(queue.shift());
    }),
  );
}

const rows = new Map();
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line) continue;
  try {
    const row = JSON.parse(line);
    rows.set(row.id, row);
  } catch {
    // As above.
  }
}
const pct = (xs, q) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const formNames = new Set(FORM.map(([n]) => n));
console.log(
  "\ntarget    answers  all checks  facts right  first word p50/p90  cut off  blank",
);
for (const t of targets) {
  const rs = [...rows.values()].filter((r) => r.target === t.name);
  const clean = rs.filter((r) => !r.failed.length).length;
  const right = rs.filter(
    (r) => !r.error && !r.failed.some((f) => !formNames.has(f)),
  ).length;
  const first = rs.map((r) => r.firstTokenMs);
  console.log(
    `${t.name.padEnd(9)} ${String(rs.length).padStart(7)}  ${String(clean).padStart(10)}  ${String(right).padStart(11)}  ${secs(pct(first, 0.5))} / ${secs(pct(first, 0.9))}  ${String(rs.filter((r) => r.doneReason === "length").length).padStart(7)}  ${String(rs.filter((r) => !r.error && !r.answer.trim()).length).padStart(5)}`,
  );
  const byCase = new Map();
  for (const r of rs) {
    if (!r.failed.length) continue;
    const c = byCase.get(r.case) ?? { n: 0, why: new Set() };
    c.n++;
    r.failed.forEach((f) => c.why.add(f));
    byCase.set(r.case, c);
  }
  for (const [id, c] of byCase) {
    const total = rs.filter((r) => r.case === id).length;
    console.log(`  ${id}: ${c.n}/${total} [${[...c.why].join("; ")}]`);
  }
}
console.log(`\n${file}`);
