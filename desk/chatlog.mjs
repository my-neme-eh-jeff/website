/**
 * Read what visitors asked the shell. Runs on the desk.
 *
 *   chatlog              the last 20 exchanges, one block each
 *   chatlog -n 50        the last 50
 *   chatlog --today      everything since local midnight
 *   chatlog --full       include earlier turns and the model's reasoning
 *   chatlog --json       the lines as stored, for jq: OTLP/JSON traces, or
 *                        the proxy's own format before 2026-10-22
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR =
  process.env.LOG_DIR ?? join(homedir(), ".local/share/portfolio-chat");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const n = Number(args[args.indexOf("-n") + 1]) || 20;

const files = (await readdir(LOG_DIR).catch(() => [])).filter((f) =>
  /^(?:chats|traces)-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f),
);

/** An OTLP/JSON AnyValue as plain JSON. */
const plain = (v) =>
  v.arrayValue
    ? (v.arrayValue.values ?? []).map(plain)
    : v.kvlistValue
      ? Object.fromEntries(
          (v.kvlistValue.values ?? []).map((a) => [a.key, plain(a.value)]),
        )
      : "intValue" in v
        ? Number(v.intValue)
        : (v.stringValue ?? v.doubleValue ?? v.boolValue ?? null);

const text = (message, type = "text") =>
  (message?.parts ?? [])
    .filter((p) => p.type === type)
    .map((p) => p.content)
    .join("");

/** A trace, as the fields the proxy logged before traces. */
function fromTrace(o) {
  const spans = o.resourceSpans.flatMap((r) =>
    r.scopeSpans.flatMap((s) => s.spans),
  );
  const a = Object.fromEntries(
    spans.flatMap((s) => s.attributes.map((x) => [x.key, plain(x.value)])),
  );
  const [http] = spans;
  const ms = (ns) => Number(BigInt(ns) / 1_000_000n);
  const turns = (a["gen_ai.input.messages"] ?? [])
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: text(m) }));
  const [out] = a["gen_ai.output.messages"] ?? [];
  return {
    ts: new Date(ms(http.startTimeUnixNano)).toISOString(),
    country: a["geo.country.iso_code"] ?? null,
    question: turns.at(-1)?.content ?? "",
    history: turns.slice(0, -1),
    answer: text(out),
    reasoning: text(out, "reasoning"),
    outcome: a["desk.outcome"],
    totalMs: ms(http.endTimeUnixNano) - ms(http.startTimeUnixNano),
    stats: {
      tokens: a["gen_ai.usage.output_tokens"] ?? 0,
      genMs: (a["ollama.eval_duration"] ?? 0) * 1000,
    },
  };
}

let entries = [];
for (const f of files) {
  const lines = (await readFile(join(LOG_DIR, f), "utf8")).split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      entries.push({ ...(o.resourceSpans ? fromTrace(o) : o), line });
    } catch {
      // A line cut short by a crash.
    }
  }
}
entries.sort((x, y) => x.ts.localeCompare(y.ts));

if (flag("--today")) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  entries = entries.filter((e) => new Date(e.ts) >= midnight);
} else {
  entries = entries.slice(-n);
}

if (flag("--json")) {
  for (const e of entries) console.log(e.line);
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
