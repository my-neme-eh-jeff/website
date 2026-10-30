/**
 * Starts run.mjs on the box, where Ollama and the Poe key are, from a laptop:
 * copies the files it needs, starts it detached, follows its log, copies the
 * results back to tmp/evals/<run>/ and writes report.html and review.html.
 *
 *   pnpm run eval --target desk,fallback --reps 3
 *   pnpm run eval --resume <run>       after the box went down mid-run
 *   pnpm run eval --fetch <run>        only copy a run's results back
 *   pnpm run eval --publish <run>      copy it into evals/results/runs/ to commit
 *   pnpm run eval --detach ...         start it and return
 *
 * The Poe key never leaves the box: the run there reads ~/.config/llm/env.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const HOST = process.env.EVAL_HOST ?? "box";
const DIR = "portfolio-evals";
const RUNS = ".local/share/portfolio-evals/runs";
const FILES = [
  "evals",
  "src/content",
  "src/worker",
  "wrangler.jsonc",
  "package.json",
];

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value ?? "";
};
const detach = args.includes("--detach");
if (detach) args.splice(args.indexOf("--detach"), 1);
const fetchOnly = take("--fetch");
const publish = take("--publish");

// Run ids reach remote paths and a remote shell, so nothing else gets through.
const runId = (id) => {
  if (/^\d{8}T\d{6}$/.test(id ?? "")) return id;
  console.error(`not a run id: ${id}`);
  process.exit(1);
};

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const ssh = (script, opts = {}) =>
  spawnSync("ssh", [HOST, "bash", "-s"], {
    input: script,
    encoding: "utf8",
    ...opts,
  });

function fetchRun(run) {
  mkdirSync(`tmp/evals/${run}`, { recursive: true });
  execFileSync(
    "rsync",
    ["-az", `${HOST}:${RUNS}/${run}/`, `tmp/evals/${run}/`],
    { stdio: "inherit" },
  );
  try {
    execFileSync(process.execPath, ["evals/report.mjs", `tmp/evals/${run}`], {
      stdio: "inherit",
    });
  } catch (e) {
    console.error(
      `Results are in tmp/evals/${run}/, but the report failed (${e.message}). Rerun: pnpm run eval --fetch ${run}`,
    );
    process.exit(1);
  }
}

if (fetchOnly) {
  fetchRun(runId(fetchOnly));
  process.exit(0);
}

/**
 * A power cut leaves zero bytes in the box's files, and git would store them
 * as binary; the log also loses its progress bars and becomes log.txt, since
 * the repo ignores *.log.
 */
if (publish) {
  runId(publish);
  const out = `evals/results/runs/${publish}`;
  mkdirSync(out, { recursive: true });
  const read = (path) =>
    execFileSync("ssh", [HOST, "cat", path], {
      encoding: "utf8",
      // A 3-rep run of every wording holds more than the default 1 MB.
      maxBuffer: 256 * 1024 * 1024,
    }).replaceAll("\0", "");
  const ls = execFileSync("ssh", [HOST, "ls", `${RUNS}/${publish}`], {
    encoding: "utf8",
  });
  for (const f of [
    "meta.json",
    "answers.jsonl",
    "judgments.jsonl",
    "calls.jsonl",
  ])
    if (ls.split("\n").includes(f))
      writeFileSync(`${out}/${f}`, read(`${RUNS}/${publish}/${f}`));
  writeFileSync(
    `${out}/log.txt`,
    read(`${RUNS}/${publish}.log`)
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/\r(?!\n)/g, "\n")
      .replace(/\n{2,}/g, "\n"),
  );
  console.log(
    `${out}/\nCheck it before committing: node evals/check-results.mjs`,
  );
  process.exit(0);
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const sha =
  git("rev-parse", "--short", "HEAD") +
  (git("status", "--porcelain", "--", ...FILES) ? "-dirty" : "");
const resume = args[args.indexOf("--resume") + 1];
const run = args.includes("--resume")
  ? runId(resume)
  : new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

execFileSync(
  "rsync",
  ["-az", "--delete", "--relative", ...FILES, `${HOST}:${DIR}/`],
  { stdio: "inherit" },
);

const started = ssh(
  [
    "set -e",
    `mkdir -p ~/${RUNS}`,
    `cd ~/${DIR}`,
    "set -a; . ~/.config/llm/env; set +a",
    "node=$(ls -d ~/.config/nvm/versions/node/v*/bin/node | sort -V | tail -1)",
    `size=$(stat -c %s ~/${RUNS}/${q(run)}.log 2>/dev/null || echo 0)`,
    `EVAL_OUT=~/${RUNS} nohup setsid "$node" evals/run.mjs --sha ${q(sha)} ${
      args.includes("--resume") ? "" : `--run ${q(run)}`
    } ${args.map(q).join(" ")} >> ~/${RUNS}/${q(run)}.log 2>&1 < /dev/null &`,
    "echo $! $size",
  ].join("\n"),
);
if (started.status !== 0) {
  console.error(started.stderr);
  process.exit(1);
}
const [pid, size] = started.stdout.trim().split(" ");
console.log(`run ${run} started on ${HOST} (pid ${pid}) at ${sha}`);
if (detach) {
  console.log(
    `Follow: ssh ${HOST} tail -f ${RUNS}/${run}.log\nFetch: pnpm run eval --fetch ${run}`,
  );
  process.exit(0);
}

ssh(`tail -c +${Number(size) + 1} --pid=${q(pid)} -f ~/${RUNS}/${q(run)}.log`, {
  stdio: ["pipe", "inherit", "inherit"],
});
fetchRun(run);
