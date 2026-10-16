import { component$, useSignal, useStore, $, sync$, Slot } from "@qwik.dev/core";
import { haptic } from "./haptics";
import { sound, isMuted, setMuted, type Tone } from "./sounds";
import { load as loadHistory, save as saveHistory } from "./history";
import { run, completions, ASK, type Line } from "./commands";
import { abortChat, sendChat, type Outcome, type Turn } from "./chat";
import { KNOWN_HREFS } from "~/content/chat";
import { profile } from "~/content/profile";

/**
 * An interactive shell. The command registry lives in `commands.ts`.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS COSTS NOTHING UNTIL SOMEONE USES IT
 *
 * The whole frame — chrome, prompt, intro line — is server-rendered HTML. On
 * first paint it is text and CSS, no JavaScript at all, so it costs no
 * hydration and no layout shift, and a crawler reads the intro as content.
 *
 * Every handler is a `$()` QRL, which Qwik compiles into its own bundle
 * referenced from the DOM by attribute. Nothing is fetched until an actual
 * event fires. `commands.ts` and `haptics.ts` are separate modules for the same
 * reason: they are only reachable through a handler, so they only download once
 * someone types.
 *
 * Deliberately NOT used:
 *   - `useVisibleTask$`, which would run on load and defeat the entire point.
 *   - autofocus, which would drag a phone keyboard up on page load and hijack
 *     the scroll position of a page nobody has read yet.
 *
 * Per the repo's Qwik guidance: no eager tasks, state in signals, computation
 * out of the component body.
 * ---------------------------------------------------------------------------
 */

/** The only line before the first question, which removes it. */
const INTRO: Line = {
  kind: "hint",
  text: "Type a question, or `help` for the commands.",
};

const PROMPT = "~ $";

/** Shown under the shell, so nobody has to guess. */
const SUGGESTIONS = [
  "What is he working on?",
  "What's his stack?",
  "How does this chat work?",
];

/** Under the h1: who, and the tagline's first sentence. */
const BYLINE = `${profile.name} · ${profile.tagline.slice(0, profile.tagline.indexOf(".") + 1)}`;

/** Matches the Worker's cap, so the visitor hears it here first. */
const MAX_CHAT_CHARS = 800;

/** After this long with no answer, say why: the model is probably loading. */
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

/** The caption under an answer: which model, where, how fast. */
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

/** Styling per line kind, so the render stays a lookup rather than a branch. */
const LINE_CLASS: Record<Line["kind"], string> = {
  in: "text-text",
  out: "text-muted",
  // --sem-danger, not the raw #e0715c this used to carry. That hex is 3.01:1
  // on the light ground -- error text below the 4.5:1 bar, and invisible to
  // `pnpm run verify`, which can only see colours that are tokens.
  err: "text-danger",
  hint: "text-accent",
  // Diagrams must not wrap — a re-flowed box drawing is unreadable — so this
  // is the one kind that scrolls its container instead.
  art: "text-muted/85 scroll-cue whitespace-pre overflow-x-auto",
  ai: "text-text",
  meta: "text-muted text-[0.6875rem] leading-snug",
};

const MUTE_BTN_ID = "term-mute";

/**
 * What actually gets rendered, after consecutive diagram lines are merged.
 *
 * ---------------------------------------------------------------------------
 * ONE SOURCE OF TRUTH, BECAUSE stickToBottom COUNTS THESE
 *
 * stickToBottom waits until the DOM holds as many <pre> elements as it was
 * told to expect, which is how it knows Qwik's render has landed. The instant
 * a run of `art` lines collapses into a single <pre>, "one line, one <pre>"
 * stops being true and any output containing a diagram would never reach the
 * expected count — the loop would burn every attempt and give up, silently
 * un-sticking exactly the command that most needs it.
 *
 * So the grouping is a pure function and BOTH the render and the callers of
 * stickToBottom go through it. They cannot drift.
 * ---------------------------------------------------------------------------
 */
export type Group = {
  kind: Line["kind"];
  text: string;
  link?: Line["link"];
  live?: Line["live"];
};

