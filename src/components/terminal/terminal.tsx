import {
  component$,
  useOnDocument,
  useSignal,
  useStore,
  $,
  sync$,
  Slot,
  type QRL,
  type Signal,
} from "@qwik.dev/core";
import { haptic } from "./haptics";
import { sound, isMuted, setMuted, type Tone } from "./sounds";
import { load as loadHistory, save as saveHistory } from "./history";
import { run, completions, ASK, PICK, type Line } from "./commands";
import { ThemePick, PICKS, type PickState } from "./theme-pick";
import { FACE_COLS, Face, Wire } from "./wire";
import { abortChat, sendChat, type Outcome, type Turn } from "./chat";
import {
  KNOWN_HREFS,
  MAX_ASSISTANT_CHARS,
  MAX_TURNS,
  MAX_USER_CHARS,
} from "~/content/chat";
import { DEFAULT_PALETTE } from "~/content/palettes";
import { profile } from "~/content/profile";
import lightUrl from "~/components/desk/light.ts?worker&url";

const INTRO: Line = {
  kind: "hint",
  text: "Type a question, `help` for the commands, or `theme` to switch themes.",
  cmds: ["theme"],
};

const PROMPT = "~ $";

const SEED_QUESTIONS: readonly string[] = [
  "What is he working on?",
  "What's his stack?",
  "How does this chat work?",
];

// Topped up from the old row, then the first three, so the row keeps its
// length and the button that was clicked is never removed from under focus.
const offer = (
  fresh: readonly string[],
  before: readonly string[],
  asked: readonly string[],
) => {
  const row = [...fresh];
  for (const q of [...before, ...SEED_QUESTIONS]) {
    if (row.length >= before.length) break;
    if (!asked.includes(q) && !row.includes(q)) row.push(q);
  }
  return row;
};

type Phase = "idle" | "answering" | "suggesting";

/**
 * `open` is worked out here, not in the button's attributes. With Qwik rc.3
 * an attribute reading `convo.phase` updated on its own and kept each slot's
 * previous `q`, so the empty slots stayed clickable (2026-10-17).
 */
const chipSlots = (
  asks: readonly string[],
  landed: readonly string[],
  phase: Phase,
): { q: string; open: boolean }[] =>
  phase === "suggesting"
    ? [
        ...landed.map((q) => ({ q, open: true })),
        ...asks.slice(landed.length).map(() => ({ q: "", open: false })),
      ]
    : asks.map((q) => ({ q, open: phase === "idle" }));

const CHIP =
  "border-line text-muted hover:text-text hover:border-muted inline-flex min-h-6 items-center rounded-full border px-2.5 font-mono text-[0.6875rem] transition-colors duration-150 aria-disabled:text-muted/45 aria-disabled:pointer-events-none";

// Suggestions are asked as they stand: the model writes them, so never `run`.
type From = "input" | "suggestion";

const SLOW_MS = 4_000;

function chatError(code: string): Line[] {
  if (code === "rate_limited") {
    return [
      {
        kind: "err",
        text: "Too many questions from your network. Try again in a minute.",
      },
    ];
  }
  if (code === "offline") {
    return [
      { kind: "err", text: "The model on Aman's desk is offline right now." },
      {
        kind: "hint",
        text: "The rest of the shell still works: try `help` or `k get projects`.",
      },
    ];
  }
  return [{ kind: "err", text: "The model could not answer that. Try again." }];
}

function statsLine(o: Extract<Outcome, { ok: true }>): string {
  const parts = [`${o.model || "model"} on Aman's desk`];
  if (o.stats && o.stats.genMs > 0) {
    parts.push(`${(o.stats.tokens / (o.stats.genMs / 1000)).toFixed(1)} tok/s`);
  }
  if (o.firstTokenMs >= 0) {
    parts.push(`ttft ${(o.firstTokenMs / 1000).toFixed(1)}s`);
  }
  if (o.stats && o.stats.loadMs > 1000) {
    parts.push(`cold start ${(o.stats.loadMs / 1000).toFixed(1)}s`);
  }
  return parts.join(" · ");
}

const LINE_CLASS: Record<Line["kind"], string> = {
  // What was typed, in the colour commands have everywhere (--sem-alt).
  in: "text-alt font-medium",
  out: "text-muted",
  err: "text-danger",
  hint: "text-muted",
  art: "text-muted/85 scroll-cue whitespace-pre overflow-x-auto",
  ai: "text-text",
  meta: "text-muted text-[0.6875rem] leading-snug",
};

const MUTE_BTN_ID = "term-mute";

