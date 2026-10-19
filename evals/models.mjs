/**
 * Every model the evals call, through any OpenAI-compatible API. Changing
 * provider is an entry in PROVIDERS and new names in JUDGES; no code knows
 * which provider it is talking to.
 */

/**
 * `key` names the environment variable holding the API key. `balance`, if
 * the provider has one, is read before judging so a run never spends past
 * --floor-usd.
 */
export const PROVIDERS = {
  poe: {
    url: "https://api.poe.com/v1",
    key: "POE_API_KEY",
    balance: {
      url: "https://api.poe.com/usage/current_balance",
      usd: "total_balance_usd",
    },
  },
  ollama: { url: "http://127.0.0.1:11434/v1", key: null },
};

/**
 * Fields some models need on every request, merged into the body as they
 * are. Poe's Claude bots search the web unless told not to (web_search
 * defaults to true for claude-haiku-5.5, 2026-10-19), which would let outside
 * pages into an answer or a grade.
 */
export const EXTRA = {
  "poe:claude-haiku-5.5": { web_search: false },
  "poe:claude-sonnet-5.5": { web_search: false },
};

/**
 * The judge pool, in order of preference, each from a different maker. A
 * target's panel is the first two whose maker isn't the target's; the next
 * one breaks a tie. `extra` is merged into the request body as is.
 */
export const JUDGES = [
  { provider: "poe", model: "claude-haiku-5.5" },
  { provider: "poe", model: "deepseek-v3.2" },
  { provider: "poe", model: "gpt-5-mini" },
  { provider: "poe", model: "gemini-3-flash" },
  { provider: "poe", model: "kimi-k2.6" },
];

/**
 * Who made a model, from its bare id. Poe's `owned_by` names the host, not
 * the maker (ds-v4.1-flash-1017 is "EmpirioLabs AI", 2026-10-19), so this
 * reads the name instead.
 */
const MAKERS = [
  [/^(gpt|o\d|chatgpt)/i, "openai"],
  [/^(ds-|deepseek)/i, "deepseek"],
  [/^claude/i, "anthropic"],
  [/^(gemini|gemma)/i, "google"],
  [/^qwen/i, "alibaba"],
  [/^kimi/i, "moonshot"],
  [/^glm/i, "zhipu"],
  [/^grok/i, "xai"],
  [/^(mistral|magistral|devstral)/i, "mistral"],
  [/^(llama|muse)/i, "meta"],
  [/^minimax/i, "minimax"],
];

export const makerOf = (model) =>
  MAKERS.find(([re]) => re.test(model))?.[1] ?? "unknown";

export const nameOf = (m) => `${m.provider}:${m.model}`;

/** Two judges and a tiebreaker, none made by `maker`. */
export function panelFor(maker) {
  const eligible = JUDGES.filter((j) => makerOf(j.model) !== maker);
  if (eligible.length < 3)
    throw new Error(`fewer than 3 judges not by ${maker}`);
  return eligible.slice(0, 3);
}
