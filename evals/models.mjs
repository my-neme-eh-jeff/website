/**
 * Who made a model, from its bare id. Poe's `owned_by` names the host, not
 * the maker (ds-v4.1-flash-1017 is "EmpirioLabs AI", 2026-10-19), so this
 * reads the name instead. A judge never grades its own maker's answers.
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