/** The light/dark dot: a half turn as it flips, a shake when it can't. */
const SPIN: Keyframe[] = [
  { transform: "rotate(-180deg)" },
  { transform: "none" },
];
const SHAKE: Keyframe[] = [0, -3, 3, -2, 2, 0].map((x) => ({
  transform: `translateX(${x}px)`,
  easing: "ease-in-out",
}));

export type Group = {
  kind: Line["kind"];
  text: string;
  link?: Line["link"];
  live?: Line["live"];
  cmds?: Line["cmds"];
};

export function renderGroups(items: Line[]): Group[] {
  const groups: Group[] = [];
  for (const l of items) {
    const prev = groups[groups.length - 1];
    if (l.kind === "art" && prev?.kind === "art") {
      prev.text += `\n${l.text}`;
    } else {
      groups.push({
        kind: l.kind,
        text: l.text,
        link: l.link,
        live: l.live,
        cmds: l.cmds,
      });
    }
  }
  return groups;
}

/**
 * A hanging indent, so a line that wraps continues after the prompt, under
 * its last column (after a run of 2+ spaces), or under its own indent.
 */
function hang(g: Group) {
  const n =
    g.kind === "in"
      ? PROMPT.length + 1
      : g.kind === "ai"
        ? 0
        : (/^.*\S {2,}(?=\S)/.exec(g.text)?.[0].length ??
          /^ */.exec(g.text)?.[0].length ??
          0);
  return n ? { paddingLeft: `${n}ch`, textIndent: `-${n}ch` } : undefined;
}

/**
 * Only `https?://` and bare email addresses match, so no input can produce a
 * `javascript:` href.
 */
const LINK =
  /(?:https?:\/\/[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function commonPrefix(all: string[]): string {
  if (all.length === 0) return "";
  let out = all[0]!;
  for (const c of all.slice(1)) {
    let i = 0;
    while (i < out.length && i < c.length && out[i] === c[i]) i++;
    out = out.slice(0, i);
    if (!out) break;
  }
  return out;
}

export type Segment = { text: string; href?: string };

/** With `allow`, only hrefs in it become links; the rest stay text. */
export function linkify(text: string, allow?: ReadonlySet<string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index;
    let hit = m[0];
    const trailing = /[.,;:!?)\]]+$/.exec(hit)?.[0];
    if (trailing) hit = hit.slice(0, -trailing.length);
    if (!hit) continue;
    const href = hit.startsWith("http") ? hit : `mailto:${hit}`;
    if (allow && !allow.has(href)) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: hit, href });
    last = start + hit.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const LINK_CLASS =
  "text-accent underline decoration-current underline-offset-2";

function links(text: string, allow?: ReadonlySet<string>) {
  return linkify(text, allow).map((seg, j) =>
    seg.href ? (
      <a
        href={seg.href}
        target={seg.href.startsWith("http") ? "_blank" : undefined}
        rel="noopener noreferrer"
        class={LINK_CLASS}
        key={j}
      >
        {seg.text}
        {seg.href.startsWith("http") && (
          <span class="sr-only"> (opens in a new tab)</span>
        )}
      </a>
    ) : (
      <span key={j}>{seg.text}</span>
    ),
  );
}

/**
 * A hint, with each `command` it suggests drawn as commands are. Those in
 * `cmds` are buttons that type themselves in and run.
 */
function hintText(
  text: string,
  cmds: readonly string[] = [],
  type$?: QRL<(cmd: string) => void>,
) {
  return text.split("`").map((part, j) =>
    j % 2 ? (
      type$ && cmds.includes(part) ? (
        <button
          type="button"
          class="text-alt cursor-pointer underline decoration-1 underline-offset-3 hover:decoration-2"
          key={j}
          onClick$={() => type$(part)}
        >
          {part}
        </button>
      ) : (
        <span class="text-alt" key={j}>
          {part}
        </span>
      )
    ) : (
      <span key={j}>{links(part)}</span>
    ),
  );
}

function echo(text: string) {
  if (!text.startsWith(PROMPT)) return text;
  return [
    <span class="text-accent font-normal" key="p">
      {PROMPT}
    </span>,
    text.slice(PROMPT.length),
  ];
}

function prose(text: string, allow?: ReadonlySet<string>) {
  return text.split("\n").map((line, j) => {
    const lead = /^\s*(?:[-*\u2022]|\d+[.)])\s+/.exec(line)?.[0] ?? "";
    // One element for blank and full lines: as two, a key that streamed in
    // blank kept the spacer's class once its text arrived (rc.3, 2026-10-16).
    return (
      <span
        class={line.trim() ? "block" : "block h-2"}
        style={
          lead
            ? {
                paddingLeft: `${lead.length}ch`,
                textIndent: `-${lead.length}ch`,
              }
            : undefined
        }
        key={j}
      >
        {lead && <span class="text-muted">{lead}</span>}
        {links(line.slice(lead.length), allow)}
      </span>
    );
  });
}

