/**
 * Turns a run's results into two local pages next to them:
 *
 *   report.html   pass rates with 95% intervals, per target, kind and case,
 *                 and every failing answer with the judges' reasons
 *   review.html   every answer, one at a time, to mark pass or fail with a
 *                 note (keys: p, f, s, n, j, k), exported as labels.json
 *
 *   node evals/report.mjs tmp/evals/<run> [more run dirs for review.html]
 *
 * With --compare <before> <after> it writes compare.html in the second run
 * instead: both runs' numbers over the wordings judged in both, and their
 * answers side by side, for telling whether a prompt change helped.
 *
 * With --board <run>... it writes board.html next to the runs: every target
 * of every run in one table, over the wordings judged in all of them, each
 * counted once, ranked by the share that are accurate.
 *
 * box.mjs runs this after copying a run back.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CASES } from "./cases.mjs";
import { FORM, recheck } from "./checks.mjs";

const argv = process.argv.slice(2);
const mode = ["--compare", "--board"].includes(argv[0]) ? argv[0] : null;
const dirs = mode ? argv.slice(1) : argv;
if (!dirs.length || (mode === "--compare" && dirs.length !== 2)) {
  console.error(
    "usage: node evals/report.mjs <run dir> [<run dir>...]\n       node evals/report.mjs --compare <before run dir> <after run dir>\n       node evals/report.mjs --board <run dir>...",
  );
  process.exit(1);
}

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
const callsOf = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        })
    : [];

const byCase = new Map(CASES.map((c) => [c.id, c]));

function load(dir) {
  const meta = existsSync(join(dir, "meta.json"))
    ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))
    : { run: dir };
  const verdicts = rowsOf(join(dir, "judgments.jsonl"));
  const calls = callsOf(join(dir, "calls.jsonl"));
  const onDesk = (name) =>
    meta.targets?.[name]?.onDesk ?? /^desk(:|$)/.test(name);
  const answers = [...rowsOf(join(dir, "answers.jsonl")).values()].map((a) => ({
    ...a,
    failed: recheck(a, byCase.get(a.case), { onDesk: onDesk(a.target) }),
    run: meta.run,
    verdicts: verdicts.get(a.id)?.verdicts ?? null,
    reasons: calls
      .filter((c) => c.id === a.id)
      .flatMap((c) =>
        Object.entries(c.votes)
          .filter(([, v]) => v.v !== "PASS")
          .map(([n, v]) => ({ judge: c.judge, name: n, v: v.v, why: v.why })),
      ),
  }));
  const usd = calls.reduce((s, c) => s + (c.usd ?? 0), 0);
  return { dir, meta, answers, usd };
}

const runs = dirs.map(load);
const [main] = runs;

/** 95% Wilson interval for k of n. */
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const judgedFails = (a) =>
  Object.entries(a.verdicts ?? {})
    .filter(([, v]) => v === "FAIL")
    .map(([n]) => `judge: ${n}`);
const problems = (a) => [...a.failed, ...judgedFails(a)];
const ok = (a) => !a.error && problems(a).length === 0;
/** Judged, or blank: a blank answer is never sent to the judges, but it is wrong. */
const graded = (a) => !a.error && (a.verdicts != null || !a.answer?.trim());

/**
 * Accurate: the facts and the behaviour are right. Leaves out how the answer
 * is laid out (length, markdown, the follow-up line) and the judges'
 * `suggestions`, but keeps an invented URL and a missing or cut-off answer.
 */
const LAYOUT = new Set(
  FORM.map(([n]) => n).filter(
    (n) => !["not cut off", "has an answer", "known URLs only"].includes(n),
  ),
);
const SUBSTANCE = ["grounded", "behaves", "covers", "in-role"];
const accurate = (a) =>
  !a.error &&
  !a.failed.some((n) => !LAYOUT.has(n)) &&
  !SUBSTANCE.some((n) => a.verdicts?.[n] === "FAIL");

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const pct = (x) => `${Math.round(x * 100)}%`;
const rate = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return n
    ? `<b>${Number.isInteger(k) ? k : k.toFixed(1)}/${n}</b> <span class="dim">${pct(k / n)} (${pct(lo)}–${pct(hi)})</span>`
    : "—";
};

