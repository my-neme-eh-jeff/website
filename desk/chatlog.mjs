/**
 * Read what visitors asked the shell. Runs on the desk.
 *
 *   chatlog              the last 20 exchanges, one block each
 *   chatlog -n 50        the last 50
 *   chatlog --today      everything since local midnight
 *   chatlog --full       include earlier turns and the model's reasoning
 *   chatlog --json       raw JSON lines, for jq
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR =
  process.env.LOG_DIR ?? join(homedir(), ".local/share/portfolio-chat");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const n = Number(args[args.indexOf("-n") + 1]) || 20;

const files = (await readdir(LOG_DIR).catch(() => []))
  .filter((f) => /^chats-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
  .sort();

let entries = [];
for (const f of files) {
  const text = await readFile(join(LOG_DIR, f), "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A line cut short by a crash.
    }
  }
}

if (flag("--today")) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  entries = entries.filter((e) => new Date(e.ts) >= midnight);
} else {
  entries = entries.slice(-n);
}

if (flag("--json")) {
  for (const e of entries) console.log(JSON.stringify(e));
  process.exit(0);
}

if (entries.length === 0) {
  console.log(`No chats logged yet in ${LOG_DIR}.`);
  process.exit(0);
}

const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

for (const e of entries) {
  const when = new Date(e.ts).toLocaleString();
  const where = e.country ?? "?";
  const speed =
    e.stats?.genMs > 0
      ? `${(e.stats.tokens / (e.stats.genMs / 1000)).toFixed(1)} tok/s`
      : "";
  const head = [
    when,
    where,
    e.outcome === "ok" ? "" : e.outcome.toUpperCase(),
    `${(e.totalMs / 1000).toFixed(1)}s`,
    speed,
  ].filter(Boolean);
  console.log(dim(head.join(" · ")));
  if (flag("--full")) {
    for (const t of e.history ?? []) {
      console.log(dim(`  ${t.role === "user" ? "Q" : "A"}: ${t.content}`));
    }
  }
  console.log(bold(`Q: ${e.question}`));
  const answer = e.answer.trim() || dim("(no answer)");
  console.log(
    flag("--full") || answer.length <= 240
      ? `A: ${answer}`
      : `A: ${answer.slice(0, 240)}…`,
  );
  if (flag("--full") && e.reasoning) {
    console.log(dim(`Reasoning: ${e.reasoning.trim()}`));
  }
  console.log();
}