/**
 * Its own component: read in the shell's JSX, the signal would re-render the
 * whole shell per token.
 */
const Streaming = component$<{ text: Signal<string> }>(({ text }) => (
  <>{prose(text.value)}</>
));

/**
 * @qwik.dev/core rc.3 renders on a later task after a store write (checked
 * 2026-10-16), so new DOM is polled for. Timers, since rAF stops in a
 * background tab.
 */
function untilDone(fn: () => boolean, tries = 30) {
  if (tries <= 0) return;
  setTimeout(() => {
    if (!fn()) untilDone(fn, tries - 1);
  }, 0);
}

function stickToBottom(lineCount: number) {
  let scrolled = false;
  untilDone(() => {
    const body = document.querySelector<HTMLElement>("[data-shell] label");
    if (!body) return false;
    if (body.querySelectorAll("pre").length < lineCount) return false;
    body.scrollTop = body.scrollHeight;
    // Twice: a diagram can grow a scrollbar after the count is met.
    const done = scrolled;
    scrolled = true;
    return done;
  });
}

function shellColumns(): number {
  const body = document.querySelector<HTMLElement>("[data-shell] label");
  if (body) {
    const prompt =
      document.getElementById("term-input")?.previousElementSibling;
    const ch = (prompt?.getBoundingClientRect().width ?? 0) / PROMPT.length;
    const cs = getComputedStyle(body);
    const inner =
      body.clientWidth -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight);
    if (ch > 0) return Math.floor(inner / ch);
  }
  return 80;
}

function followIfPinned() {
  const body = document.querySelector<HTMLElement>("[data-shell] label");
  if (!body) return;
  if (body.scrollHeight - body.scrollTop - body.clientHeight > 32) return;
  setTimeout(() => (body.scrollTop = body.scrollHeight), 0);
}

/**
 * The chip row only grows until `clear`: each change of height moves every
 * chip under the pointer, and questions can be clicked while others land.
 */
function holdChipRow(hold: boolean) {
  const row = document.querySelector<HTMLElement>(
    '[aria-labelledby="term-suggest"]',
  );
  if (row) row.style.minHeight = hold ? `${row.offsetHeight}px` : "";
}

function clearBusy() {
  const shell = document.querySelector("[data-shell]");
  shell?.removeAttribute("data-busy");
  shell?.removeAttribute("data-cold");
}

