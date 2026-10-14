import type { JSXOutput } from "@qwik.dev/core";
import { gradCss, render, type Seg, type State, type Tone } from "./model";

const TONE: Record<Exclude<Tone, "grad">, string> = {
  normal: "text-term-fg",
  dim: "text-term-dim",
  grey: "text-term-dim",
  cyan: "text-term-cyan",
  yellow: "text-term-yellow",
};

export type Line = Seg[] | { comment: string };

type TerminalProps = {
  lines: Line[];
  label: string;
  title?: string;
  /** A part ("limits") or one repo ("repo:infra") to mark. */
  highlight?: string;
  /** Shown when there are no lines, in place of an empty frame. */
  empty?: string;
};

const marked = (g: Seg, h?: string) =>
  !!h && !!g.part && (h === g.part || h === `${g.part}:${g.ref}`);

export const Segment = (g: Seg, key: number, h?: string): JSXOutput => {
  const cls = [
    g.tone === "grad" ? "" : TONE[g.tone],
    marked(g, h) ? "bg-term-fg/15 rounded-sm" : "",
  ];
  const style = g.tone === "grad" ? { color: gradCss(g.pct ?? 0) } : undefined;
  if (!g.says)
    return (
      <span key={key} class={cls} style={style}>
        {g.text}
      </span>
    );
  return (
    <span key={key} class={cls} style={style}>
      <span aria-hidden="true">{g.text}</span>
      <span class="sr-only">{g.says}</span>
    </span>
  );
};

/** A dark terminal window. Wide lines scroll inside it, never the page. */
export const Terminal = ({
  lines,
  label,
  title,
  highlight,
  empty,
}: TerminalProps) => {
  const first = lines.findIndex((l) => Array.isArray(l));
  return (
    <div
      role="group"
      aria-label={label}
      class="bg-term border-term-fg/10 overflow-hidden rounded-xl border"
    >
      <div class="bg-term-bar flex gap-1.5 px-3 py-2" aria-hidden="true">
        <span class="bg-term-dim/40 size-2.5 rounded-full" />
        <span class="bg-term-dim/40 size-2.5 rounded-full" />
        <span class="bg-term-dim/40 size-2.5 rounded-full" />
      </div>
      {/* `relative` so the sr-only spans in Segment are clipped here, not by the page. */}
      <div class="scroll-cue relative overflow-x-auto">
        <div class="w-max min-w-full px-4 py-3 font-mono text-[0.75rem] leading-[1.75]">
          {lines.length === 0 && (
            <div class="text-term-dim italic">{empty ?? "\u00a0"}</div>
          )}
          {lines.map((l, i) =>
            Array.isArray(l) ? (
              <div key={i} class="flex whitespace-pre">
                {l.map((g, j) => Segment(g, j, highlight))}
                {i === first && title && (
                  <span class="text-term-fg ml-auto pl-6 font-medium">
                    {title}
                  </span>
                )}
              </div>
            ) : (
              <div
                key={i}
                class="text-term-dim mt-2 whitespace-pre italic first:mt-0"
              >
                {`# ${l.comment}`}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
};

export const Statusline = ({
  state,
  label = "Status line",
  highlight,
}: {
  state: State;
  label?: string;
  highlight?: string;
}) => {
  const r = render(state);
  return (
    <Terminal
      lines={r.lines}
      title={r.title}
      label={label}
      {...(highlight ? { highlight } : {})}
    />
  );
};
