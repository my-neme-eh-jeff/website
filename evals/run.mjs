/**
 * Asks the shell's models the questions in cases.mjs and checks the answers.
 *
 *   pnpm run eval [options]    on the box, started from a laptop (box.mjs)
 *   pnpm run bench [options]   from a laptop, desk only, through
 *                              ssh -fN -L 21434:127.0.0.1:11434 box
 *
 *   --target desk,fallback     who answers (default desk): Ollama on the
 *                              desk, the Worker's Poe model, desk:<model>
 *                              for another model on the desk, or
 *                              <provider>:<model> for one in models.mjs
 *   --think false              overrides the desk's reasoning setting
 *   --extra '{"effort":"low"}' fields added to every request; on the desk,
 *                              its options merge with Ollama's, so
 *                              '{"options":{"num_ctx":8192}}' keeps the rest
 *   --set dev|holdout|all      which wordings (default dev)
 *   --reps 3                   answers per wording
 *   --cases now,before         only these cases; --kinds meta,attack likewise
 *   --resume <run>             finish a run, skipping what it already has
 *   --judge                    then grade answers with the judges in
 *                              models.mjs (--judge-only: grade, don't ask)
 *   --judge-reps 1             grade only the first N answers per wording
 *   --budget-usd 1             stop judging once this much is spent
 *   --floor-usd 5              never take a provider's balance below this
 *
 * It calls Ollama directly, not the log proxy, so test answers stay out of
 * the visitor log /privacy/ describes. Each answer, with `raw`, everything
 * the model wrote before the Worker's relay parsed it, is a JSON line in
 * $EVAL_OUT/<run>/answers.jsonl (default tmp/evals/), each judge's call one
 * in calls.jsonl, and each answer's verdicts one in judgments.jsonl.
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
import { CASES, wordings } from "./cases.mjs";
import { FORM, failedChecks, recheck } from "./checks.mjs";
import { judge } from "./judges.mjs";
import { balanceUsd } from "./llm.mjs";
import { nameOf, panelFor } from "./models.mjs";
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
    think: { type: "string" },
    extra: { type: "string", default: "{}" },
    sha: { type: "string", default: "" },
    judge: { type: "boolean", default: false },
    "judge-only": { type: "boolean", default: false },
    "judge-reps": { type: "string", default: "1" },
    "budget-usd": { type: "string", default: "1" },
    "floor-usd": { type: "string", default: "5" },
  },
});

const list = (s) => (s ? s.split(",") : null);
const onlyCases = list(arg.cases);
const onlyKinds = list(arg.kinds);
const picked = (c) =>
  (!onlyCases || onlyCases.includes(c.id)) &&
  (!onlyKinds || onlyKinds.includes(c.kind));
const inSet = (holdout) =>
  arg.set === "all" || holdout === (arg.set === "holdout");
const chosen = wordings(CASES.filter(picked)).filter((w) => inSet(w.holdout));
const byCase = new Map(CASES.map((c) => [c.id, c]));
const reps = Number(arg.reps);
const think =
  arg.think === undefined
    ? undefined
    : ({ true: true, false: false }[arg.think] ?? arg.think);
const targets = list(arg.target).map((t) =>
  target(t, { host: arg.ollama, think, extra: JSON.parse(arg.extra) }),
);

const run =
  arg.resume ||
  arg.run ||
  new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const dir = join(process.env.EVAL_OUT ?? "tmp/evals", run);
const file = join(dir, "answers.jsonl");
const callsFile = join(dir, "calls.jsonl");
const judgedFile = join(dir, "judgments.jsonl");
mkdirSync(dir, { recursive: true });

/** The last line per id, so a retried answer replaces its failed attempt. */
function rowsOf(path) {
  const rows = new Map();
  if (!existsSync(path)) return rows;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      rows.set(row.id, row);
    } catch {
      // A line cut short when the box went down.
    }
  }
  return rows;
}
const keep = (path, row) => appendFileSync(path, JSON.stringify(row) + "\n");

