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

/** One probe: `deskMs` is timed from the edge, `ms` from this page. */
type Reply = {
  seq: number;
  up: boolean;
  colo: string;
  deskMs: number | null;
  ms: number;
};

type Failure = "rate_limited" | "offline" | "aborted";

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

/** All `count` probes ride one request; see the Worker's `ping`. */
async function probes(
  count: number,
  signal: AbortSignal,
  each: (r: Reply) => void,
): Promise<Failure | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(`/api/ping?count=${count}`, {
      cache: "no-store",
      signal,
    });
    if (res.status === 429) return "rate_limited";
    if (!res.ok || !res.body) return "offline";
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const text of lines) {
        if (!text.trim()) continue;
        const b = JSON.parse(text) as {
          seq?: unknown;
          up?: unknown;
          colo?: unknown;
          deskMs?: unknown;
        };
        each({
          seq: typeof b.seq === "number" ? b.seq : 0,
          up: b.up === true,
          colo: typeof b.colo === "string" ? b.colo : "",
          deskMs: typeof b.deskMs === "number" ? b.deskMs : null,
          ms: performance.now() - t0,
        });
      }
    }
  } catch {
    return signal.aborted ? "aborted" : "offline";
  }
}

function failed(code: Failure): Line[] {
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
  say([out(`PING desk (${WHERE}), timed from Cloudflare's edge`)]);
  const times: number[] = [];
  let sent = 0;
  pulse("up");
  const failure = await probes(count, signal, (r) => {
    sent = r.seq;
    if (r.up && r.deskMs !== null) {
      pulse("down");
      times.push(r.deskMs);
      say([
        out(
          `reply from desk via ${edge(r.colo)}: seq=${r.seq} time=${ms(r.deskMs)}`,
        ),
      ]);
    } else {
      say([out(`seq=${r.seq}: no reply. The PC is asleep or switched off.`)]);
    }
    if (r.seq < count) {
      setTimeout(
        () => {
          if (!signal.aborted) pulse("up");
        },
        Math.max(0, 1000 - (r.deskMs ?? 1000)),
      );
    }
  });
  if (failure) {
    say(failed(failure));
    return;
  }
  if (signal.aborted || !sent) return;
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
  const got: Reply[] = [];
  const failure = await probes(1, signal, (r) => got.push(r));
  const r = got[0];
  if (failure || !r) {
    say(failed(failure ?? "offline"));
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
