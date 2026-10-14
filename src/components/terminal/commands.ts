import {
  achievements,
  education,
  profile,
  projects,
  roles,
  skills,
} from "~/content/profile";

/**
 * The command registry.
 *
 * ---------------------------------------------------------------------------
 * Everything reads from src/content/profile.ts, the same source the pages
 * render. That is the point: the shell is another view of the site's content,
 * not a second copy of it that can drift.
 *
 * Handlers are pure functions returning lines. No component imports, no
 * signals, no DOM — so adding a command never needs to know how the terminal
 * renders, and this whole module stays in a bundle that is only fetched once
 * somebody actually types.
 *
 * The grammar is kubectl's on purpose, because the audience already has it in
 * muscle memory: `k get <resource>`, `k describe <resource> <name>`, columns
 * padded into a table, and an unknown resource answered the way the real thing
 * answers it.
 * ---------------------------------------------------------------------------
 */

export type Line = {
  /**
   * `art` is ASCII diagram content. It renders monospaced and un-wrapped, as
   * one labelled `role="img"`: box-drawing characters read aloud are noise, so
   * the meaning is carried in the `detail` prose that accompanies it.
   *
   * `ai` is a model's answer. It differs from `out` in what may become a link.
   *
   * `meta` is the caption under an answer: where it ran and how fast.
   */
  kind: "in" | "out" | "err" | "hint" | "art" | "ai" | "meta";
  text: string;
  /** A link printed after the text, for paths linkify cannot see (`/privacy/`). */
  link?: { text: string; href: string };
};

const out = (text: string): Line => ({ kind: "out", text });
const err = (text: string): Line => ({ kind: "err", text });
const hint = (text: string): Line => ({ kind: "hint", text });
const art = (text: string): Line => ({ kind: "art", text });

/* --- formatting ---------------------------------------------------------- */

/**
 * Pad columns to the widest cell, like kubectl.
 *
 * Two spaces of gutter, and the last column is never padded — trailing
 * whitespace is invisible until someone copies the output.
 */