const done = new Set(
  [...rowsOf(file).values()].filter((r) => !r.error).map((r) => r.id),
);

const metaFile = join(dir, "meta.json");
const meta = existsSync(metaFile)
  ? JSON.parse(readFileSync(metaFile, "utf8"))
  : { run, started: new Date().toISOString(), sha: arg.sha || null };
meta.node = process.version;
meta.args = arg;
meta.targets ??= {};
for (const t of targets) {
  const now = promptHashes(t.prompt).full;
  const then = meta.targets[t.name]?.prompt?.full;
  if (then && then !== now) {
    console.error(
      `${t.name}'s prompt is ${now} here but ${then} in run ${run}: answers and grades must come from the same prompt. Check out the commit that made them, or start a new run.`,
    );
    process.exit(1);
  }
  meta.targets[t.name] ??= {
    model: t.model,
    maker: t.maker,
    prompt: promptHashes(t.prompt),
  };
  meta.targets[t.name].onDesk ??= t.onDesk;
}
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

/** Ollama on the box answers one request at a time (OLLAMA_NUM_PARALLEL=1, 2026-10-19). */
const parallel = (t) => (t.onDesk ? 1 : 4);

async function pool(items, n, work) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) await work(queue.shift());
    }),
  );
}

if (!arg["judge-only"]) {
  console.log(
    `run ${run}: ${chosen.length} ${arg.set} wordings × ${reps} for ${targets
      .map((t) => `${t.name} (${t.model})`)
      .join(", ")}${done.size ? `, ${done.size} already done` : ""}`,
  );
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
    await pool(jobs, parallel(t), async ({ id, w, rep }) => {
      let r;
      for (const wait of [5_000, 15_000, null]) {
        try {
          r = await t.ask(w.turns);
          break;
        } catch (e) {
          r = { error: String(e), answer: "", next: [] };
          if (wait) await new Promise((ok) => setTimeout(ok, wait));
        }
      }
      if (!r.error) failures = 0;
      else {
        if (++failures >= 3) {
          console.error(
            `Stopping: 3 requests in a row failed (${r.error}). Rerun with --resume ${run}.`,
          );
          process.exit(1);
        }
      }
      const failed = failedChecks(r, w.case, t);
      keep(file, {
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
      });
      console.log(
        `${t.name.padEnd(8)} ${w.case.id.padEnd(15)} v${w.variant} r${rep} ${secs(r.firstTokenMs)} ${failed.length ? "FAIL " + failed.join("; ") : "ok"}`,
      );
    });
  }
}

if (arg.judge || arg["judge-only"]) {
  const judged = rowsOf(judgedFile);
  const names = new Set(targets.map((t) => t.name));
  const todo = [...rowsOf(file).values()].filter(
    (r) =>
      names.has(r.target) &&
      !r.error &&
      r.answer.trim() &&
      r.rep <= Number(arg["judge-reps"]) &&
      byCase.has(r.case) &&
      picked(byCase.get(r.case)) &&
      inSet(r.holdout) &&
      !judged.has(r.id),
  );
  const panels = new Map(targets.map((t) => [t.name, panelFor(t.maker)]));
  const budget = Number(arg["budget-usd"]);
  const floor = Number(arg["floor-usd"]);
  const providers = new Set([...panels.values()].flat().map((j) => j.provider));
  const lowest = async () => {
    for (const p of providers) {
      const usd = await balanceUsd(p);
      if (usd != null && usd < floor) return `${p} has $${usd} left`;
    }
    return null;
  };

  for (const t of targets) {
    const [a, b, c] = panels.get(t.name);
    console.log(
      `${t.name} (${t.maker}) is judged by ${nameOf(a)} and ${nameOf(b)}, with ${nameOf(c)} on a split`,
    );
  }
  console.log(
    `judging ${todo.length} answers, up to $${budget}, keeping balances above $${floor}`,
  );
  const low = await lowest();
  if (low) {
    console.error(`Not judging: ${low}, below --floor-usd ${floor}.`);
    process.exit(1);
  }

  let spent = 0;
  let count = 0;
  let stop = null;
  await pool(todo, 4, async (row) => {
    if (stop) return;
    const t = targets.find((x) => x.name === row.target);
    const { verdicts, usd } = await judge(
      row,
      byCase.get(row.case),
      t,
      panels.get(row.target),
      (call) => keep(callsFile, call),
    );
    spent += usd;
    count++;
    keep(judgedFile, {
      id: row.id,
      target: row.target,
      case: row.case,
      verdicts,
      usd,
      at: new Date().toISOString(),
    });
    const bad = Object.entries(verdicts).filter(([, v]) => v !== "PASS");
    console.log(
      `judged ${row.id.padEnd(30)} ${bad.length ? bad.map(([n, v]) => `${n} ${v}`).join("; ") : "all PASS"}`,
    );
    if (count === 8) {
      console.log(
        `about $${(spent / count).toFixed(4)} an answer: $${((spent / count) * todo.length).toFixed(2)} for all ${todo.length}`,
      );
    }
    if (spent >= budget) stop ??= `spent $${spent.toFixed(2)} of $${budget}`;
    if (count % 25 === 0) stop ??= await lowest();
  });
  console.log(
    `judging: $${spent.toFixed(3)} spent on ${count} answers${stop ? `; stopped early: ${stop}. Raise --budget-usd and rerun with --resume ${run} --judge-only` : ""}`,
  );
}

