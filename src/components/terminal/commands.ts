import {
  DEFAULT_PALETTE,
  PALETTES,
  modesOf,
  type ModeChoice,
} from "~/content/palettes";
import { longDate } from "~/components/blog/date";
import {
  achievements,
  education,
  posts,
  profile,
  projects,
  roles,
  skills,
} from "~/content/profile";
import { ORIGIN } from "~/content/seo";

export type Line = {
  /**
   * `art` is a text diagram, shown unwrapped as one image, so its meaning has
   * to be in prose too. `ai` differs from `out` in what may become a link.
   */
  kind: "in" | "out" | "err" | "hint" | "art" | "ai" | "meta";
  text: string;
  /** A link printed after the text, for paths linkify cannot see (`/privacy/`). */
  link?: { text: string; href: string };
  /** The answer still streaming: its text is in a signal, not here. */
  live?: boolean;
  /** A colour change for the shell to apply; handlers only say what changes. */
  theme?: { name?: string; mode?: ModeChoice };
  /** Of a hint's `commands`, those a click types in and runs. */
  cmds?: readonly string[];
};

const out = (text: string): Line => ({ kind: "out", text });
const err = (text: string): Line => ({ kind: "err", text });
const hint = (text: string): Line => ({ kind: "hint", text });
const art = (text: string): Line => ({ kind: "art", text });

let cols = 80;

let current: { name: string; mode: ModeChoice } = {
  name: DEFAULT_PALETTE,
  mode: "auto",
};

/**
 * Whether a column layout survives `cols`: it fits outright, or its last
 * column starts in the left half, where the shell wraps it under itself.
 */
const fits = (lastAt: number, width: number) =>
  width <= cols || lastAt <= cols / 2;

function table(header: string[], rows: string[][]): Line[] {
  const all = [header, ...rows];
  const widths = header.map((_, i) =>
    Math.max(...all.map((r) => (r[i] ?? "").length)),
  );
  const lastAt = widths.slice(0, -1).reduce((n, w) => n + w + 2, 0);
  if (!fits(lastAt, lastAt + (widths[widths.length - 1] ?? 0))) {
    return rows.flatMap(([first = "", ...rest]) => [
      out(first),
      // A no-break space keeps each "·" off the start of a line.
      ...wrap(rest.filter(Boolean).join("\u00a0· ")),
    ]);
  }
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [out(line(header)), ...rows.map((r) => out(line(r)))];
}