function table(header: string[], rows: string[][]): Line[] {
  const all = [header, ...rows];
  const widths = header.map((_, i) =>
    Math.max(...all.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [out(line(header)), ...rows.map((r) => out(line(r)))];
}

/** Wrap prose so a long paragraph does not force horizontal scrolling. */
function wrap(text: string, width = 68, indent = "  "): Line[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => out(indent + l));
}

/*
 * There was an `age()` helper here that rendered a kubectl-style relative age
 * ("3mo", "2y") for the AGE column and the Updated field. Both are gone, and
 * so is it — see the note on `updated` in profile.ts for why.
 */

/** `key: value` block, aligned, as `kubectl describe` prints it. */
function fields(pairs: Array<[string, string]>): Line[] {
  const w = Math.max(...pairs.map(([k]) => k.length)) + 1;
  return pairs
    .filter(([, v]) => v)
    .map(([k, v]) => out(`${(k + ":").padEnd(w + 1)} ${v}`));
}

/* --- resources ----------------------------------------------------------- */

type Resource = {
  /** Canonical plural, as typed. */
  name: string;
  aliases: string[];
  list: () => Line[];
  describe?: (key: string) => Line[];
};

const RESOURCES: Resource[] = [
  {
    name: "projects",
    aliases: ["project", "proj"],
    list: () =>
      table(
        ["NAME", "SUMMARY"],
        projects.map((p) => [p.slug, p.summary]),
      ),
    describe: (key) => {
      const p = projects.find((x) => x.slug === key);
      if (!p) {
        return [
          err(`projects "${key}" not found`),
          out(`Known: ${projects.map((x) => x.slug).join(", ")}`),
        ];
      }
      return [
        ...fields([
          ["Name", p.slug],
          ["Title", p.title],
          ["Stack", p.stack.join(", ")],
          ["Repo", p.repo ?? "(private)"],
          // Rendered as `out` lines, so the shell linkifies them for free.
          ...(p.links ?? []).map((l) => [l.label, l.href] as [string, string]),
        ]),
        out(""),
        out("Summary:"),
        ...wrap(p.summary),
        out(""),
        ...(p.diagram?.length
          ? [out("Architecture:"), ...p.diagram.map(art), out("")]
          : []),
        out("Detail:"),
        ...p.detail.flatMap((d, i) => (i ? [out(""), ...wrap(d)] : wrap(d))),
      ];
    },
  },
  {
    name: "roles",
    aliases: ["role", "experience", "jobs"],
    list: () =>
      table(
        ["TITLE", "COMPANY", "PERIOD", "WHERE"],
        roles.map((r) => [r.title, r.company, r.period, r.location]),
      ),
    describe: (key) => {
      const i = Number.parseInt(key, 10);
      const r = Number.isFinite(i)
        ? roles[i]
        : roles.find((x) => x.title.toLowerCase().includes(key.toLowerCase()));
      if (!r) {
        return [
          err(`roles "${key}" not found`),
          out("Try an index (0 is most recent) or part of a title."),
        ];
      }
      return [
        ...fields([
          ["Title", r.title],
          ["Company", r.company],
          ["Period", r.period],
          ["Location", r.location],
        ]),
        out(""),
        out("Highlights:"),
        ...r.points.flatMap((pt) => wrap(`- ${pt}`, 68, "  ")),
      ];
    },
  },
  {
    name: "skills",
    aliases: ["skill"],
    list: () =>
      skills.flatMap((g) => [
        out(g.group.toUpperCase()),
        ...wrap(g.items.join(", "), 68, "  "),
        out(""),
      ]),
  },
  {
    name: "achievements",
    aliases: ["achievement", "awards"],
    list: () =>
      achievements.flatMap((a) => [
        out(`- ${a.title}`),
        ...(a.note ? wrap(a.note, 66, "    ") : []),
      ]),
  },
  {
    name: "education",
    aliases: ["edu"],
    list: () =>
      fields([
        ["School", education.school],
        ["Degree", education.degree],
        ["Period", education.period],
        ["Result", education.note],
      ]),
  },
  {
    name: "contact",
    aliases: ["links", "me"],
    list: () =>
      table(
        ["WHERE", "URL"],
        [
          ["email", profile.email],
          ...profile.links.map((l) => [l.label.toLowerCase(), l.href]),
        ],
      ),
  },
];

const findResource = (word: string) =>
  RESOURCES.find((r) => r.name === word || r.aliases.includes(word));

/* --- top-level commands -------------------------------------------------- */

type Command = {
  name: string;
  usage: string;
  summary: string;
  run: (args: string[]) => Line[];
  /** Without this, `help me with…` is a question, not `help`. */
  takesArgs?: boolean;
};

const KUBECTL = new Set(["k", "kubectl"]);

/**
 * The contractions people actually have in their shell profile.
 *
 * `kgp` is kubectl-get-pods to anyone who runs a cluster; here it is
 * kubectl-get-projects. The whole point of borrowing the grammar is that it
 * pays off without being read first, so the aliases have to be the real ones —
 * `kgp`, `kgs`, `kd`, `kdp` — not invented shorthand.
 */
const ALIASES: Record<string, string[]> = {
  kgp: ["get", "projects"],
  kgr: ["get", "roles"],
  kgs: ["get", "skills"],
  kga: ["get", "achievements"],
  kge: ["get", "education"],
  kgc: ["get", "contact"],
  kg: ["get"],
  kd: ["describe"],
  kdp: ["describe", "projects"],
  kdr: ["describe", "roles"],
};

/** `k <verb> ...` — the kubectl-shaped surface. */
function kubectl(args: string[]): Line[] {
  const [verb, resourceWord, ...rest] = args;

  if (!verb) {
    return [
      out("Usage: k <verb> <resource> [name]"),
      out(""),
      out(`Verbs:     get, describe`),
      out(`Resources: ${RESOURCES.map((r) => r.name).join(", ")}`),
      out(""),
      hint("Try: k get projects"),
    ];
  }

  if (verb === "get" || verb === "describe") {
    if (!resourceWord) {
      return [
        err(`You must specify the type of resource to ${verb}.`),
        out(`Valid types: ${RESOURCES.map((r) => r.name).join(", ")}`),
      ];
    }
    const res = findResource(resourceWord.toLowerCase());
    if (!res) {
      // The wording the real client uses, because that is the joke.
      return [
        err(`the server doesn't have a resource type "${resourceWord}"`),
        out(`Valid types: ${RESOURCES.map((r) => r.name).join(", ")}`),
      ];
    }
    if (verb === "get") return res.list();

    if (!res.describe) {
      return [
        err(`"${res.name}" has no describe view — it is a flat list.`),
        out(`Try: k get ${res.name}`),
      ];
    }
    const key = rest[0];
    if (!key) {
      return [
        err(`You must specify a name to describe.`),
        out(`Try: k describe ${res.name} <name>`),
      ];
    }
    return res.describe(key.toLowerCase());
  }

  return [err(`unknown verb "${verb}"`), out("Supported: get, describe")];
}

function registry(): Command[] {
  return [
    {
      name: "help",
      usage: "help",
      summary: "List available commands.",
      run: () => [
        out("Commands:"),
        ...registry().map((c) => out(`  ${c.usage.padEnd(30)} ${c.summary}`)),
        out(""),
        out(`Resources: ${RESOURCES.map((r) => r.name).join(", ")}`),
        out(""),
        out("Aliases (the ones already in your shell profile):"),
        ...Object.entries(ALIASES).map(([a, full]) =>
          out(`  ${a.padEnd(6)} k ${full.join(" ")}`),
        ),
        out(""),
        hint("Start with: kgp, or ask what he is working on."),
      ],
    },
    {
      name: "k",
      usage: "k get|describe <resource>",
      summary: "Query the content, kubectl-style.",
      run: kubectl,
      takesArgs: true,
    },
    {
      name: "whoami",
      usage: "whoami",
      summary: "Who this is.",
      run: () =>
        fields([
          ["Name", profile.name],
          ["Title", profile.jobTitle],
          ["Company", profile.employer?.name ?? ""],
          ["Location", profile.city],
        ]),
    },
    {
      name: "chat",
      usage: "<any question>",
      summary: "Answered by a model running on Aman's desk.",
      run: () => ABOUT_CHAT,
    },
    {
      name: "clear",
      usage: "clear",
      summary: "Start over: clears the screen and the conversation.",
      // The buffer belongs to the shell; declared here so `help` lists it and
      // so it never falls through to "command not found".
      run: () => [],
    },
  ];
}

const ABOUT_CHAT: Line[] = [
  out("Talking to a model running on a GPU on Aman's desk, at home."),
  out("It answers from his CV and can be wrong."),
  {
    kind: "out",
    text: "Chats are kept for 30 days.",
    link: { text: "privacy", href: "/privacy/" },
  },
  hint("There is no mode to enter. Just type a question."),
];

/**
 * Returned by `run` when the line is meant for the model rather than the
 * shell. The shell owns the conversation, so it does the asking.
 */
export const ASK = "ask";

/**
 * Shell verbs a visitor types to poke at the terminal. As the first word of a
 * line they mean "command not found", not a question for the GPU.
 */
const SHELL_VERBS = new Set([
  "cat",
  "cd",
  "curl",
  "echo",
  "exit",
  "git",
  "grep",
  "less",
  "ls",
  "man",
  "mkdir",
  "nano",
  "npm",
  "ps",
  "pwd",
  "rm",
  "ssh",
  "sudo",
  "top",
  "touch",
  "vi",
  "vim",
]);

/** One-word lines that are still conversation. */
const GREETINGS = new Set(["hi", "hello", "hey", "yo", "thanks", "thx"]);

/**
 * Resolve a raw input line to output.
 *
 * Returns `null` for `clear` and `ASK` for anything that reads as a question,
 * both of which the shell handles: the registry has no access to the buffer
 * or the conversation and should not pretend otherwise.
 */
export function run(input: string): Line[] | null | typeof ASK {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const [head, ...rest] = trimmed.split(/\s+/);
  const name = (head ?? "").toLowerCase();

  // `ollama run`'s own commands, for whoever types them out of habit.
  if (name === "/clear" || name === "/bye") return null;
  if (name === "/?" || name === "/help") return run("help") as Line[];
  if (name.startsWith("/")) {
    return [err(`Unknown command '${head}'. Type help for the list.`)];
  }

  if (name === "clear" && rest.length === 0) return null;
  if (name === "ollama") {
    if (rest[0] === "run" && rest[1]?.toLowerCase() === "aman") {
      return ABOUT_CHAT;
    }
    // What the real client says for a model it has never pulled.
    return [err("Error: pull model manifest: file does not exist")];
  }
  if (KUBECTL.has(name)) return kubectl(rest);

  // `kgp foo` expands to `k get projects foo`.
  const alias = ALIASES[name];
  if (alias) return kubectl([...alias, ...rest]);

  const cmd = registry().find((c) => c.name === name);
  if (cmd && (rest.length === 0 || cmd.takesArgs)) return cmd.run(rest);

  const word = name.replace(/[!.,]+$/, "");
  const question =
    trimmed.endsWith("?") ||
    (rest.length === 0 ? GREETINGS.has(word) : !SHELL_VERBS.has(name));
  if (question) return ASK;

  return [
    err(`${name}: command not found`),
    hint("To ask about Aman, use a few words: `what is he working on?`"),
  ];
}

/** Every command word, for the shell's Tab completion. */
export function completions(): string[] {
  return [
    ...Object.keys(ALIASES),
    "help",
    "chat",
    "ollama run aman",
    "clear",
    "whoami",
    "k get",
    "k describe",
    ...RESOURCES.map((r) => `k get ${r.name}`),
    ...projects.map((p) => `k describe projects ${p.slug}`),
  ];
}