export const Terminal = component$(() => {
  const lines = useStore<{ items: Line[] }>({ items: [INTRO] });
  const partial = useSignal("");

  const tab = useStore({ base: "", last: "", i: -1, armed: false });

  const convo = useStore<{
    phase: Phase;
    turns: Turn[];
    note: string;
    asks: readonly string[];
    /** The questions written after the latest answer, as they arrived. */
    landed: readonly string[];
    /** One of those, clicked before the rest were written: asked next. */
    queued: string;
  }>({
    phase: "idle",
    turns: [],
    note: "",
    asks: SEED_QUESTIONS,
    landed: [],
    queued: "",
  });

  const pick = useStore<PickState>({
    open: false,
    i: 0,
    mode: "auto",
    saved: DEFAULT_PALETTE,
  });

  /*
   * @qwik.dev/optimizer 2.1.0-beta.9 (2026-10-16) captures only bindings
   * declared above a `$()`, so state goes first. Not named `history`: a
   * missed capture of that resolves to window.history instead of throwing.
   */
  const cmdHistory = useStore<{ past: string[]; cursor: number }>({
    past: [],
    cursor: -1,
  });

  const recalled = useSignal(false);
  const typing = useSignal(false);

  /** Run before `cmdHistory.past` is read or written. */
  const ensureHistory = $(async () => {
    if (recalled.value) return;
    recalled.value = true;
    const stored = await loadHistory();
    if (stored.length) cmdHistory.past = [...stored, ...cmdHistory.past];
  });

  const feedback = $(async (tone: Tone) => {
    document.documentElement.toggleAttribute("data-muted", await sound(tone));
    await haptic(tone === "chrome" ? "key" : tone);
  });

  const converseInner = $(async (text: string) => {
    const say = (more: Line[]) => {
      lines.items = [...lines.items, ...more];
      stickToBottom(renderGroups(lines.items).length);
    };

    if (text.length > MAX_USER_CHARS) {
      return say([
        {
          kind: "err",
          text: `Keep it under ${MAX_USER_CHARS} characters, please.`,
        },
      ]);
    }

    const turns: Turn[] = [
      ...convo.turns,
      { role: "user" as const, content: text },
    ].slice(-MAX_TURNS);
    convo.phase = "answering";
    convo.landed = [];
    await feedback("enter");

    // Created with its first word, so no blank row sits above the busy line.
    let answer: Line | null = null;
    let got = "";
    const slow = setTimeout(() => {
      convo.note = "cold start, ~20s";
      document.querySelector("[data-shell]")?.setAttribute("data-cold", "");
    }, SLOW_MS);
    // Before aria-busy drops, so the finished answer is announced once.
    const settle = () => {
      clearTimeout(slow);
      convo.note = "";
      const done = answer as Line | null;
      if (done) {
        done.text = partial.value;
        done.live = false;
      }
    };
    let outcome: Outcome;
    try {
      outcome = await sendChat(turns, {
        token: (t) => {
          got = (got + t).trimStart();
          if (!got) return;
          // gpt-oss uses asterisks for emphasis and bullets even when told not to.
          partial.value = got.replace(/^(\s*)\* /gm, "$1- ").replace(/\*/g, "");
          if (answer) {
            followIfPinned();
            return;
          }
          clearTimeout(slow);
          convo.note = "";
          clearBusy();
          say([{ kind: "ai", text: "", live: true }]);
          answer = lines.items[lines.items.length - 1]!;
        },
        answered: () => {
          settle();
          clearBusy();
          holdChipRow(true);
          convo.phase = "suggesting";
        },
        next: (q) => {
          convo.landed = [...convo.landed, q];
        },
      });
    } finally {
      settle();
      // Busy straight through to a queued question, so nothing slips in.
      convo.phase = convo.queued ? "answering" : "idle";
    }

    if (outcome.ok) {
      convo.turns = [
        ...turns,
        {
          role: "assistant" as const,
          content: got.slice(0, MAX_ASSISTANT_CHARS),
        },
      ];
      // Even with no new questions, so none already asked is offered again.
      convo.asks = offer(
        outcome.next,
        convo.asks,
        turns.filter((t) => t.role === "user").map((t) => t.content),
      );
      // Stats come with `done`, which a reply cut off early never gets.
      if (outcome.stats) say([{ kind: "meta", text: statsLine(outcome) }]);
    } else if (outcome.code !== "aborted") {
      say(chatError(outcome.code));
      await feedback("error");
    } else if (got) {
      say([{ kind: "meta", text: "stopped" }]);
    }
  });

  const record = $(async (raw: string) => {
    const shown =
      lines.items[0]?.text === INTRO.text ? lines.items.slice(1) : lines.items;
    lines.items = [...shown, { kind: "in", text: `${PROMPT} ${raw}` }];
    if (raw.trim()) {
      await ensureHistory();
      cmdHistory.past = [...cmdHistory.past, raw];
      cmdHistory.cursor = -1;
      await saveHistory(cmdHistory.past);
    }
  });

  const converse = $(async (text: string) => {
    try {
      for (let ask = text; ask;) {
        await converseInner(ask);
        ask = convo.queued;
        convo.queued = "";
        if (ask) await record(ask);
      }
    } finally {
      clearBusy();
    }
  });

  const openPick = $(async () => {
    const t = window.siteTheme?.get();
    pick.saved = t?.name ?? DEFAULT_PALETTE;
    pick.i = Math.max(
      0,
      PICKS.findIndex((p) => p.id === pick.saved),
    );
    pick.mode = t?.mode ?? "auto";
    pick.open = true;
    untilDone(() => {
      const list = document.getElementById("theme-list");
      if (!list) return false;
      list.focus();
      const body = document.querySelector<HTMLElement>("[data-shell] label");
      if (body) body.scrollTop = body.scrollHeight;
      return true;
    });
    await feedback("enter");
  });

  const closePick = $(async (keep: boolean) => {
    if (!pick.open) return;
    const at = document.activeElement;
    const ours = !at || at === document.body || !!at.closest("#theme-pick");
    pick.open = false;
    const p = PICKS[pick.i]!;
    if (keep) window.siteTheme?.set(p.id, pick.mode);
    else window.siteTheme?.set();
    const how = p.only
      ? ""
      : pick.mode === "auto"
        ? ", following your system"
        : `, ${pick.mode}`;
    const said: Line = keep
      ? {
          kind: "out",
          text: `Switched to ${p.name}${how}. Saved in this browser.`,
        }
      : {
          kind: "meta",
          text: `Kept ${PICKS.find((x) => x.id === pick.saved)?.name ?? pick.saved}.`,
        };
    lines.items = [...lines.items, said];
    stickToBottom(renderGroups(lines.items).length);
    if (ours)
      untilDone(() => {
        const el = document.getElementById("term-input");
        if (!el || el.offsetParent === null) return false;
        el.focus();
        return true;
      });
    await feedback(keep ? "enter" : "key");
  });

  const runLine = $(async (raw: string, from: From = "input") => {
    let handedOff = false;
    try {
      await record(raw);

      if (from === "suggestion") {
        handedOff = true;
        void converse(raw.trim());
        return;
      }

      const result = run(raw, shellColumns(), window.siteTheme?.get());
      if (result === ASK) {
        handedOff = true;
        void converse(raw.trim());
        return;
      }
      if (result === PICK) {
        await openPick();
        return;
      }
      if (result === null) {
        lines.items = [];
        convo.turns = [];
        convo.asks = SEED_QUESTIONS;
        convo.landed = [];
        holdChipRow(false);
        await feedback("enter");
        return;
      }

      lines.items = [...lines.items, ...result];
      const colours = result.find((l) => l.theme)?.theme;
      if (colours) window.siteTheme?.set(colours.name, colours.mode);
      stickToBottom(renderGroups(lines.items).length);
      await feedback(result.some((l) => l.kind === "err") ? "error" : "enter");
    } finally {
      if (!handedOff) clearBusy();
    }
  });

  const submit = $(async (field: HTMLInputElement) => {
    if (convo.phase !== "idle") return;
    const raw = field.value;
    field.value = "";
    await runLine(raw);
  });

  const suggest = $(async (q: string) => {
    if (convo.phase === "idle") return runLine(q, "suggestion");
    // The answer is whole, so stop writing the rest and ask this one.
    if (convo.phase === "suggesting" && convo.landed.includes(q)) {
      convo.queued = q;
      abortChat();
    }
  });

  /** Types `cmd` into the prompt a key at a time, then enters it. */
  const typeIn = $(async (cmd: string) => {
    const field = document.getElementById("term-input");
    if (!(field instanceof HTMLInputElement)) return;
    if (typing.value || convo.phase !== "idle" || pick.open) return;
    typing.value = true;
    try {
      field.focus();
      field.value = "";
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        for (const ch of cmd) {
          field.value += ch;
          await feedback("key");
          await new Promise((r) => setTimeout(r, 45));
        }
      }
      field.value = cmd;
      await submit(field);
    } finally {
      typing.value = false;
    }
  });

  /**
   * No preventDefault here: an async handler can run after dispatch
   * (`qwik/no-async-prevent-default`). keyGuard does it.
   */
  const onKeyDown = $(async (e: KeyboardEvent) => {
    if (e.key !== "Tab") tab.armed = false;

    // Not a signal fed by `input` events: on a page's first Enter those may
    // not have run yet.
    const field = e.target as HTMLInputElement;

    if (e.key === "Enter") {
      await submit(field);
      return;
    }

    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "l") {
        lines.items = [];
        convo.turns = [];
        convo.asks = SEED_QUESTIONS;
        convo.landed = [];
        holdChipRow(false);
        await feedback("enter");
        return;
      }
      if (k === "c") {
        if (window.getSelection()?.toString()) return;
        if (abortChat()) {
          await feedback("error");
          return;
        }
        lines.items = [
          ...lines.items,
          { kind: "in", text: `${PROMPT} ${field.value}^C` },
        ];
        field.value = "";
        cmdHistory.cursor = -1;
        stickToBottom(renderGroups(lines.items).length);
        await feedback("error");
        return;
      }
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      await ensureHistory();
      if (cmdHistory.past.length === 0) return;
      const next =
        e.key === "ArrowUp"
          ? Math.min(cmdHistory.cursor + 1, cmdHistory.past.length - 1)
          : Math.max(cmdHistory.cursor - 1, -1);
      cmdHistory.cursor = next;
      field.value = next === -1 ? "" : (cmdHistory.past.at(-1 - next) ?? "");
      return;
    }

    if (e.key === "Tab") {
      if (e.shiftKey) return;

      const continuing = tab.armed && field.value === tab.last;
      const base = continuing ? tab.base : field.value.trimStart();
      if (!base) return;

      const matches = completions().filter((c) => c.startsWith(base));
      if (matches.length === 0) return;

      if (matches.length === 1) {
        field.value = matches[0]!;
        tab.armed = false;
        await feedback("key");
        return;
      }

      if (continuing) {
        tab.i = (tab.i + 1) % matches.length;
        field.value = matches[tab.i]!;
        tab.last = field.value;
        await feedback("key");
        return;
      }

      const common = commonPrefix(matches);
      if (common.length > base.length) {
        field.value = common;
        tab.armed = false;
        await feedback("key");
        return;
      }

      lines.items = [
        ...lines.items,
        { kind: "in", text: `${PROMPT} ${base}` },
        ...matches.map((m) => ({ kind: "out" as const, text: `  ${m}` })),
      ];
      stickToBottom(renderGroups(lines.items).length);
      tab.base = base;
      tab.i = -1;
      tab.last = field.value;
      tab.armed = true;
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      await feedback("key");
    }
  });

  const toggleMute = $(async () => {
    const next = !(await isMuted());
    document.documentElement.toggleAttribute("data-muted", next);
    await setMuted(next);
    lines.items = [
      ...lines.items,
      {
        kind: "meta",
        text: `Sounds ${next ? "off" : "on"}. This choice is remembered on this device.`,
      },
    ];
    stickToBottom(renderGroups(lines.items).length);
    if (!next) await sound("chrome");
    await haptic("key");
  });

  /**
   * Flips what is on screen, not the stored choice. Landing on what the
   * system asks for goes back to following it, so two presses undo one. On a
   * one-mode theme the button is disabled, and a press only shakes the dot.
   */
  const toggleMode = $(async (_: Event, btn: HTMLButtonElement) => {
    const theme = window.siteTheme;
    if (!theme) return;
    if (pick.open) await closePick(false);
    const now = theme.get();
    const dot = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? null
      : btn.querySelector(".swatch-split");
    if (PICKS.find((x) => x.id === now.name)?.only) {
      dot?.animate(SHAKE, 360);
      return;
    }
    const next = now.scheme === "dark" ? "light" : "dark";
    const system = matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    theme.set(undefined, next === system ? "auto" : next);
    dot?.animate(SPIN, {
      duration: 450,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
    lines.items = [
      ...lines.items,
      {
        kind: "meta",
        text:
          next === system
            ? `${next === "dark" ? "Dark" : "Light"} mode, following your system.`
            : `${next === "dark" ? "Dark" : "Light"} mode. This choice is remembered on this device.`,
      },
    ];
    stickToBottom(renderGroups(lines.items).length);
    await feedback("chrome");
  });

  /*
   * The saved theme is only known in the browser, so a one-mode theme marks
   * the button disabled here: on qinit, before it can be reached, and on
   * every repaint. CSS dims it from the first frame.
   */
  const markMode = sync$(() => {
    const btn = document.getElementById("term-mode");
    if (!btn) return;
    const root = document.documentElement;
    if (root.hasAttribute("data-one-mode")) {
      btn.setAttribute("aria-disabled", "true");
      btn.title = `This theme is ${root.getAttribute("data-scheme")} only.`;
    } else {
      btn.removeAttribute("aria-disabled");
      btn.title = "Light or dark. Remembered on this device.";
    }
  });
  useOnDocument("qinit", markMode);
  useOnDocument("themechange", markMode);

  /**
   * @qwik.dev/core rc.3 (2026-10-16): a sync$ runs from qwikloader before the
   * default action and before any fetch or resume, and captures nothing.
   * Shift+Tab, and Tab on an empty field, must still leave (WCAG 2.1.2).
   */
  const keyGuard = sync$((e: KeyboardEvent, el: HTMLInputElement) => {
    // Busy is marked here: on a page's first Enter, no `$()` handler can run
    // until Qwik has resumed and fetched it.
    if (e.key === "Enter" && el.value.trim() !== "") {
      el.closest("[data-shell]")?.setAttribute("data-busy", "");
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && el.value.trim() !== "") {
      e.preventDefault();
      return;
    }
    // The log is a <label>, which never takes focus, so without this the
    // output above the fold is out of a keyboard's reach.
    if (e.key === "PageUp" || e.key === "PageDown") {
      const log = el.closest("[data-shell]")?.querySelector(".term-log");
      if (!log) return;
      e.preventDefault();
      log.scrollBy(0, (e.key === "PageUp" ? -0.9 : 0.9) * log.clientHeight);
      return;
    }
    if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    // Ctrl+L focuses the address bar. Ctrl+Shift+C opens devtools, hence the
    // shiftKey bail above.
    if (k === "l") {
      e.preventDefault();
      return;
    }
    // Ctrl+C stays copy whenever there is something to copy.
    if (k === "c" && !window.getSelection()?.toString()) {
      e.preventDefault();
    }
  });

  const clickGuard = sync$((_: MouseEvent, el: HTMLElement) => {
    // Enter on a focused chip still clicks it.
    if (el.getAttribute("aria-disabled") === "true") return;
    el.closest("[data-shell]")?.setAttribute("data-busy", "");
    el.parentElement?.setAttribute("data-still", "");
  });

  const pointerMoved = sync$((_: PointerEvent, el: HTMLElement) => {
    el.removeAttribute("data-still");
  });

  // A sync$, so qwikloader starts the light on qidle without waking Qwik
  // (@qwik.dev/core rc.3, 2026-10-16).
  useOnDocument(
    "qidle",
    sync$((_: Event, el: Element) => {
      const src = el.getAttribute("data-light");
      if (
        !src ||
        matchMedia("(prefers-reduced-motion: reduce)").matches ||
        !("transferControlToOffscreen" in HTMLCanvasElement.prototype)
      )
        return;
      const script = document.createElement("script");
      script.src = src;
      document.head.append(script);
    }),
  );

  return (
    <div
      class="glass relative flex h-[max(30rem,calc(100svh_-_8rem))] flex-col overflow-hidden rounded-2xl"
      data-shell
      data-light={lightUrl}
    >
      <div class="border-line/60 flex items-center gap-2 border-b py-1.5 pr-3 pl-4">
        <h1 class="text-muted m-0 min-w-0 font-mono text-xs leading-relaxed font-normal tracking-normal">
          <span class="text-text">{profile.name}</span>, {profile.headline}
          {profile.employer && (
            <>
              {" at "}
              <a
                href={profile.employer.url}
                target="_blank"
                rel="noopener"
                class="underline decoration-current underline-offset-2"
              >
                {profile.employer.name}
                <span class="sr-only"> (opens in a new tab)</span>
              </a>
            </>
          )}
        </h1>
        <button
          type="button"
          id="term-mode"
          onClick$={toggleMode}
          title="Light or dark. Remembered on this device."
          class="hover:bg-text/10 text-muted ml-auto grid size-6 shrink-0 place-items-center rounded-full transition duration-150 active:scale-90"
        >
          {/* All four, and the theme script's attributes hide three. */}
          <span class="if-two-modes if-dark sr-only">Switch to light mode</span>
          <span class="if-two-modes if-light sr-only">Switch to dark mode</span>
          <span class="if-one-mode if-dark sr-only">
            This theme has no light mode
          </span>
          <span class="if-one-mode if-light sr-only">
            This theme has no dark mode
          </span>
          <span class="swatch-split" aria-hidden="true" />
        </button>
        <button
          type="button"
          id={MUTE_BTN_ID}
          onClick$={toggleMute}
          title="Sound on or off. Remembered on this device."
          class="hover:bg-text/10 text-muted grid size-6 shrink-0 place-items-center rounded-full transition duration-150 active:scale-90"
        >
          {/* Both, and `data-muted` on <html> hides one: see MUTED_KEY. */}
          <span class="if-sound sr-only">Mute shell sounds</span>
          <span class="if-muted sr-only">Unmute shell sounds</span>
          <svg
            viewBox="0 0 16 16"
            class="size-3.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8.5 3L5 6H2.5v4H5l3.5 3z" />
            <path class="if-muted" d="M11 6.5l3 3M14 6.5l-3 3" />
            <path class="if-sound" d="M11 6a3 3 0 010 4" />
          </svg>
        </button>
      </div>

      <div class="term-intro">
        <div>
          <p class="text-text m-0 px-4 pt-4 font-mono text-[0.8125rem] leading-relaxed">
            {profile.motd}
          </p>
        </div>
      </div>

      <div class="relative min-h-0 flex-1">
        <div class="desk-slot">
          <Slot name="idle" />
        </div>
        <label
          class="term-log absolute inset-0 block cursor-text overflow-y-auto overscroll-contain px-4 pt-3 pb-3"
          for="term-input"
        >
          <div class="flex min-h-full flex-col justify-end gap-1 font-mono text-[0.8125rem] leading-relaxed">
            {/* aria-busy while streaming: the answer is announced once, whole. */}
            <div
              class="flex flex-col gap-1"
              aria-live="polite"
              aria-busy={convo.phase === "answering"}
            >
              {renderGroups(lines.items).map((g, i) =>
                g.live ? (
                  <pre
                    class={`m-0 wrap-anywhere whitespace-pre-wrap ${LINE_CLASS.ai}`}
                    data-kind="ai"
                    key={i}
                  >
                    <Streaming text={partial} />
                  </pre>
                ) : g.kind === "art" ? (
                  /*
                   * An img: box-drawing glyphs read aloud are noise, and the
                   * box must take focus to scroll by keyboard (WCAG 2.1.1).
                   */
                  <pre
                    class={`m-0 ${LINE_CLASS.art}`}
                    role="img"
                    aria-label="Architecture diagram, drawn in text. It is described in the detail below."
                    tabIndex={0}
                    key={i}
                  >
                    {g.text}
                  </pre>
                ) : (
                  <pre
                    class={`m-0 wrap-anywhere whitespace-pre-wrap ${LINE_CLASS[g.kind]}`}
                    style={g.kind === "ai" ? undefined : hang(g)}
                    data-kind={g.kind}
                    key={i}
                  >
                    {/* `in` and `err` echo the visitor's text: never a link. */}
                    {g.kind === "ai"
                      ? prose(g.text, KNOWN_HREFS)
                      : g.kind === "hint"
                        ? hintText(g.text, g.cmds, typeIn)
                        : g.kind === "out"
                          ? links(g.text)
                          : g.kind === "in"
                            ? echo(g.text)
                            : g.text}
                    {g.link && (
                      <>
                        {" "}
                        <a
                          href={g.link.href}
                          target="_blank"
                          rel="noopener"
                          class={LINK_CLASS}
                        >
                          {g.link.text}
                          <span class="sr-only"> (opens in a new tab)</span>
                        </a>
                      </>
                    )}
                  </pre>
                ),
              )}
            </div>

            {/* Not a <pre>: stickToBottom counts those. Outside the live region,
                whose aria-busy would hold the note back. */}
            <div class="term-pending text-muted items-center gap-3">
              <Wire />
              <span role="status" class="text-[0.6875rem] leading-snug">
                {convo.note}
              </span>
            </div>
          </div>
        </label>
      </div>

      {pick.open && (
        <div class="px-3 pt-1 pb-3 sm:px-4">
          <ThemePick
            state={pick}
            onClose$={closePick}
            onMove$={$(() => feedback("key"))}
          />
        </div>
      )}

      <div class="px-3 pt-1 sm:px-4" hidden={pick.open}>
        <div class="term-composer flex items-center gap-2 rounded-xl px-3 py-2.5">
          <span class="text-accent shrink-0 font-mono text-[0.8125rem]">
            {PROMPT}
          </span>
          <input
            id="term-input"
            type="text"
            spellcheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="Ask about Aman's work"
            // Its own name: the <label> above wraps the whole log, and would
            // otherwise make every line of output the field's name.
            aria-label="Ask about Aman's work, or type a command"
            /*
             * 16px on phones: iOS Safari zooms on focus of a smaller input,
             * and capping maximum-scale instead would fail WCAG 1.4.4.
             */
            class="text-text placeholder:text-muted min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-base focus:outline-none sm:text-[0.8125rem]"
            onKeyDown$={[keyGuard, onKeyDown]}
          />
          <span
            class="text-muted hidden shrink-0 font-mono text-[0.6875rem] sm:inline"
            aria-hidden="true"
          >
            enter ↵
          </span>
        </div>
      </div>

      <div
        role="group"
        aria-labelledby="term-suggest"
        aria-busy={convo.phase === "suggesting"}
        onPointerMove$={pointerMoved}
        hidden={pick.open}
        class="flex flex-wrap content-start items-center gap-x-2 gap-y-1.5 px-3 pt-2 pb-3 sm:px-4"
      >
        {/* As wide as the face, so the chips stay put when it takes over. */}
        <span
          id="term-suggest"
          class={`shrink-0 font-mono text-[0.6875rem] transition-colors duration-150 ${convo.phase === "answering" ? "text-muted/45" : "text-muted"}`}
          style={`width:${FACE_COLS}ch`}
        >
          {convo.phase === "suggesting" ? (
            <>
              <Face />
              <span class="sr-only">Try</span>
            </>
          ) : (
            "Try"
          )}
        </span>
        {/* By slot, so a clicked button keeps focus as its text changes. */}
        {chipSlots(convo.asks, convo.landed, convo.phase).map(
          ({ q, open }, i) => (
            <button
              type="button"
              key={i}
              aria-disabled={open ? undefined : "true"}
              onClick$={[clickGuard, $(() => suggest(q))]}
              class={q ? CHIP : `${CHIP} min-w-14 border-dashed`}
            >
              {q ? (
                convo.landed.includes(q) ? (
                  <span class="term-typed" style={`--len:${q.length}`}>
                    {q}
                  </span>
                ) : (
                  q
                )
              ) : (
                <span class="sr-only">Being written</span>
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
});