function percentile(xs, q) {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
}
const secs = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);

const STYLE = `
:root{--bg:#fbfaf7;--fg:#1d1c1a;--dim:#6b6760;--line:#e3dfd6;--bad:#b3261e;--good:#1e6b3a;--card:#fff;--accent:#2f5d8a}
@media (prefers-color-scheme:dark){:root{--bg:#141412;--fg:#ecebe6;--dim:#a19d94;--line:#2c2b27;--bad:#f2766b;--good:#6fcf8f;--card:#1c1b19;--accent:#8ab4e0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}
.dim{color:var(--dim)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-weight:600}.bad{color:var(--bad)}.good{color:var(--good)}code,pre{font:13px/1.45 ui-monospace,monospace}
pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;margin:6px 0}
details{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0;background:var(--card)}summary{cursor:pointer}
.wrap{overflow-x:auto}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:700px){.cols{grid-template-columns:1fr}}h3{font-size:14px;margin:8px 0 0}`;

function reportPage({ meta, answers, usd }) {
  const targets = [...new Set(answers.map((a) => a.target))];
  const crit = [
    ...new Set(answers.flatMap((a) => Object.keys(a.verdicts ?? {}))),
  ];
  const head = Object.entries(meta.targets ?? {})
    .map(
      ([t, m]) =>
        `<li><b>${esc(t)}</b>: ${esc(m.model)} (${esc(m.maker)}), prompt ${esc(m.prompt?.full)} · rules ${esc(m.prompt?.rules)} · facts ${esc(m.prompt?.facts)}</li>`,
    )
    .join("");

  const summary = targets
    .map((t) => {
      const as = answers.filter((a) => a.target === t && !a.error);
      const judged = as.filter(graded);
      const cells = crit
        .map((n) => {
          const js = judged.filter((a) => a.verdicts?.[n] !== undefined);
          return `<td>${rate(js.filter((a) => a.verdicts[n] === "PASS").length, js.length)}</td>`;
        })
        .join("");
      return `<tr><th>${esc(t)}</th><td>${rate(as.filter((a) => !a.failed.length).length, as.length)}</td>${cells}<td>${rate(judged.filter(accurate).length, judged.length)}</td><td>${rate(judged.filter(ok).length, judged.length)}</td><td>${secs(
        percentile(
          as.map((a) => a.firstTokenMs),
          0.5,
        ),
      )} / ${secs(
        percentile(
          as.map((a) => a.firstTokenMs),
          0.9,
        ),
      )}</td></tr>`;
    })
    .join("");

  const kinds = [...new Set(answers.map((a) => a.kind))];
  const byKind = kinds
    .map(
      (k) =>
        `<tr><th>${esc(k)}</th>${targets
          .map((t) => {
            const as = answers.filter(
              (a) => a.target === t && a.kind === k && graded(a),
            );
            return `<td>${rate(as.filter(ok).length, as.length)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");

  const caseRows = [...new Set(answers.map((a) => a.case))]
    .map((id) => {
      const cells = targets
        .map((t) => {
          const as = answers.filter(
            (a) => a.target === t && a.case === id && !a.error,
          );
          const good = as.filter(ok).length;
          const why = [...new Set(as.flatMap(problems))];
          return `<td class="${good === as.length ? "good" : "bad"}">${as.length ? `${good}/${as.length}` : "—"}${why.length ? ` <span class="dim">${esc(why.join("; "))}</span>` : ""}</td>`;
        })
        .join("");
      return `<tr><th>${esc(id)} <span class="dim">${esc(byCase.get(id)?.kind ?? "")}</span></th>${cells}</tr>`;
    })
    .join("");

  const failing = answers
    .filter((a) => !ok(a))
    .map(
      (
        a,
      ) => `<details><summary><b>${esc(a.target)}</b> ${esc(a.case)} v${a.variant} r${a.rep}: <span class="bad">${esc(a.error ?? problems(a).join("; "))}</span></summary>
<pre>${esc(a.turns.map((t) => `${t.role === "user" ? "Q" : "A"}: ${t.content}`).join("\n"))}</pre>
<pre>${esc(a.answer || "(no answer)")}</pre>
<p class="dim">Suggested: ${esc(a.next.join(" · ") || "none")}</p>
${a.raw ? `<details><summary class="dim">What the model wrote, before the site's parsing</summary><pre>${esc(a.raw)}</pre></details>` : ""}
${a.reasons.length ? `<ul>${a.reasons.map((r) => `<li><b>${esc(r.name)}</b> ${esc(r.v)} <span class="dim">(${esc(r.judge)})</span>: ${esc(r.why)}</li>`).join("")}</ul>` : ""}</details>`,
    )
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eval ${esc(meta.run)}</title><style>${STYLE}</style></head><body><main>
<h1>Eval run ${esc(meta.run)}</h1>
<p class="dim">${esc(meta.started ?? "")} · commit ${esc(meta.sha ?? "?")} · Ollama ${esc(meta.ollama ?? "—")} · judges spent $${usd.toFixed(3)}</p>
<ul>${head}</ul>
<p class="dim">Intervals are 95% Wilson, treating answers as independent; wordings of one question are not, so read them as a floor on the uncertainty. A blank answer is never sent to the judges; the judged columns count it as wrong.</p>
<h2>By target</h2><div class="wrap"><table><tr><th></th><th>code checks</th>${crit.map((n) => `<th>judge: ${esc(n)}</th>`).join("")}<th>accurate</th><th>judged and all right</th><th>first word p50 / p90</th></tr>${summary}</table></div>
<h2>Judged answers, by kind</h2><div class="wrap"><table><tr><th></th>${targets.map((t) => `<th>${esc(t)}</th>`).join("")}</tr>${byKind}</table></div>
<h2>By case</h2><p class="dim">Answers with no problem, of all answers; judged criteria count only where judged.</p><div class="wrap"><table><tr><th></th>${targets.map((t) => `<th>${esc(t)}</th>`).join("")}</tr>${caseRows}</table></div>
<h2>Every answer with a problem</h2>${failing || "<p>None.</p>"}
</main></body></html>`;
}

function comparePage(before, after) {
  const key = (a) => `${a.target}|${a.case}|${a.variant}`;
  const inBoth = (pick) => {
    const [b, a] = [before, after].map((run) => run.answers.filter(pick));
    const keys = new Set(b.map(key));
    const shared = new Set(a.map(key).filter((k) => keys.has(k)));
    return [b, a].map((xs) => xs.filter((x) => shared.has(key(x))));
  };
  const [CB, CA] = inBoth((a) => !a.error);
  const [B, A] = inBoth(graded);
  const targets = [...new Set(CA.map((a) => a.target))];
  const crit = [
    ...new Set([...B, ...A].flatMap((a) => Object.keys(a.verdicts ?? {}))),
  ];
  const of = (xs, t, id) =>
    xs.filter((a) => a.target === t && (id === undefined || a.case === id));
  const everyTime = (xs) => {
    const groups = [...Map.groupBy(xs, key).values()];
    return rate(groups.filter((g) => g.every(ok)).length, groups.length);
  };
  const line = (label, f, [xb, xa] = [B, A]) =>
    `<tr><th>${label}</th>${targets.map((t) => `<td>${f(of(xb, t))}</td><td>${f(of(xa, t))}</td>`).join("")}</tr>`;
  const numbers = [
    line(
      "code checks",
      (xs) => rate(xs.filter((a) => !a.failed.length).length, xs.length),
      [CB, CA],
    ),
    ...crit.map((n) =>
      line(`judge: ${esc(n)}`, (xs) => {
        const js = xs.filter((a) => a.verdicts?.[n] !== undefined);
        return rate(
          js.filter((a) => a.verdicts[n] === "PASS").length,
          js.length,
        );
      }),
    ),
    line("accurate", (xs) => rate(xs.filter(accurate).length, xs.length)),
    line("judged and all right", (xs) => rate(xs.filter(ok).length, xs.length)),
    line("wordings right every time", everyTime),
  ].join("");

  /** Judged answers where both runs have them, else every answer, by its checks. */
  const pairOf = (t, id) => {
    const judged = [of(B, t, id), of(A, t, id)];
    return judged.every((xs) => xs.length)
      ? { judged: true, b: judged[0], a: judged[1] }
      : { judged: false, b: of(CB, t, id), a: of(CA, t, id) };
  };
  const score = (xs) => (xs.length ? xs.filter(ok).length / xs.length : null);
  const tally = ({ b, a }) =>
    `${b.filter(ok).length}/${b.length} → ${a.filter(ok).length}/${a.length}`;
  const cases = [...new Set(CA.map((a) => a.case))];
  const caseRows = cases
    .map(
      (id) =>
        `<tr><th>${esc(id)} <span class="dim">${esc(byCase.get(id)?.kind ?? "")}</span></th>${targets
          .map((t) => {
            const p = pairOf(t, id);
            const [sb, sa] = [score(p.b), score(p.a)];
            const cls =
              sb == null || sa == null
                ? ""
                : sa > sb
                  ? "good"
                  : sa < sb
                    ? "bad"
                    : "";
            return `<td class="${cls}">${p.a.length ? tally(p) : "—"}${p.judged ? "" : ' <span class="dim">checks only</span>'}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");

  const verdict = (a) =>
    !a.verdicts && !a.failed.length
      ? "checks passed, not judged"
      : ok(a)
        ? "all right"
        : `<span class="bad">${esc(problems(a).join("; "))}</span>`;
  const shown = (a) =>
    `<pre>${esc(a.answer)}</pre><p class="dim">${verdict(a)} · suggested: ${esc(a.next.join(" · ") || "none")}</p>`;
  const byRep = (xs, v) =>
    xs.filter((a) => a.variant === v).sort((x, y) => x.rep - y.rep);
  const answers = targets
    .flatMap((t) =>
      cases.map((id) => {
        const p = pairOf(t, id);
        if (!p.a.length) return "";
        const changed = score(p.a) !== score(p.b);
        return `<details${changed ? " open" : ""}><summary><b>${esc(t)}</b> ${esc(id)}: ${tally(p)}${p.judged ? "" : " (checks only)"}</summary>${[
          ...new Set(p.a.map((x) => x.variant)),
        ]
          .map(
            (v) =>
              `<pre>${esc(
                byRep(p.a, v)[0]
                  .turns.map(
                    (u) => `${u.role === "user" ? "Q" : "A"}: ${u.content}`,
                  )
                  .join("\n"),
              )}</pre><div class="cols"><div><h3>before</h3>${byRep(p.b, v).map(shown).join("")}</div><div><h3>after</h3>${byRep(p.a, v).map(shown).join("")}</div></div>`,
          )
          .join("")}</details>`;
      }),
    )
    .join("");

  const prompt = (run, t) => run.meta.targets?.[t]?.prompt?.full ?? "?";
  const heads = targets
    .map(
      (t) =>
        `<li><b>${esc(t)}</b>: prompt ${esc(prompt(before, t))} → ${esc(prompt(after, t))}${prompt(before, t) === prompt(after, t) ? " (the same prompt, so any difference is noise)" : ""}</li>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compare ${esc(before.meta.run)} and ${esc(after.meta.run)}</title><style>${STYLE}</style></head><body><main>
<h1>Before and after</h1>
<p class="dim">Before: run ${esc(before.meta.run)}, commit ${esc(before.meta.sha ?? "?")} · After: run ${esc(after.meta.run)}, commit ${esc(after.meta.sha ?? "?")}</p>
<ul>${heads}</ul>
<p class="dim">Code checks count the ${CB.length} answers before and ${CA.length} after to wordings both runs asked; the judges' rows count the ${B.length} and ${A.length} judged in both, a blank answer counting as judged and wrong. Intervals are 95% Wilson. "Wordings right every time" counts a wording only if every judged answer to it was all right.</p>
<h2>Numbers</h2><div class="wrap"><table><tr><th></th>${targets.map((t) => `<th>${esc(t)} before</th><th>${esc(t)} after</th>`).join("")}</tr>${numbers}</table></div>
<h2>By case</h2><p class="dim">Judged and all right where both runs judged the case, else code checks.</p><div class="wrap"><table><tr><th></th>${targets.map((t) => `<th>${esc(t)}</th>`).join("")}</tr>${caseRows}</table></div>
<h2>Answers</h2><p class="dim">Open where the share right changed.</p>${answers}
</main></body></html>`;
}

/**
 * Judged answers first, so marks can be held against the judges', then the
 * rest; each part in an order fixed by a hash of the id, so the first marks
 * are a spread of targets and kinds rather than one target's first cases.
 */
const reviewOrder = (all) => {
  const h = (a) =>
    createHash("sha256").update(`${a.run}|${a.id}`).digest("hex");
  return all
    .map((a) => ({ a, k: `${a.verdicts ? 0 : 1}${h(a)}` }))
    .sort((x, y) => (x.k < y.k ? -1 : 1))
    .map(({ a }) => a);
};

function boardPage(runs) {
  const entries = runs.flatMap((run) =>
    [...new Set(run.answers.map((a) => a.target))].map((target) => ({
      run,
      target,
      answers: run.answers.filter((a) => a.target === target && !a.error),
    })),
  );
  const wording = (a) => `${a.case}|${a.variant}`;
  const gradedIn = entries.map(
    (e) => new Set(e.answers.filter(graded).map(wording)),
  );
  const shared = new Set(
    [...gradedIn[0]].filter((k) => gradedIn.every((set) => set.has(k))),
  );
  // Each wording counts once, however many times a run asked it.
  const share = (xs, pass) => {
    const by = Map.groupBy(xs, wording);
    let k = 0;
    for (const g of by.values()) k += g.filter(pass).length / g.length;
    return [k, by.size];
  };
  const crit = [
    ...new Set(
      entries.flatMap((e) =>
        e.answers.flatMap((a) => Object.keys(a.verdicts ?? {})),
      ),
    ),
  ];
  const rows = entries
    .map((e) => {
      const all = e.answers.filter((a) => shared.has(wording(a)));
      const judged = all.filter(graded);
      const [k, n] = share(judged, accurate);
      return { e, all, judged, score: n ? k / n : 0 };
    })
    .sort((x, y) => y.score - x.score);
  const setting = ({ run }) =>
    [
      run.meta.args?.think ? `think ${run.meta.args.think}` : "",
      run.meta.args?.extra && run.meta.args.extra !== "{}"
        ? run.meta.args.extra
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || "production settings";
  const median = (xs) => percentile(xs, 0.5);
  const body = rows
    .map(({ e, all, judged }) => {
      const t = e.run.meta.targets?.[e.target] ?? {};
      const tok = median(all.map((a) => a.tokPerSec));
      return `<tr><th>${esc(e.target)} <span class="dim">${esc(t.model ?? "")}</span><br><span class="dim">run ${esc(e.run.meta.run)} · ${esc(setting(e))} · prompt ${esc(t.prompt?.full ?? "?")}</span></th><td>${rate(...share(judged, accurate))}</td><td>${rate(...share(judged, ok))}</td>${crit
        .map((n) => {
          const js = judged.filter((a) => a.verdicts?.[n] !== undefined);
          return `<td>${rate(...share(js, (a) => a.verdicts[n] === "PASS"))}</td>`;
        })
        .join(
          "",
        )}<td>${rate(...share(all, (a) => !a.failed.length))}</td><td>${secs(median(all.map((a) => a.firstTokenMs)))} / ${secs(median(all.map((a) => a.totalMs)))}</td><td>${tok == null ? "—" : tok.toFixed(1)}</td></tr>`;
    })
    .join("");
  const prompts = new Set(
    entries.map((e) => e.run.meta.targets?.[e.target]?.prompt?.rules),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Model board</title><style>${STYLE}</style></head><body><main>
<h1>Model board</h1>
<p class="dim">Ranked by accurate: facts and behaviour right, by code checks and the judges' grounded, behaves, covers and in-role, leaving out layout and suggested questions. A blank answer counts as judged and wrong. Every row counts the same ${shared.size} wordings, those judged in all ${entries.length} rows, each once however many times a run asked it. Intervals are 95% Wilson.${prompts.size > 1 ? " The rows were not all asked with the same rules, so prompt and model differences are mixed." : ""}</p>
<div class="wrap"><table><tr><th></th><th>accurate</th><th>judged and all right</th>${crit.map((n) => `<th>judge: ${esc(n)}</th>`).join("")}<th>code checks</th><th>first word / whole answer, p50</th><th>tok/s p50</th></tr>${body}</table></div>
</main></body></html>`;
}

function reviewPage(all) {
  const items = reviewOrder(all).map((a) => {
    const c = byCase.get(a.case);
    return {
      id: `${a.run}|${a.id}`,
      target: a.target,
      model: a.model,
      case: a.case,
      kind: a.kind,
      turns: a.turns,
      answer: a.answer,
      next: a.next,
      expect: c?.expect ?? null,
      points: c?.points ?? [],
      draft: c?.draft ?? null,
      checks: a.error ? [a.error] : problems(a),
    };
  });
  const data = JSON.stringify(items).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review answers</title><style>${STYLE}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:12px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button[aria-pressed="true"]{outline:2px solid var(--accent)}textarea{width:100%;min-height:64px;font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.answer{white-space:pre-wrap;font-size:16px}label{font-weight:600}</style></head><body><main>
<h1>Review answers</h1>
<p class="dim">Mark each answer as you'd judge it, with a one-line note on what's wrong. Keys: <kbd>p</kbd> pass, <kbd>f</kbd> fail, <kbd>s</kbd> skip, <kbd>n</kbd> note, <kbd>j</kbd>/<kbd>k</kbd> next and back. Marks stay in this browser until you export them.</p>
<div class="row"><span id="progress" aria-live="polite"></span><button id="export" type="button">Export labels.json</button><label><input type="checkbox" id="unmarked"> Unmarked only</label><label><input type="checkbox" id="show"> Show model and checks</label></div>
<div class="card"><p class="dim" id="where"></p><div id="convo"></div><p><label>Answer</label></p><div class="answer" id="answer"></div><p class="dim" id="next"></p>
<details><summary>What a good answer holds</summary><div id="ref"></div></details>
<div id="checks" hidden></div>
<div class="row" role="group" aria-label="Mark"><button id="pass" type="button" aria-pressed="false">Pass (p)</button><button id="fail" type="button" aria-pressed="false">Fail (f)</button><button id="skip" type="button">Skip (s)</button><button id="prev" type="button">Back (k)</button><button id="fwd" type="button">Next (j)</button></div>
<p><label for="note">Note</label></p><textarea id="note" placeholder="What's wrong, in a line"></textarea></div>
<script type="application/json" id="data">${data}</script>
<script>
const items = JSON.parse(document.getElementById("data").textContent);
const KEY = "eval-labels";
let labels = {};
try { labels = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(labels)); } catch {} };
let i = 0;
const $ = (id) => document.getElementById(id);
const text = (el, s) => { el.textContent = s; };
function visible() { return $("unmarked").checked ? items.filter((x) => !labels[x.id]) : items; }
function show() {
  const list = visible();
  if (!list.length) { text($("where"), "Nothing left to mark."); return; }
  i = Math.max(0, Math.min(i, list.length - 1));
  const it = list[i];
  const l = labels[it.id] || {};
  text($("where"), it.case + " · " + it.kind);
  $("convo").replaceChildren(...it.turns.map((t) => { const p = document.createElement("p"); p.textContent = (t.role === "user" ? "Visitor: " : "Assistant: ") + t.content; if (t.role !== "user") p.className = "dim"; return p; }));
  text($("answer"), it.answer || "(no answer)");
  text($("next"), "Suggested next: " + (it.next.join(" · ") || "none"));
  const ref = [];
  if (it.expect) ref.push("Expected: " + it.expect);
  if (it.points.length) ref.push("Points: " + it.points.join(" · "));
  if (it.draft) ref.push("Draft answer: " + it.draft);
  $("ref").replaceChildren(...ref.map((s) => { const p = document.createElement("p"); p.textContent = s; return p; }));
  $("checks").hidden = !$("show").checked;
  text($("checks"), it.target + " (" + it.model + ") · " + (it.checks.length ? "Checks failed: " + it.checks.join("; ") : "Checks: all passed"));
  $("pass").setAttribute("aria-pressed", String(l.label === "pass"));
  $("fail").setAttribute("aria-pressed", String(l.label === "fail"));
  $("note").value = l.note || "";
  const marked = items.filter((x) => labels[x.id]).length;
  text($("progress"), (i + 1) + " of " + list.length + " shown · " + marked + " of " + items.length + " marked");
}
function mark(label) {
  const it = visible()[i]; if (!it) return;
  labels[it.id] = { label, note: $("note").value.trim(), at: new Date().toISOString() };
  save();
  if (!$("unmarked").checked) i++;
  show();
}
$("pass").onclick = () => mark("pass");
$("fail").onclick = () => mark("fail");
$("skip").onclick = () => { i++; show(); };
$("fwd").onclick = () => { i++; show(); };
$("prev").onclick = () => { i--; show(); };
$("unmarked").onchange = () => { i = 0; show(); };
$("show").onchange = show;
$("note").oninput = () => { const it = visible()[i]; if (it && labels[it.id]) { labels[it.id].note = $("note").value.trim(); save(); } };
$("export").onclick = () => {
  const out = items.filter((x) => labels[x.id]).map((x) => ({ id: x.id, case: x.case, target: x.target, ...labels[x.id] }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
  a.download = "labels.json"; a.click();
};
document.addEventListener("keydown", (e) => {
  if (e.target === $("note")) { if (e.key === "Escape") $("note").blur(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "p") mark("pass"); else if (k === "f") mark("fail"); else if (k === "s" || k === "j") { i++; show(); }
  else if (k === "k") { i--; show(); } else if (k === "n") { e.preventDefault(); $("note").focus(); }
});
show();
</script></main></body></html>`;
}

if (mode === "--compare") {
  const out = join(runs[1].dir, "compare.html");
  writeFileSync(out, comparePage(runs[0], runs[1]));
  console.log(out);
} else if (mode === "--board") {
  const out = join(dirname(runs[0].dir), "board.html");
  writeFileSync(out, boardPage(runs));
  console.log(out);
} else {
  writeFileSync(join(main.dir, "report.html"), reportPage(main));
  writeFileSync(
    join(main.dir, "review.html"),
    reviewPage(runs.flatMap((r) => r.answers.filter((a) => !a.error))),
  );
  console.log(
    `${join(main.dir, "report.html")}\n${join(main.dir, "review.html")}`,
  );
}
