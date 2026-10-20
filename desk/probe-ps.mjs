/**
 * Checks what chat-log-proxy.mjs's busy check relies on: Ollama moves a loaded
 * model's expires_at on every read while it runs the first request after a
 * load, and when a request finishes, and an idle model's stands still. Run it
 * on the desk after upgrading Ollama, while nothing else uses it:
 *
 *   node probe-ps.mjs [model]    (default qwen3:4b; unloaded afterwards)
 *
 * While it runs, the proxy sends visitors to Poe: another model is in use.
 */
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.argv[2] ?? "qwen3:4b";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function expiry() {
  const res = await fetch(`${OLLAMA}/api/ps`);
  const { models } = await res.json();
  return models.find((m) => m.name === MODEL)?.expires_at ?? null;
}

/** One generation, reading expires_at every 500ms until it ends. */
async function generate() {
  const seen = new Set();
  let done = false;
  const asked = fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      prompt: "Count from 1 to 300, one number per line.",
      stream: false,
      think: false,
      keep_alive: "5m",
      options: { num_predict: 400 },
    }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`generate: HTTP ${res.status}`);
    await res.json();
    done = true;
  });
  while (!done) {
    const e = await expiry();
    if (e) seen.add(e);
    await Promise.race([asked, wait(500)]);
  }
  await asked;
  return { during: seen, after: await expiry() };
}

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

try {
  const first = await generate();
  check(
    first.during.size >= 2,
    `expires_at moves while the first request after a load runs (${first.during.size} values)`,
  );
  const idle = await expiry();
  await wait(3000);
  check((await expiry()) === idle, "expires_at stands still while idle");
  const second = await generate();
  check(
    second.after !== idle,
    "expires_at moves when a request on a loaded model finishes",
  );
} finally {
  await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
  }).catch(() => {});
}

if (failures.length) {
  console.error(
    "\nOllama no longer moves expires_at as chat-log-proxy.mjs assumes: its busy check is wrong until that changes.",
  );
  process.exit(1);
}
console.log("\nThe proxy's busy check holds for this Ollama.");
