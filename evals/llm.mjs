/** One call to any OpenAI-compatible chat API, with its cost when known. */
import { PROVIDERS } from "./models.mjs";

const prices = new Map();

/**
 * USD per token from the provider's /models list, which Poe and OpenRouter
 * give as `pricing.prompt` and `pricing.completion`. Null when it doesn't.
 */
async function priceOf(provider, model) {
  if (!prices.has(provider)) {
    prices.set(
      provider,
      fetch(`${PROVIDERS[provider].url}/models`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then(
          (j) =>
            new Map(
              (j.data ?? []).map((m) => [
                m.id,
                m.pricing?.prompt != null && m.pricing?.completion != null
                  ? {
                      in: Number(m.pricing.prompt),
                      out: Number(m.pricing.completion),
                    }
                  : null,
              ]),
            ),
        )
        .catch(() => new Map()),
    );
  }
  return (await prices.get(provider)).get(model) ?? null;
}

const keyOf = (provider) => {
  const name = PROVIDERS[provider]?.key;
  if (!name) return null;
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set`);
  return key;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chat(
  { provider, model, extra = {} },
  messages,
  { maxTokens = 2_000, temperature = 0 } = {},
) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider ${provider}`);
  const key = keyOf(provider);
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(`${p.url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...extra,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(
        after > 0 ? after * 1000 : 250 * 2 ** attempt + Math.random() * 250,
      );
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `${provider}:${model} HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const body = await res.json();
    const usage = {
      in: body.usage?.prompt_tokens ?? null,
      out: body.usage?.completion_tokens ?? null,
    };
    const price = await priceOf(provider, model);
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      usage,
      usd:
        price && usage.in != null && usage.out != null
          ? usage.in * price.in + usage.out * price.out
          : null,
      ms: Math.round(performance.now() - t0),
    };
  }
}

/** The provider's remaining balance in USD, or null if it has no such endpoint. */
export async function balanceUsd(provider) {
  const b = PROVIDERS[provider]?.balance;
  if (!b) return null;
  const key = keyOf(provider);
  const res = await fetch(b.url, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) return null;
  return Number((await res.json())[b.usd]);
}
