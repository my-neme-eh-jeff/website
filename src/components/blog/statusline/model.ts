/**
 * A port of the render path in claude-statusline/statusline.sh
 * (my-neme-eh-jeff/ai-experiments, e179f9c). Re-check `plain()` against the
 * script's demo with scripts/statusline-parity.mjs.
 */

export type Limit = { used: number; resetsIn: number };

export type Repo = {
  name: string;
  branch: string;
  /** This entry is a linked worktree, not the main checkout. */
  ownWorktree?: boolean;
  /** Other live sessions in the same checkout. */
  collide?: number;
  /** Branch of another live session in a separate worktree of this repo. */
  worktreeOf?: string;
};

export type State = {
  title: string;
  model: string;
  ctx1m: boolean;
  effort: string;
  context: number;
  cost: number;
  fiveHour?: Limit;
  week?: Limit;
  cacheCold?: boolean;
  kube?: string;
  aws?: { profile: string; account: string; role: string; ssoValid: boolean };
  repos?: Repo[];
};

export type Tone = "normal" | "dim" | "grey" | "cyan" | "yellow" | "grad";

export type Part =
  "model" | "context" | "cost" | "limits" | "cache" | "kube" | "aws" | "repo";

export type Seg = {
  text: string;
  tone: Tone;
  /** Percentage that picks the colour when tone is "grad". */
  pct?: number;
  part?: Part;
  /** Which repo, on a repo row, so a figure can point at one. */
  ref?: string;
  /** Set on emoji: what a screen reader hears instead. */
  says?: string;
};

export type Chip = {
  name: "5h" | "wk";
  pct: number;
  left: number;
  blocking: boolean;
  /** Seconds until 100% at the current pace; 0 when the reset comes first. */
  eta: number;
};

const MAX_REPOS = 8;

const WINDOWS = [
  { key: "fiveHour", name: "5h", len: 18000 },
  { key: "week", name: "wk", len: 604800 },
] as const;

/** jq's `dur` and bash's `fmt_dur`: 3h05m, 40m, 2d4h. Empty at or below 0. */
export function dur(seconds: number): string {
  const s = Math.floor(seconds);
  if (s <= 0) return "";
  if (s >= 86400)
    return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600)
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 60)}m`;
}

/** `grad_color`: green at 0, yellow at 50, red at 100, in bash integer maths. */
export function grad(pct: number): [number, number, number] {
  const p = Math.trunc(pct);
  const clamp = (n: number) => Math.min(255, Math.max(0, n));
  if (p <= 50) return [clamp(Math.trunc((p * 255) / 50)), 255, 0];
  return [255, clamp(Math.trunc(((100 - p) * 255) / 50)), 0];
}

export const gradCss = (pct: number) => `rgb(${grad(pct).join(" ")})`;

/**
 * The plan windows worth showing, worst first, at most two. Nothing under 60%.
 * The forecast is the average burn since the window opened, extrapolated, and
 * kept only when it reaches 100% before the window resets.
 */
export function chips(s: Pick<State, "fiveHour" | "week">): Chip[] {
  const out: Chip[] = [];
  for (const w of WINDOWS) {
    const r = s[w.key];
    if (!r) continue;
    const pct = Math.round(r.used);
    if (pct < 60) continue;
    const left = Math.max(0, Math.floor(r.resetsIn));
    const spent = w.len - left;
    const raw =
      pct >= 100 || left <= 0 || spent <= 0
        ? 0
        : Math.floor(((100 - pct) * spent) / pct);
    out.push({
      name: w.name,
      pct,
      left,
      blocking: pct >= 100,
      eta: raw > 0 && raw < left ? raw : 0,
    });
  }
  const key = (c: Chip) =>
    [c.blocking ? 0 : 1, c.eta > 0 ? c.eta : 1e12, -c.pct] as const;
  out.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return out.slice(0, 2);
}

export type Rendered = { lines: Seg[][]; title: string };

export function render(s: State): Rendered {
  const bar: Seg = { text: " | ", tone: "dim" };
  const parts = [s.ctx1m ? "1M" : "", s.effort].filter(Boolean).join(", ");
  const pct = Math.round(s.context);
  const cents = Math.round(s.cost * 100);
  const cost = `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

  const line1: Seg[] = [
    {
      text: parts ? `${s.model} (${parts})` : s.model,
      tone: "normal",
      part: "model",
    },
    bar,
    { text: "🧠", tone: "grad", pct, part: "context", says: "context" },
    { text: ` ${pct}%`, tone: "grad", pct, part: "context" },
    bar,
    { text: `$${cost}`, tone: "normal", part: "cost" },
  ];

  const cs = chips(s);
  if (cs.length) {
    line1.push(bar, {
      text: "🔋",
      tone: "normal",
      part: "limits",
      says: "limits",
    });
    cs.forEach((c, i) => {
      if (i) line1.push({ text: " ·", tone: "dim", part: "limits" });
      let txt = ` ${c.name} ${c.pct}%`;
      if (c.blocking) txt += " !";
      if (c.eta) txt += ` → 100% in ${dur(c.eta)}`;
      line1.push({ text: txt, tone: "grad", pct: c.pct, part: "limits" });
      if (c.left > 0)
        line1.push({ text: ` ↻${dur(c.left)}`, tone: "dim", part: "limits" });
    });
  }
  if (s.cacheCold)
    line1.push(bar, { text: "cache cold", tone: "yellow", part: "cache" });

  const lines: Seg[][] = [line1];

  if (s.kube) {
    const line2: Seg[] = [
      { text: "☸", tone: "cyan", part: "kube", says: "kube context" },
      { text: ` ${s.kube}`, tone: "cyan", part: "kube" },
    ];
    const a = s.aws;
    if (a && a.ssoValid) {
      const detail = a.account && a.role ? ` (${a.account} · ${a.role})` : "";
      line2.push(
        bar,
        { text: "☁", tone: "yellow", part: "aws", says: "AWS profile" },
        { text: ` ${a.profile}${detail}`, tone: "yellow", part: "aws" },
      );
    }
    lines.push(line2);
  }

  const repos = s.repos ?? [];
  for (const r of repos.slice(0, MAX_REPOS)) {
    const at = { part: "repo", ref: r.name } as const;
    const row: Seg[] = [
      { text: "⎇", tone: "grey", says: "repo", ...at },
      {
        text: ` ${r.name}(${r.branch})${r.ownWorktree ? "·wt" : ""}`,
        tone: "grey",
        ...at,
      },
    ];
    if (r.collide) row.push({ text: ` ⚠×${r.collide}`, tone: "yellow", ...at });
    else if (r.worktreeOf !== undefined)
      row.push({ text: ` ⑃ ${r.worktreeOf}`, tone: "dim", ...at });
    lines.push(row);
  }
  if (repos.length > MAX_REPOS)
    lines.push([{ text: `  +${repos.length - MAX_REPOS} more`, tone: "grey" }]);

  return { lines, title: s.title.slice(0, 50) };
}

/** The rendered lines as the terminal would show them, minus colour and title. */
export const plain = (r: Rendered) =>
  r.lines.map((l) => l.map((g) => g.text).join(""));
