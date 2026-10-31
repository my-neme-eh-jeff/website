type Storage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
};

type Today = { day: string; used: number };

/**
 * Poe answers given today (UTC), one count for every Cloudflare location: a
 * ratelimit binding counts per location. A Durable Object's input gate holds
 * other requests while its storage call runs, so get-then-put can't race
 * (developers.cloudflare.com/durable-objects, read 2026-10-31).
 */
export class PoeBudget {
  storage: Storage;

  constructor(state: { storage: Storage }) {
    this.storage = state.storage;
  }

  /** `?cap=n`: 204 with one more answer counted, or 429 once n are used. */
  async fetch(request: Request): Promise<Response> {
    const cap = Number(new URL(request.url).searchParams.get("cap"));
    const day = new Date().toISOString().slice(0, 10);
    const today = await this.storage.get<Today>("today");
    const used = today?.day === day ? today.used : 0;
    // A cap that isn't a number refuses everything.
    if (!(used < cap)) return new Response(null, { status: 429 });
    await this.storage.put("today", { day, used: used + 1 });
    return new Response(null, { status: 204 });
  }
}
