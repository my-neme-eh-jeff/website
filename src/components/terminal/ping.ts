import { profile } from "~/content/profile";
import type { Line } from "./commands";

/**
 * `ping desk` and `traceroute desk`. The desk's hop is a GET of `/api/ping`,
 * which the Worker times through the tunnel; the edge's is Cloudflare's own
 * `/cdn-cgi/trace`, which never runs the Worker.
 */
export type Probe = {
  say: (lines: Line[]) => void;
  /** A pulse on the drawn cable: up to the PC, or back down from it. */
  pulse: (dir: "up" | "down") => void;
  signal: AbortSignal;
};

type Pong =
  | { ok: true; up: boolean; colo: string; deskMs: number | null; ms: number }
  | { ok: false; code: "rate_limited" | "offline" | "aborted" };

// Module scope, as chat.ts's: Ctrl+C and `clear` stop a probe.
let inflight: AbortController | null = null;

export function abortProbe(): boolean {
  if (!inflight) return false;
  inflight.abort();
  inflight = null;
  return true;
}

export function startProbe(): AbortController {
  abortProbe();
  inflight = new AbortController();
  return inflight;
}

export function endProbe(controller: AbortController) {
  if (inflight === controller) inflight = null;
}

const out = (text: string): Line => ({ kind: "out", text });
const err = (text: string): Line => ({ kind: "err", text });

const WHERE = `Aman's PC at home, ${profile.city}`;

/** The edge cities a visitor is most likely to land on, by IATA code. */
const CITY: Record<string, string> = {
  AMS: "Amsterdam",
  BLR: "Bangalore",
  BOM: "Mumbai",
  CCU: "Kolkata",
  CDG: "Paris",
  DEL: "Delhi",
  DFW: "Dallas",
  DXB: "Dubai",
  EWR: "Newark",
  FRA: "Frankfurt",
  HKG: "Hong Kong",
  HYD: "Hyderabad",
  IAD: "Ashburn",
  LAX: "Los Angeles",
  LHR: "London",
  MAA: "Chennai",
  NRT: "Tokyo",
  ORD: "Chicago",
  SEA: "Seattle",
  SIN: "Singapore",
  SJC: "San Jose",
  SYD: "Sydney",
  YYZ: "Toronto",
};

const edge = (colo: string) =>
  colo ? `${colo}${CITY[colo] ? ` (${CITY[colo]})` : ""}` : "Cloudflare";

const ms = (n: number) => `${Math.max(1, Math.round(n))} ms`;

const pause = (n: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const t = setTimeout(done, n);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      done();
    });
  });

async function pong(signal: AbortSignal): Promise<Pong> {
  const t0 = performance.now();
  try {
    const res = await fetch("/api/ping", { cache: "no-store", signal });
    const took = performance.now() - t0;
    if (res.status === 429) return { ok: false, code: "rate_limited" };
    if (!res.ok) return { ok: false, code: "offline" };
    const body = (await res.json()) as {
      up?: unknown;
      colo?: unknown;
      deskMs?: unknown;
    };
    return {
      ok: true,
      up: body.up === true,
      colo: typeof body.colo === "string" ? body.colo : "",
      deskMs: typeof body.deskMs === "number" ? body.deskMs : null,
      ms: took,
    };
  } catch {
    return { ok: false, code: signal.aborted ? "aborted" : "offline" };
  }
}

function failed(code: "rate_limited" | "offline" | "aborted"): Line[] {
  if (code === "aborted") return [];
  return [
    err(
      code === "rate_limited"
        ? "Too many from your network. Try again in a minute."
        : "Nothing answered for the desk: this page may be offline.",
    ),
  ];
}

export async function pingDesk({ say, pulse, signal }: Probe, count = 3) {
  say([out(`PING desk (${WHERE}) through Cloudflare`)]);
  const times: number[] = [];
  let sent = 0;
  for (let seq = 1; seq <= count && !signal.aborted; seq++) {
    const t0 = performance.now();
    sent++;
    pulse("up");
    const r = await pong(signal);
    if (!r.ok) {
      say(failed(r.code));
      return;
    }
    if (r.up) {
      pulse("down");
      times.push(r.ms);
      say([
        out(`reply from desk via ${edge(r.colo)}: seq=${seq} time=${ms(r.ms)}`),
      ]);
    } else {
      say([out(`seq=${seq}: no reply. The PC is asleep or switched off.`)]);
    }
    if (seq < count) await pause(1000 - (performance.now() - t0), signal);
  }
  if (signal.aborted) return;
  const lost = Math.round((100 * (sent - times.length)) / sent);
  const range = times.length
    ? ` · min/avg/max ${Math.round(Math.min(...times))}/${Math.round(
        times.reduce((a, b) => a + b, 0) / times.length,
      )}/${Math.round(Math.max(...times))} ms`
    : "";
  say([
    out(""),
    out("--- desk ping statistics ---"),
    out(`${sent} sent, ${times.length} received, ${lost}% lost${range}`),
  ]);
}

export async function traceDesk({ say, pulse, signal }: Probe) {
  say([out(`traceroute to desk (${WHERE}), 3 hops`)]);

  let colo = "";
  const t0 = performance.now();
  try {
    const res = await fetch("/cdn-cgi/trace", { cache: "no-store", signal });
    const text = res.ok ? await res.text() : "";
    colo = /^colo=(\w+)$/m.exec(text)?.[1] ?? "";
    say([
      out(
        ` 1  Cloudflare's edge, ${edge(colo)}`.padEnd(38) +
          ms(performance.now() - t0),
      ),
    ]);
  } catch {
    if (signal.aborted) return;
    say([out(" 1  Cloudflare's edge".padEnd(38) + "*")]);
  }

  pulse("up");
  const r = await pong(signal);
  if (!r.ok) {
    say(failed(r.code));
    return;
  }
  colo ||= r.colo;
  const deskMs = r.deskMs ?? 0;
  say([
    out(
      ` 2  Worker "website", ${colo || "edge"}`.padEnd(38) + ms(r.ms - deskMs),
    ),
  ]);
  if (r.up) {
    pulse("down");
    say([out(" 3  Cloudflare Tunnel to the PC".padEnd(38) + ms(r.ms))]);
  } else {
    say([out(" 3  * * *  the PC didn't answer: asleep or off")]);
  }
  say([
    {
      kind: "hint",
      text: "Every question takes this way, and its answer comes back down it. `ping desk` times it again.",
      cmds: ["ping desk"],
    },
  ]);
}
