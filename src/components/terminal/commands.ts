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
   * `art` is ASCII diagram content. It renders monospaced and un-wrapped, and
   * the shell marks it aria-hidden: a screen reader announcing box-drawing
   * characters produces noise, not information. Every diagram's meaning is
   * carried in the `detail` prose that accompanies it.
   */
  kind: "in" | "out" | "err" | "hint" | "art";
  text: string;
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

/**
 * kubectl-style relative age.
 *
 * Safe to compute from the clock here, unlike anything the pages render: this
 * only ever runs in the browser, inside a handler, after somebody types. The
 * server-rendered banner contains no dates, so SSG output stays byte-stable.
 */
function age(iso: string): string {
  const then = new Date(iso + "T00:00:00Z").getTime();
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days < 1) return "today";
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

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
        ["NAME", "SUMMARY", "AGE"],
        projects.map((p) => [p.slug, p.summary, age(p.updated)]),
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
          ["Updated", `${p.updated} (${age(p.updated)})`],
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
        hint("Start with: kgp"),
      ],
    },
    {
      name: "k",
      usage: "k get|describe <resource>",
      summary: "Query the content, kubectl-style.",
      run: kubectl,
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
      name: "clear",
      usage: "clear",
      summary: "Clear the screen.",
      // The buffer belongs to the shell; declared here so `help` lists it and
      // so it never falls through to "command not found".
      run: () => [],
    },
  ];
}

/**
 * Resolve a raw input line to output.
 *
 * Returns `null` for `clear`, which the shell handles — the registry has no
 * access to the buffer and should not pretend otherwise.
 */
export function run(input: string): Line[] | null {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const [head, ...rest] = trimmed.split(/\s+/);
  const name = (head ?? "").toLowerCase();

  if (name === "clear") return null;
  if (KUBECTL.has(name)) return kubectl(rest);

  // `kgp foo` expands to `k get projects foo`.
  const alias = ALIASES[name];
  if (alias) return kubectl([...alias, ...rest]);

  const cmd = registry().find((c) => c.name === name);
  if (cmd) return cmd.run(rest);

  return [err(`${name}: command not found`), out("Type `help` for the list.")];
}

/** Every command word, for the shell's Tab completion. */
export function completions(): string[] {
  return [
    ...Object.keys(ALIASES),
    "help",
    "clear",
    "whoami",
    "k get",
    "k describe",
    ...RESOURCES.map((r) => `k get ${r.name}`),
    ...projects.map((p) => `k describe projects ${p.slug}`),
  ];
}