function wrap(text: string, width = cols, indent = "  "): Line[] {
  width = Math.min(width, cols - indent.length);
  const words = text.split(/[^\S\u00a0]+/);
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

function fields(pairs: Array<[string, string]>): Line[] {
  const w = Math.max(...pairs.map(([k]) => k.length)) + 1;
  return pairs
    .filter(([, v]) => v)
    .map(([k, v]) => out(`${(k + ":").padEnd(w + 1)} ${v}`));
}

type Resource = {
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
    name: "posts",
    aliases: ["post", "blog", "writing"],
    list: () =>
      table(
        ["NAME", "DATE", "TITLE"],
        posts.map((p) => [p.slug, p.date, p.title]),
      ),
    describe: (key) => {
      const p = posts.find((x) => x.slug === key);
      if (!p) {
        return [
          err(`posts "${key}" not found`),
          out(`Known: ${posts.map((x) => x.slug).join(", ")}`),
        ];
      }
      return [
        ...fields([
          ["Name", p.slug],
          ["Title", p.title],
          ["Published", longDate(p.date)],
          ["Read", `${p.minutes} min`],
          ["Link", `${ORIGIN}/blog/${p.slug}/`],
          ["Code", p.repo ?? ""],
        ]),
        out(""),
        out("Summary:"),
        ...wrap(p.summary),
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
        ...r.points.flatMap((pt) => wrap(`- ${pt}`)),
      ];
    },
  },
  {
    name: "skills",
    aliases: ["skill"],
    list: () =>
      skills.flatMap((g) => [
        out(g.group.toUpperCase()),
        ...wrap(g.items.join(", ")),
        out(""),
      ]),
  },
  {
    name: "achievements",
    aliases: ["achievement", "awards"],
    list: () =>
      achievements.flatMap((a) => [
        out(`- ${a.title}`),
        ...(a.note ? wrap(a.note, cols, "    ") : []),
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

const SAVED = out("Saved in this browser.");

function contexts(): Line[] {
  return table(
    ["CURRENT", "NAME", "LOOK", "FROM"],
    PALETTES.map((p) => {
      const modes = modesOf(p);
      return [
        p.id === current.name ? "*" : "",
        p.id,
        modes.length === 2 ? "light + dark" : `${modes[0]} only`,
        p.from,
      ];
    }),
  );
}

/** With no word, `run` returns PICK and the shell opens its picker. */
function theme(args: string[]): Line[] {
  const word = args[0]?.toLowerCase();
  if (!word) return contexts();
  if (word === "reset") {
    return [
      {
        kind: "out",
        text: `Back to the default: ${PALETTES.find((p) => p.id === DEFAULT_PALETTE)?.from}.`,
        theme: { name: DEFAULT_PALETTE, mode: "auto" },
      },
      SAVED,
    ];
  }
  if (word === "light" || word === "dark" || word === "auto") {
    const p = PALETTES.find((x) => x.id === current.name);
    const modes = p ? modesOf(p) : [];
    return [
      {
        kind: "out",
        text:
          word === "auto"
            ? "Following your system's light or dark setting."
            : `${word === "light" ? "Light" : "Dark"}, whatever your system says.`,
        theme: { mode: word },
      },
      ...(modes.length === 1
        ? [
            hint(
              `${current.name} has a ${modes[0]} version only. This applies once you pick a theme with both.`,
            ),
          ]
        : []),
      SAVED,
    ];
  }
  const p = PALETTES.find((x) => x.id === word);
  if (!p) {
    return [
      err(`theme: no theme called "${args[0]}"`),
      out(`Themes: ${PALETTES.map((x) => x.id).join(", ")}`),
    ];
  }
  return [
    { kind: "out", text: `Switched to ${p.id}.`, theme: { name: p.id } },
    SAVED,
  ];
}

function config(sub: string | undefined, rest: string[]): Line[] {
  if (sub === "get-contexts") return contexts();
  if (sub === "current-context") return [out(current.name)];
  if (sub === "use-context") {
    const name = rest[0];
    if (!name) {
      return [
        err("error: you must specify a context name"),
        out(`Try: k config use-context ${DEFAULT_PALETTE}`),
      ];
    }
    const p = PALETTES.find((x) => x.id === name.toLowerCase());
    if (!p) return [err(`error: no context exists with the name: "${name}"`)];
    return [
      {
        kind: "out",
        text: `Switched to context "${p.id}".`,
        theme: { name: p.id },
      },
    ];
  }
  return [
    err(
      sub
        ? `error: unknown command "${sub}" for "kubectl config"`
        : "error: you must specify a config command",
    ),
    out("Available: get-contexts, current-context, use-context"),
  ];
}

type Command = {
  name: string;
  usage: string;
  summary: string;
  run: (args: string[]) => Line[];
  /** Without this, `help me with…` is a question, not `help`. */
  takesArgs?: boolean;
};

const KUBECTL = new Set(["k", "kubectl"]);

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

function kubectl(args: string[]): Line[] {
  const [verb, resourceWord, ...rest] = args;

  if (!verb) {
    return [
      out("Usage: k <verb> <resource> [name]"),
      out(""),
      out(`Verbs:     get, describe, config`),
      out(`Resources: ${RESOURCES.map((r) => r.name).join(", ")}`),
      out(""),
      hint("Try: k get projects"),
    ];
  }

  if (verb === "config") return config(resourceWord, rest);

  if (verb === "get" || verb === "describe") {
    if (!resourceWord) {
      return [
        err(`You must specify the type of resource to ${verb}.`),
        out(`Valid types: ${RESOURCES.map((r) => r.name).join(", ")}`),
      ];
    }
    const res = findResource(resourceWord.toLowerCase());
    if (!res) {
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

  return [
    err(`unknown verb "${verb}"`),
    out("Supported: get, describe, config"),
  ];
}

function registry(): Command[] {
  return [
    {
      name: "help",
      usage: "help",
      summary: "List available commands.",
      run: () => {
        const cmds = registry();
        // Summaries start at 33: two spaces, the usage padded to 30, a space.
        const wide = fits(
          33,
          33 + Math.max(...cmds.map((c) => c.summary.length)),
        );
        return [
          out("Commands:"),
          ...cmds.flatMap((c) =>
            wide
              ? [out(`  ${c.usage.padEnd(30)} ${c.summary}`)]
              : [out(`  ${c.usage}`), ...wrap(c.summary, cols, "      ")],
          ),
          out(""),
          out(`Resources: ${RESOURCES.map((r) => r.name).join(", ")}`),
          out(""),
          out("Aliases (the ones already in your shell profile):"),
          ...Object.entries(ALIASES).map(([a, full]) =>
            out(`  ${a.padEnd(6)} k ${full.join(" ")}`),
          ),
          out(""),
          out("PageUp and PageDown scroll this output."),
          hint("Start with: kgp, or ask what he is working on."),
        ];
      },
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
      name: "theme",
      usage: "theme [name|light|dark|auto]",
      summary: "Pick the site's theme. Saved in this browser.",
      run: theme,
      takesArgs: true,
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
      // Only so `help` lists it: `run` handles `clear` before the registry.
      run: () => [],
    },
  ];
}

const ABOUT_CHAT: Line[] = [
  out("Talking to a model running on a GPU on Aman's desk, at home."),
  out("It answers from his CV and his posts, and can be wrong."),
  {
    kind: "out",
    text: "Chats are kept for 30 days.",
    link: { text: "privacy", href: "/privacy/" },
  },
  hint("There is no mode to enter. Just type a question."),
];

/** Returned by `run` when the line is meant for the model, not the shell. */
export const ASK = "ask";

/** Returned by `run` for a bare `theme`: the shell opens its colour picker. */
export const PICK = "pick";

/** Typed as a command, these get "command not found" rather than the model. */
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

/** A flag, a path or a file name: words that only appear in command lines. */
const ARG = /^[-/.~]|\/|\w\.\w/;

/**
 * Returns `null` for `clear`, `ASK` for a question and `PICK` for a bare
 * `theme`, all of which the shell handles. `width` is in characters.
 */
export function run(
  input: string,
  width = 80,
  colours?: { name: string; mode: ModeChoice },
): Line[] | null | typeof ASK | typeof PICK {
  cols = width;
  if (colours) current = colours;
  const trimmed = input.trim();
  if (!trimmed) return [];

  const [head, ...rest] = trimmed.split(/\s+/);
  const name = (head ?? "").toLowerCase();

  if ((name === "theme" || name === "/theme") && rest.length === 0) return PICK;

  // `ollama run`'s own commands.
  if (name === "/clear" || name === "/bye") return null;
  if (name === "/?" || name === "/help") return run("help", width) as Line[];
  if (name.startsWith("/")) {
    return [err(`Unknown command '${head}'. Type help for the list.`)];
  }

  if (name === "clear" && rest.length === 0) return null;
  if (name === "ollama") {
    if (rest[0] === "run" && rest[1]?.toLowerCase() === "aman") {
      return ABOUT_CHAT;
    }
    return [err("Error: pull model manifest: file does not exist")];
  }
  if (KUBECTL.has(name)) return kubectl(rest);

  const alias = ALIASES[name];
  if (alias) return kubectl([...alias, ...rest]);

  if (name === "theme" && (rest.length > 1 || trimmed.endsWith("?")))
    return ASK;

  const cmd = registry().find((c) => c.name === name);
  if (cmd && (rest.length === 0 || cmd.takesArgs)) return cmd.run(rest);

  // Warp's rule: a word is a command only if the shell has it; the rest goes
  // to the model (2026-10-14).
  // https://docs.warp.dev/agents/cli/input-and-shell-commands/
  const command =
    !trimmed.endsWith("?") &&
    SHELL_VERBS.has(name) &&
    (rest.length <= 1 || rest.some((a) => ARG.test(a)));
  if (!command) return ASK;

  return [
    err(`${name}: command not found`),
    hint("Type `help` for this shell's commands."),
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
    ...posts.map((p) => `k describe posts ${p.slug}`),
    "theme",
    ...["light", "dark", "auto", "reset"].map((w) => `theme ${w}`),
    ...PALETTES.map((p) => `theme ${p.id}`),
    "k config get-contexts",
    "k config current-context",
    ...PALETTES.map((p) => `k config use-context ${p.id}`),
  ];
}