const rows = rowsOf(file);
const verdictsOf = rowsOf(judgedFile);
const pct = (xs, q) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const formNames = new Set(FORM.map(([n]) => n));
console.log(
  "\ntarget    answers  all checks  facts right  first word p50/p90  cut off  blank",
);
for (const t of targets) {
  const rs = [...rows.values()]
    .filter((r) => r.target === t.name)
    .map((r) => ({ ...r, failed: recheck(r, byCase.get(r.case), t) }));
  const clean = rs.filter((r) => !r.failed.length).length;
  const right = rs.filter(
    (r) => !r.error && !r.failed.some((f) => !formNames.has(f)),
  ).length;
  const first = rs.map((r) => r.firstTokenMs);
  console.log(
    `${t.name.padEnd(9)} ${String(rs.length).padStart(7)}  ${String(clean).padStart(10)}  ${String(right).padStart(11)}  ${secs(pct(first, 0.5))} / ${secs(pct(first, 0.9))}  ${String(rs.filter((r) => r.doneReason === "length").length).padStart(7)}  ${String(rs.filter((r) => !r.error && !r.answer.trim()).length).padStart(5)}`,
  );
  const failing = new Map();
  for (const r of rs) {
    const judgedBad = Object.entries(verdictsOf.get(r.id)?.verdicts ?? {})
      .filter(([, v]) => v === "FAIL")
      .map(([n]) => `judge: ${n}`);
    const why = [...r.failed, ...judgedBad];
    if (!why.length) continue;
    const c = failing.get(r.case) ?? { n: 0, why: new Set() };
    c.n++;
    why.forEach((f) => c.why.add(f));
    failing.set(r.case, c);
  }
  for (const [id, c] of failing) {
    const total = rs.filter((r) => r.case === id).length;
    console.log(`  ${id}: ${c.n}/${total} [${[...c.why].join("; ")}]`);
  }
  const judgedHere = rs.map((r) => verdictsOf.get(r.id)).filter(Boolean);
  if (judgedHere.length) {
    const tally = new Map();
    for (const j of judgedHere) {
      for (const [n, v] of Object.entries(j.verdicts)) {
        const x = tally.get(n) ?? { PASS: 0, FAIL: 0, UNKNOWN: 0 };
        x[v]++;
        tally.set(n, x);
      }
    }
    console.log(
      `  judged ${judgedHere.length}: ${[...tally]
        .map(([n, x]) => `${n} ${x.PASS}/${x.PASS + x.FAIL + x.UNKNOWN}`)
        .join(", ")} pass`,
    );
  }
}
console.log(`\n${file}`);
