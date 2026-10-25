import { sync$, type JSXOutput } from "@qwik.dev/core";
import {
  gradCss,
  render,
  type Rendered,
  type Seg,
  type State,
  type Tone,
} from "./model";
import { threadFor } from "./thread";

const TONE: Record<Exclude<Tone, "grad">, string> = {
  normal: "text-term-fg",
  dim: "text-term-dim",
  grey: "text-term-dim",
  cyan: "text-term-cyan",
  yellow: "text-term-yellow",
};

export type Line = Seg[] | { comment: string };

type LinesProps = {
  lines: Line[];
  title?: string;
  /** A part ("limits") or one repo ("repo:infra") to mark. */
  highlight?: string;
  /** Shown when there are no lines, in place of an empty frame. */
  empty?: string;
};

type TerminalProps = LinesProps & {
  label: string;
  /** Names the session its third dot opens, from a [data-session] around it. */
  opens?: string;
};

const marked = (g: Seg, h?: string) =>
  !!h && !!g.part && (h === g.part || h === `${g.part}:${g.ref}`);

export const Segment = (g: Seg, key: number, h?: string): JSXOutput => {
  const cls = [
    g.tone === "grad" ? "" : TONE[g.tone],
    marked(g, h) ? "bg-term-fg/6 rounded-sm" : "",
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

const Lines = ({ lines, title, highlight, empty }: LinesProps) => {
  const first = lines.findIndex((l) => Array.isArray(l));
  return (
    <div class="w-max min-w-full px-4 py-3 font-mono text-[0.75rem] leading-[1.75]">
      {lines.length === 0 && (
        <div class="text-term-dim italic">{empty ?? " "}</div>
      )}
      {lines.map((l, i) =>
        Array.isArray(l) ? (
          <div key={i} class="flex whitespace-pre">
            {l.map((g, j) => Segment(g, j, highlight))}
            {i === first && title && (
              <span class="text-term-fg ml-auto pl-6 font-medium">{title}</span>
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
  );
};

const DOT = "bg-term-dim/40 size-2.5 rounded-full";

const openSession = sync$((_: Event, el: HTMLElement) => {
  const d = el.closest("[data-session]")?.querySelector("dialog");
  if (!d || d.open) return;
  d.removeAttribute("data-max");
  d.querySelector("[aria-pressed]")?.setAttribute("aria-pressed", "false");
  d.showModal();
  const log = d.querySelector(".session-log");
  if (log) log.scrollTop = log.scrollHeight;
});

/** A dark terminal window. Wide lines scroll inside it, never the page. */
export const Terminal = ({
  lines,
  label,
  title,
  highlight,
  empty,
  opens,
}: TerminalProps) => (
  <div
    role="group"
    aria-label={label}
    class="bg-term border-term-fg/10 has-[:focus-visible]:outline-accent overflow-hidden rounded-xl border has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2"
  >
    <div class="bg-term-bar flex items-center gap-1.5 px-3 py-2">
      <span class={DOT} aria-hidden="true" />
      <span class={DOT} aria-hidden="true" />
      {opens ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`Open ${opens} in a session`}
          title="Open in a session"
          onClick$={openSession}
          class="win -m-[7px] focus-visible:outline-none"
        >
          <span aria-hidden="true">
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M5 2v6M2 5h6"
                stroke="currentColor"
                stroke-width="1.5"
                fill="none"
              />
            </svg>
          </span>
        </button>
      ) : (
        <span class={DOT} aria-hidden="true" />
      )}
    </div>
    {/* Positioned, so Segment's screen-reader-only spans are clipped here, not by the page. The frame draws the focus ring: on --term-bg the light palettes' accents are under 3:1. */}
    <div class="scroll-cue relative overflow-x-auto focus-visible:outline-none">
      <Lines
        lines={lines}
        {...(title ? { title } : {})}
        {...(highlight ? { highlight } : {})}
        {...(empty ? { empty } : {})}
      />
    </div>
  </div>
);

const closeSession = sync$((_: Event, el: HTMLElement) =>
  el.closest("dialog")?.close(),
);
const zoomSession = sync$((_: Event, el: HTMLElement) => {
  const max = el.closest("dialog")?.toggleAttribute("data-max") ?? false;
  el.setAttribute("aria-pressed", String(max));
});
const closeOutside = sync$((e: MouseEvent, el: HTMLDialogElement) => {
  if (e.target === el) el.close();
});

const GLYPH = {
  close: "M3.5 3.5l5 5M8.5 3.5l-5 5",
  minimize: "M3 6h6",
  maximize: "M6 3v6M3 6h6",
};

const WinButton = ({ act }: { act: keyof typeof GLYPH }) => {
  const onClick = act === "maximize" ? zoomSession : closeSession;
  return (
    <button
      type="button"
      aria-label={act[0]!.toUpperCase() + act.slice(1)}
      {...(act === "maximize" ? { "aria-pressed": "false" as const } : {})}
      onClick$={onClick}
      class="win"
    >
      <span aria-hidden="true">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d={GLYPH[act]}
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </span>
    </button>
  );
};

/** The window the third dot opens: a made-up session with this line under it. */
const Session = ({ r, seed }: { r: Rendered; seed: string }) => {
  const t = threadFor(r.title, seed);
  return (
    <dialog
      class="session bg-term text-term-fg border-term-fg/10 rounded-xl border p-0"
      aria-label={`${r.title || "A session"}, a sample conversation`}
      onClick$={closeOutside}
    >
      <div class="flex h-full flex-col">
        <div class="bg-term-bar flex items-center gap-3 px-2.5 py-1.5">
          <div class="flex">
            <WinButton act="close" />
            <WinButton act="minimize" />
            <WinButton act="maximize" />
          </div>
          <span class="text-term-dim min-w-0 truncate font-mono text-[0.75rem]">
            {t.cwd}
          </span>
        </div>
        <div
          tabIndex={0}
          role="region"
          aria-label="Conversation"
          class="session-log"
        >
          <p class="text-term-dim italic">
            # A made-up session, to show where the status line sits.
          </p>
          {t.turns.map((u, i) =>
            "you" in u ? (
              <p key={i} class="you">
                <span class="text-term-dim" aria-hidden="true">
                  {"> "}
                </span>
                {u.you}
              </p>
            ) : "says" in u ? (
              <p key={i}>
                <span aria-hidden="true">⏺</span>
                <span>{u.says}</span>
              </p>
            ) : (
              <div key={i}>
                <p>
                  <span class="text-term-cyan" aria-hidden="true">
                    ⏺
                  </span>
                  <span>
                    {u.tool}({u.arg})
                  </span>
                </p>
                <p class="text-term-dim mt-0 pl-1">
                  <span aria-hidden="true">⎿</span>
                  <span>{u.out}</span>
                </p>
              </div>
            ),
          )}
        </div>
        <div class="px-3 pb-2">
          <div class="session-input">{"> "}</div>
          <div class="scroll-cue relative overflow-x-auto focus-visible:outline-none">
            <Lines lines={r.lines} title={r.title} />
          </div>
        </div>
      </div>
    </dialog>
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
    <div data-session>
      <Terminal
        lines={r.lines}
        title={r.title}
        label={label}
        opens={r.title ? `“${r.title}”` : "this status line"}
        {...(highlight ? { highlight } : {})}
      />
      <Session r={r} seed={label} />
    </div>
  );
};