export function renderGroups(items: Line[]): Group[] {
  const groups: Group[] = [];
  for (const l of items) {
    const prev = groups[groups.length - 1];
    // A diagram is one picture, not N independent lines — see the render.
    if (l.kind === "art" && prev?.kind === "art") {
      prev.text += `\n${l.text}`;
    } else {
      groups.push({ kind: l.kind, text: l.text, link: l.link, live: l.live });
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
 * Split a line into plain text and links.
 *
 * The shell prints an email address and a repo URL and, until now, printed
 * them as inert text — the one place the whole thing asks you to make contact
 * and it could not be clicked.
 *
 * Only `https?://` and bare email addresses match, so there is no shape of
 * input that produces a `javascript:` href. Content is Qwik JSX rather than
 * innerHTML, so the text is escaped regardless; the narrow pattern is about
 * not manufacturing a dangerous URL in the first place.
 *
 * Trailing punctuation is pushed back into the text: `wrap()` sets prose, and
 * prose ends sentences with a full stop hard against the URL it just quoted.
 */
const LINK =
  /(?:https?:\/\/[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** The longest string every candidate starts with — what Tab extends to. */
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

/**
 * Retry `fn` on a short timer until it reports success, or the tries run out.
 *
 * Qwik schedules rendering, so after a signal write there is no synchronous
 * moment at which the new DOM exists. `useTask$` runs BEFORE render, and
 * `useVisibleTask$` — which runs after — is banned in this file because it
 * fires on load and would defeat the lazy-loading design. So the new node has
 * to be waited for.
 *
 * Timers, not requestAnimationFrame: rAF does not fire in a background tab,
 * so a rAF loop silently never retries there. Zero delay, because the wait
 * is on Qwik's render flush, which lands on a task, not on a repaint.
 *
 * `fn` returns true when it has done its job, so a found-and-handled element
 * stops the loop rather than burning every attempt.
 */
function untilDone(fn: () => boolean, tries = 30) {
  if (tries <= 0) return;
  setTimeout(() => {
    if (!fn()) untilDone(fn, tries - 1);
  }, 0);
}

/**
 * Keep the prompt in view after output is appended.
 *
 * The body is a scroller, so output always has an edge to fall past. Measured before this existed: `k describe projects gpu-autoscaler`
 * left scrollHeight 931 against clientHeight 517 with scrollTop still 0,
 * putting the prompt 378px below the bottom edge — typing somewhere you cannot
 * see.
 *
 * IT WAITS FOR THE NODES, NOT FOR A DURATION, AND THAT DISTINCTION IS THE
 * WHOLE FUNCTION. The previous version settled when a scroll-to-bottom left
 * scrollTop where it already was, on the theory that an unchanged position
 * means the new lines have rendered and been scrolled past. It does not: an
 * element whose content has NOT yet arrived is not overflowing, so scrollTop
 * is pinned at 0, so setting it to scrollHeight leaves it at 0 — "unchanged",
 * and the loop declares success against an empty buffer. That only ever looked
 * correct because the poll interval happened to be 16ms, which was usually
 * longer than Qwik's flush. Dropping the interval to 0 for the maximise fix
 * exposed it immediately: `k describe projects gpu-autoscaler` came back with
 * scrollHeight 931 against clientHeight 384 and scrollTop still 0.
 *
 * The caller knows exactly how many elements the buffer should render as, via
 * renderGroups — which is NOT the same as the number of lines, because a run
 * of diagram lines collapses into one <pre>. Counting them is a direct
 * question about whether the render has landed, with no timing assumption in
 * it at all. Every call site goes through renderGroups for that reason.
 *
 * Two passes, not one: an `art` line can grow a horizontal scrollbar as it
 * lays out, which changes scrollHeight after the count is already satisfied.
 *
 * Module-level rather than a closure: a plain function captured by a `$()`
 * handler would have to be serialisable, and this one touches only the DOM.
 */
function stickToBottom(lineCount: number) {
  let scrolled = false;
  untilDone(() => {
    const body = document.querySelector<HTMLElement>("[data-shell] label");
    if (!body) return false;
    // The render has not landed until every line in the buffer is a node.
    if (body.querySelectorAll("pre").length < lineCount) return false;
    body.scrollTop = body.scrollHeight;
    const done = scrolled;
    scrolled = true;
    return done;
  });
}

/**
 * The live body's width in characters, for `run` to lay output out to. A
 * phone is about 40, so output padded for 68 would otherwise wrap mid-column.
 */
function shellColumns(): number {
  const body = document.querySelector<HTMLElement>("[data-shell] label");
  if (body) {
    const prompt = body.querySelector("#term-input")?.previousElementSibling;
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

/**
 * Follow a streaming answer down, but only if the reader is already at the
 * bottom. stickToBottom cannot do this: it waits for a <pre> count, and a
 * streaming answer grows one <pre> without adding any.
 */
function followIfPinned() {
  const body = document.querySelector<HTMLElement>("[data-shell] label");
  if (!body) return;
  if (body.scrollHeight - body.scrollTop - body.clientHeight > 32) return;
  setTimeout(() => (body.scrollTop = body.scrollHeight), 0);
}

/**
 * Clear the busy flag that keyGuard set synchronously on Enter.
 *
 * Plain DOM rather than a signal, because the thing that SET it could not use
 * a signal — see keyGuard.
 */
function clearBusy() {
  document.querySelector("[data-shell]")?.removeAttribute("data-busy");
}

export const Terminal = component$(() => {
  const lines = useStore<{ items: Line[] }>({ items: [INTRO] });
  /** The answer while it streams; see converseInner. */
  const partial = useSignal("");
  const value = useSignal("");

  /*
   * Whether the shell is muted, for the toggle's ICON only.
   *
   * Never the source of truth — sounds.ts reads the persisted value at play
   * time, so a returning visitor who muted us is silent from the first
   * keystroke regardless of what this says. It starts false because that is
   * what the server rendered, and it is reconciled by `feedback` below on the
   * first interaction of any kind. See the persistence note in sounds.ts.
   */
  const muted = useSignal(false);

  /*
   * Completion-cycling state. `last` is what the input held after the previous
   * Tab: if the value still matches, the user has pressed Tab again without
   * typing, and the run continues from `base` rather than restarting from
   * whatever the cycling itself just wrote into the field.
   */
  const tab = useStore({ base: "", last: "", i: -1, armed: false });

  /**
   * The conversation. `turns` is sent with each question; the server keeps
   * nothing. `note` explains a long wait while it is happening. Declared
   * above every QRL that reads it — see the note on cmdHistory for why the
   * order matters.
   */
  const convo = useStore<{ streaming: boolean; turns: Turn[]; note: string }>({
    streaming: false,
    turns: [],
    note: "",
  });

  /*
   * DECLARED BEFORE ensureHistory, AND THE ORDER IS LOAD-BEARING.
   *
   * A `$()` body is extracted into its own module with its captured scope
   * passed in, and the optimizer works out what to capture from the bindings
   * that exist ABOVE it. This store used to sit below ensureHistory, so the
   * capture silently missed it and the emitted QRL read:
   *
   *   const t=await de(); t.length&&(history.past=[...t,...history.past])
   *
   * `recalled`, declared above, became `c[0]`. `history` stayed a free
   * identifier — and since it was then named `history`, it resolved to
   * `window.history` rather than throwing, so the merge wrote into the
   * History API and read `undefined` back. Nothing surfaced it; the stored
   * history was simply overwritten by the first command after a reload.
   *
   * Two rules came out of that, both cheap to keep: declare state above any
   * QRL that touches it, and never name captured state after a browser global
   * (history, location, name, status, origin, top, closed), because that is
   * what turns a missed capture from a loud ReferenceError into silence.
   */
  const cmdHistory = useStore<{ past: string[]; cursor: number }>({
    past: [],
    cursor: -1,
  });

  /** Whether stored history has been merged in yet. See ensureHistory. */
  const recalled = useSignal(false);

  /**
   * Pull history out of storage, once, before it is read from or written to.
   *
   * The ordering is the whole point: `submit` pushes onto `cmdHistory.past` and
   * saves it, so if that ran before the load, the first command of a reloaded
   * session would save a one-item array over everything that came before.
   */
  /*
   * NAMED cmdHistory, NOT history, AND THAT IS NOT A STYLE PREFERENCE.
   *
   * This store was called `history`. In-session recall worked, so it looked
   * fine — but `history` is a browser global, and the Qwik optimizer, which
   * rewrites every `$()` body into a standalone module with its captured
   * scope passed in as an array, silently declined to capture it. The emitted
   * ensureHistory read:
   *
   *   const e=c[0]; if(e.value)return; e.value=!0;
   *   const t=await de(); t.length&&(history.past=[...t,...history.past])
   *
   * `recalled` became `c[0]`; `history` stayed a bare identifier and resolved
   * to `window.history`. So the merge wrote to the History API, read
   * `undefined`, and threw inside a handler where nothing surfaced it — the
   * stored history was then overwritten by the first command of the new page.
   * The capture happened to succeed in the older handlers, which is why this
   * only appeared when a new QRL touched the same store.
   *
   * Anything sharing a name with a global — history, location, name, status,
   * origin, top, closed — is a candidate for the same silent failure. Do not
   * name captured state after one.
   */
  const ensureHistory = $(async () => {
    if (recalled.value) return;
    recalled.value = true;
    const stored = await loadHistory();
    if (stored.length) cmdHistory.past = [...stored, ...cmdHistory.past];
  });

  /**
   * One tick of feedback: audible, tactile, and self-correcting.
   *
   * Both channels are additive and both are absent somewhere — vibrate does
   * not exist on iOS or desktop, audio is off if the visitor muted it — which
   * is why every action they accompany also changes something visible.
   *
   * Assigning the return value is what reconciles the mute icon with storage,
   * on whatever the first interaction happens to be.
   */
  const feedback = $(async (tone: Tone) => {
    muted.value = await sound(tone);
    await haptic(tone === "chrome" ? "key" : tone);
  });

  /** One question, streamed into an `ai` line created by the first token. */
  const converseInner = $(async (text: string) => {
    const say = (more: Line[]) => {
      lines.items = [...lines.items, ...more];
      stickToBottom(renderGroups(lines.items).length);
    };

    if (text.length > MAX_CHAT_CHARS) {
      return say([
        {
          kind: "err",
          text: `Keep it under ${MAX_CHAT_CHARS} characters, please.`,
        },
      ]);
    }

    const turns: Turn[] = [
      ...convo.turns,
      { role: "user" as const, content: text },
    ].slice(-8);
    convo.streaming = true;
    await feedback("enter");

    /*
     * No empty answer line up front: it would sit as a blank row between the
     * question and the pending dots. The line appears with its first word.
     */
    let answer: Line | null = null;
    let got = "";
    /*
     * The streaming text goes to `partial`, which the transcript renders as
     * one bound text node, and reaches the store once, at the end. Written
     * into the store per token, it re-ran the whole shell per token: 202
     * renders for a 200-token answer, 811 ms of script at 4x CPU with 187
     * lines on screen, against 74 ms this way (rc.3, 2026-10-14).
     */
    const slow = setTimeout(() => {
      convo.note = "cold start, ~20s";
    }, SLOW_MS);
    let outcome: Outcome;
    try {
      outcome = await sendChat(turns, (t) => {
        got = (got + t).trimStart();
        if (!got) return;
        // The prompt asks for plain text and "-" lists; gpt-oss uses
        // asterisks for emphasis and bullets anyway.
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
      });
    } finally {
      clearTimeout(slow);
      convo.note = "";
      // Before aria-busy drops, so the finished answer is announced once.
      const done = answer as Line | null;
      if (done) {
        done.text = partial.value;
        done.live = false;
      }
      convo.streaming = false;
    }

    if (outcome.ok) {
      convo.turns = [...turns, { role: "assistant" as const, content: got }];
      say([{ kind: "meta", text: statsLine(outcome) }]);
    } else if (outcome.code !== "aborted") {
      say(chatError(outcome.code));
      await feedback("error");
    } else if (got) {
      // Otherwise a half answer reads as the model losing its train of thought.
      say([{ kind: "meta", text: "stopped" }]);
    }
  });

  const converse = $(async (text: string) => {
    try {
      await converseInner(text);
    } finally {
      // Every path out, including the early returns and a throw.
      clearBusy();
    }
  });

  /**
   * Run one line, typed or picked from the suggestions. The shell decides per
   * line whether it is a command or a question; there is no mode to enter.
   */
  const runLine = $(async (raw: string) => {
    // finally, not a tail call: every early return has to clear the busy
    // dots, and a throw must not leave them running forever.
    let handedOff = false;
    try {
      const shown =
        lines.items[0]?.text === INTRO.text
          ? lines.items.slice(1)
          : lines.items;
      lines.items = [...shown, { kind: "in", text: `${PROMPT} ${raw}` }];
      if (raw.trim()) {
        // Before the push, never after — see ensureHistory.
        await ensureHistory();
        cmdHistory.past = [...cmdHistory.past, raw];
        cmdHistory.cursor = -1;
        await saveHistory(cmdHistory.past);
      }

      const result = run(raw, shellColumns());
      if (result === ASK) {
        /*
         * NOT awaited. Qwik runs an element's handlers one at a time, so
         * awaiting the stream here held every later keydown — Ctrl+C
         * included — until the answer had finished. converse clears the
         * busy dots itself.
         */
        handedOff = true;
        void converse(raw.trim());
        return;
      }
      if (result === null) {
        // `clear`. What is on screen is what the model knows, so the
        // conversation goes with the buffer.
        lines.items = [];
        convo.turns = [];
        await feedback("enter");
        return;
      }

      lines.items = [...lines.items, ...result];
      stickToBottom(renderGroups(lines.items).length);
      await feedback(result.some((l) => l.kind === "err") ? "error" : "enter");
    } finally {
      if (!handedOff) clearBusy();
    }
  });

  const submit = $(async () => {
    // One answer at a time. What they typed stays in the field.
    if (convo.streaming) return;
    const raw = value.value;
    value.value = "";
    await runLine(raw);
  });

  /**
   * A suggestion is asked exactly as if it had been typed. The row stays put
   * afterwards, so the button keeps focus rather than vanishing from under it.
   */
  const suggest = $(async (q: string) => {
    if (convo.streaming) {
      clearBusy();
      return;
    }
    await runLine(q);
  });

  /**
   * Enter submits; up/down walk history, the way a real shell does.
   *
   * No `preventDefault()` anywhere, and that is deliberate rather than an
   * omission. A Qwik handler is lazily fetched, so by the time an async one
   * runs the event has already been dispatched and preventDefault is a no-op —
   * eslint's `qwik/no-async-prevent-default` flags exactly this. Qwik's
   * alternative is the `preventdefault:keydown` attribute, but that is
   * all-or-nothing for the event: on a text input it would block every
   * character from being inserted, i.e. break typing entirely.
   *
   * So the design avoids needing it. Enter on an input outside a <form> has no
   * default action to suppress, and the arrows' default — jumping the caret to
   * either end — is harmless when the value is being replaced on the same
   * keystroke.
   */
  const onKeyDown = $(async (e: KeyboardEvent) => {
    /*
     * Any key that is not Tab ends a completion run. Done unconditionally at
     * the top rather than in each branch, so a new exit path cannot forget it
     * and leave the next Tab cycling a stale candidate list.
     */
    if (e.key !== "Tab") tab.armed = false;

    if (e.key === "Enter") {
      await submit();
      return;
    }

    /*
     * Ctrl+L clears, Ctrl+C abandons the line. Both are pure muscle memory for
     * anyone who has used a shell, and both were previously handled by the
     * browser instead: Ctrl+L focuses the address bar, which is a spectacular
     * thing to happen when you meant to tidy your screen. tabGuard suppresses
     * them; this half does the work.
     */
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "l") {
        // Same rule as `clear`: the conversation goes with the screen.
        lines.items = [];
        convo.turns = [];
        await feedback("enter");
        return;
      }
      if (k === "c") {
        /*
         * Ctrl+C is COPY when there is a selection, and nothing this shell
         * does is worth breaking that. Only when nothing is selected does it
         * mean what it means in a terminal.
         */
        if (window.getSelection()?.toString()) return;
        // Mid-answer, ^C stops the model, as it does in `ollama run`.
        if (abortChat()) {
          await feedback("error");
          return;
        }
        lines.items = [
          ...lines.items,
          { kind: "in", text: `${PROMPT} ${value.value}^C` },
        ];
        value.value = "";
        cmdHistory.cursor = -1;
        stickToBottom(renderGroups(lines.items).length);
        await feedback("error");
        return;
      }
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Recall may still be on disk. Load before the first read, not after.
      await ensureHistory();
      if (cmdHistory.past.length === 0) return;
      const next =
        e.key === "ArrowUp"
          ? Math.min(cmdHistory.cursor + 1, cmdHistory.past.length - 1)
          : Math.max(cmdHistory.cursor - 1, -1);
      cmdHistory.cursor = next;
      value.value = next === -1 ? "" : (cmdHistory.past.at(-1 - next) ?? "");
      return;
    }

    /*
     * Tab completes. See tabGuard below for how the default gets suppressed;
     * this half only does the completing.
     *
     * Shift+Tab is explicitly not completion — it is the only way back out of
     * the input for a keyboard user, and tabGuard lets it through.
     *
     * THREE BEHAVIOURS, WHICH IS WHAT A REAL SHELL DOES. It used to have one:
     * print the candidates and stop, leaving you to type the rest by hand.
     *
     *   1. One match — complete it.
     *   2. Many matches that share more prefix than you typed — extend to that
     *      common prefix. `k des` becomes `k describe` without a list, because
     *      there was never a choice to make.
     *   3. Many matches, nothing more in common — print them, then cycle
     *      through them on each further Tab.
     */
    if (e.key === "Tab") {
      if (e.shiftKey) return;

      const continuing = tab.armed && value.value === tab.last;
      const base = continuing ? tab.base : value.value.trimStart();
      if (!base) return;

      const matches = completions().filter((c) => c.startsWith(base));
      if (matches.length === 0) return;

      if (matches.length === 1) {
        value.value = matches[0]!;
        tab.armed = false;
        await feedback("key");
        return;
      }

      if (continuing) {
        tab.i = (tab.i + 1) % matches.length;
        value.value = matches[tab.i]!;
        tab.last = value.value;
        await feedback("key");
        return;
      }

      const common = commonPrefix(matches);
      if (common.length > base.length) {
        value.value = common;
        tab.armed = false;
        await feedback("key");
        return;
      }

      // Bash prints the candidates rather than guessing. Then it lets you
      // walk them.
      lines.items = [
        ...lines.items,
        { kind: "in", text: `${PROMPT} ${base}` },
        ...matches.map((m) => ({ kind: "out" as const, text: `  ${m}` })),
      ];
      stickToBottom(renderGroups(lines.items).length);
      tab.base = base;
      tab.i = -1;
      tab.last = value.value;
      tab.armed = true;
      return;
    }

    /*
     * A tick per keystroke, but not for modifiers or navigation — and not for
     * chords. Ctrl+A and friends have `key.length === 1` too, and a shortcut
     * that clicks at you is a bug you only notice once sound is on.
     */
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      await feedback("key");
    }
  });

  /**
   * Mute toggle.
   *
   * Reads the persisted value rather than inverting the local signal, because
   * that signal is only an icon hint and may not yet have been reconciled —
   * inverting a stale `false` on a muted visitor's first click would leave
   * them muted while the icon claimed otherwise.
   *
   * Unmuting plays its own confirmation, which is the only honest way to
   * report that sound is back on.
   */
  const toggleMute = $(async () => {
    const next = !(await isMuted());
    muted.value = next;
    await setMuted(next);
    // setMuted writes to localStorage, and a visitor is told so when it does.
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
   * Suppress Tab's default, and ONLY Tab's, and only when it would complete.
   *
   * The async handler above cannot do this. A Qwik handler is fetched lazily,
   * so by the time it runs the event has been dispatched and preventDefault is
   * a no-op — eslint's `qwik/no-async-prevent-default` flags exactly that. The
   * previous comment here claimed the input carried `preventdefault:keydown`;
   * it never did, so Tab both completed the command AND blurred the field.
   * That attribute would not have worked anyway: it is all-or-nothing for the
   * event, so on a text input it would block every character from being
   * inserted.
   *
   * `sync$` is the mechanism that fits — a QRL serialised into the HTML as a
   * string and run synchronously, before the default. The cost is that it can
   * capture nothing from this scope, which is why it reads its condition off
   * the event and the element rather than off a signal.
   *
   * THE TWO CONDITIONS ARE BOTH ESCAPE HATCHES, NOT POLISH. `e.key` is "Tab"
   * for Shift+Tab too, so an unconditional preventDefault would trap a
   * keyboard user in the input with no way out — a WCAG 2.1.2 failure, and a
   * worse bug than the one being fixed. Shift+Tab always leaves; so does Tab
   * on an empty input, where there is nothing to complete anyway.
   *
   * It also claims Ctrl+L and Ctrl+C, which the shell now implements. Each is
   * conditional for the same reason: Ctrl+C must remain copy when text is
   * selected, and neither may fire with Shift held, because Ctrl+Shift+C is
   * how a developer opens devtools on this page.
   */
  const keyGuard = sync$((e: KeyboardEvent, el: HTMLInputElement) => {
    /*
     * Mark the shell busy the instant Enter is pressed.
     *
     * THIS CANNOT BE DONE FROM THE ASYNC HANDLER, and that is the entire
     * reason it lives in a sync$. The gap being covered IS the gap before the
     * async handler exists: on the first command of a page, pressing Enter
     * starts Qwik resuming the container, fetching handler bundles, and
     * rendering, and nothing on screen moves until all of that finishes. Any
     * indicator set inside that handler would appear only once the wait was
     * already over.
     *
     * A sync$ body is serialised into the HTML and run straight from
     * qwikloader with no fetch and no resume, so it paints in the same tick as
     * the keypress. It cannot touch signals, hence a DOM attribute; runLine()
     * clears it in a finally.
     *
     * Preloading the bundles would not have fixed this. Measured on the built
     * output, the first command pulls 8 files totalling 32 kB — the bytes are
     * not the wait.
     */
    if (e.key === "Enter" && el.value.trim() !== "") {
      el.closest("[data-shell]")?.setAttribute("data-busy", "");
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && el.value.trim() !== "") {
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    // Ctrl+L is the browser's address bar. The shiftKey bail above is not
    // optional: Ctrl+Shift+C opens devtools on this very page.
    if (k === "l") {
      e.preventDefault();
      return;
    }
    // Ctrl+C stays copy whenever there is something to copy.
    if (k === "c" && !window.getSelection()?.toString()) {
      e.preventDefault();
    }
  });

  /** keyGuard's busy mark, for a suggestion clicked instead of Enter. */
  const clickGuard = sync$((_: MouseEvent, el: HTMLElement) => {
    el.closest("[data-shell]")?.setAttribute("data-busy", "");
  });

  return (
    <div
      class="glass flex h-[max(30rem,calc(100svh_-_8rem))] flex-col overflow-hidden rounded-2xl"
      data-shell
    >
      <div class="border-line/60 flex items-center gap-2 border-b py-1.5 pr-3 pl-4">
        <span class="text-muted font-mono text-xs" aria-hidden="true">
          aman@desk: ~
        </span>
        {/*
         * Mute. Sound ships ON, so the control that turns it off has to be
         * findable without hunting — hence a permanent button in the chrome.
         *
         * It relabels itself rather than toggling aria-pressed, matching every
         * other control here: the name states what pressing it will do.
         */}
        <button
          type="button"
          id={MUTE_BTN_ID}
          onClick$={toggleMute}
          title="Sound on or off. Remembered on this device."
          class="hover:bg-text/10 text-muted ml-auto grid size-6 place-items-center rounded-full transition duration-150 active:scale-90"
        >
          <span class="sr-only">
            {muted.value ? "Unmute shell sounds" : "Mute shell sounds"}
          </span>
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
            {muted.value ? (
              <path d="M11 6.5l3 3M14 6.5l-3 3" />
            ) : (
              <path d="M11 6a3 3 0 010 4" />
            )}
          </svg>
        </button>
      </div>

      <div class="px-4 pt-4 font-mono text-[0.8125rem] leading-relaxed">
        <h1 class="text-text m-0 font-mono text-[0.8125rem] leading-relaxed font-normal tracking-normal">
          {profile.motd}
        </h1>
        <p class="text-muted m-0">{BYLINE}</p>
      </div>

      <div class="relative min-h-0 flex-1">
        <div class="desk-slot">
          <Slot name="idle" />
        </div>
        <label
          class="absolute inset-0 block cursor-text overflow-y-auto overscroll-contain px-4 pt-2 pb-3"
          for="term-input"
        >
          <span class="sr-only">Terminal input</span>

          <div class="flex min-h-full flex-col justify-end gap-1 font-mono text-[0.8125rem] leading-relaxed">
            {/*
             * The live region wraps the OUTPUT only. It used to wrap the prompt
             * row as well, which put an editable text field inside a region the
             * screen reader re-reads on every append — so each command echoed
             * the input back alongside its result.
             */}
            {/*
             * aria-busy while an answer streams, so a screen reader announces
             * the finished answer once instead of every fragment of it.
             */}
            <div
              class="flex flex-col gap-1"
              aria-live="polite"
              aria-busy={convo.streaming}
            >
              {renderGroups(lines.items).map((g, i) =>
                g.live ? (
                  <pre
                    class={`m-0 wrap-anywhere whitespace-pre-wrap ${LINE_CLASS.ai}`}
                    key={i}
                  >
                    {partial.value}
                  </pre>
                ) : g.kind === "art" ? (
                  /*
                   * A diagram, as ONE element rather than one per line.
                   *
                   * Two bugs died with that change. Visually, each line used to
                   * be its own `overflow-x-auto` box, so scrolling a wide
                   * diagram sideways moved a single row and sheared the picture
                   * apart. And a scroll container that is `aria-hidden` cannot
                   * be given a tabindex without lying, so the only way to reach
                   * it was a pointer — a WCAG 2.1.1 failure, once per line.
                   *
                   * `role="img"` is what resolves it. Box-drawing characters
                   * read as gibberish spelled out glyph by glyph ("box drawings
                   * light down and right…"), so the contents must not be
                   * announced; but the region still has to be focusable to be
                   * scrollable by keyboard. An img with a label is exactly
                   * that: named, reachable, and announced as one thing rather
                   * than mangled. The meaning itself is in the Detail prose
                   * printed directly below.
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
                    style={hang(g)}
                    key={i}
                  >
                    {/*
                     * Only output is linkified. `in` lines echo what was typed
                     * and `err` lines quote it back, so neither should turn a
                     * visitor's own text into a link.
                     */}
                    {g.kind === "out" || g.kind === "hint" || g.kind === "ai"
                      ? linkify(
                          g.text,
                          g.kind === "ai" ? KNOWN_HREFS : undefined,
                        ).map((seg, j) =>
                          seg.href ? (
                            <a
                              href={seg.href}
                              /*
                               * A new tab, which the rest of the site does not
                               * do — every other external link here navigates
                               * in place. The shell is the exception because it
                               * is the only stateful thing on the site: leaving
                               * the page destroys the buffer, so following a
                               * repo link would silently throw away the session
                               * that produced it.
                               *
                               * No `↗` marker, unlike the nav. This sits inside
                               * monospace output where an extra glyph shifts
                               * every column after it; the note is sr-only
                               * instead, which costs no width at all.
                               */
                              target={
                                seg.href.startsWith("http")
                                  ? "_blank"
                                  : undefined
                              }
                              rel="noopener noreferrer"
                              class="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                              key={j}
                            >
                              {seg.text}
                              {seg.href.startsWith("http") && (
                                <span class="sr-only">
                                  {" "}
                                  (opens in a new tab)
                                </span>
                              )}
                            </a>
                          ) : (
                            <span key={j}>{seg.text}</span>
                          ),
                        )
                      : g.text}
                    {/* A new tab for the same reason as the links above:
                     * following it in place would end the session. */}
                    {g.link && (
                      <>
                        {" "}
                        <a
                          href={g.link.href}
                          target="_blank"
                          rel="noopener"
                          class="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
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

            {/*
             * The busy line, where the output is about to land. CSS shows it
             * off `[data-busy]`, which keyGuard sets in the same tick as the
             * keypress — see there for why that cannot be a signal. Not a
             * <pre>: stickToBottom counts those.
             *
             * The note is the one part that speaks. It lives outside the live
             * region above, which is aria-busy while an answer streams and
             * would hold the announcement until the wait was over.
             */}
            <div class="term-pending text-muted items-baseline gap-3">
              <span class="term-dots" aria-hidden="true" />
              <span role="status" class="text-[0.6875rem] leading-snug">
                {convo.note}
              </span>
            </div>

            <div class="mt-1 flex items-center gap-2">
              <span class="text-accent shrink-0 font-mono text-[0.8125rem]">
                {PROMPT}
              </span>
              <input
                id="term-input"
                type="text"
                value={value.value}
                spellcheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                /*
                 * Full opacity, not /50. Placeholder is text and WCAG does not
                 * exempt it: at /50 it measured 2.33:1 against the panel, taken
                 * from rendered pixels rather than token arithmetic — which is a
                 * measurement `pnpm run verify` structurally cannot make, since
                 * it compares --sem-* against --sem-bg only.
                 */
                /*
                 * The first thing a visitor reads, before any JavaScript. At
                 * most 22 characters: it is 16px on a phone (see below), and
                 * a 320px screen cut the 28-character version off mid-word.
                 * The intro says `help`, so this does not have to.
                 */
                placeholder="Ask about Aman's work"
                /*
                 * 16px on phones, 13px from `sm` up, and that is not a taste
                 * call. iOS Safari zooms the page whenever a focused input is
                 * under 16px, so tapping the prompt would scale the whole site
                 * and leave the visitor pinching their way back out. The other
                 * fix — capping maximum-scale in the viewport meta — disables
                 * pinch-zoom outright, which is a WCAG 1.4.4 failure and not
                 * on the table.
                 *
                 * The cost is that the input reads a shade larger than the
                 * output above it on a phone. It sits on its own row after the
                 * prompt, so nothing misaligns.
                 */
                class="text-text placeholder:text-muted min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-base focus:outline-none sm:text-[0.8125rem]"
                onInput$={(_, el) => (value.value = el.value)}
                /* Sync guard first: it must run before the default, and before
                 * the lazily-fetched async handler below. */
                onKeyDown$={[keyGuard, onKeyDown]}
              />
            </div>
          </div>
        </label>
      </div>

        <div
          role="group"
          aria-labelledby="term-suggest"
          class="border-line/60 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t px-4 py-2.5"
        >
          <span id="term-suggest" class="text-muted font-mono text-[0.6875rem]">
            Try asking
          </span>
          {SUGGESTIONS.map((q) => (
            <button
              type="button"
              key={q}
              onClick$={[clickGuard, $(() => suggest(q))]}
              class="border-line text-muted hover:text-text hover:border-muted min-h-6 rounded-full border px-2.5 font-mono text-[0.6875rem] transition-colors duration-150"
            >
              {q}
            </button>
          ))}
        </div>
    </div>
  );
});
