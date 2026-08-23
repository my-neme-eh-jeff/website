/**
 * The command registry.
 *
 * A blank template on purpose: `help` and `clear` only, plus the shape that
 * `k get projects` / `k describe project <slug>` will slot into. Kept in its
 * own module so it lands in a separate bundle from the shell — the shell has to
 * render server-side, this only has to exist once someone types.
 *
 * Handlers are plain synchronous functions returning lines. No component
 * imports, no signals: keeping the registry pure means adding a command never
 * needs to know how the terminal renders.
 */

export type Line = {
  kind: "in" | "out" | "err" | "hint";
  text: string;
};

export type Command = {
  name: string;
  /** Shown by `help`. One short line. */
  usage: string;
  summary: string;
  run: (args: string[]) => Line[];
};

const out = (text: string): Line => ({ kind: "out", text });
const err = (text: string): Line => ({ kind: "err", text });

/**
 * Registry is built lazily via a function rather than a top-level const so the
 * `help` command can list its siblings without a circular reference.
 */
export function registry(): Command[] {
  const commands: Command[] = [
    {
      name: "help",
      usage: "help",
      summary: "List available commands.",
      run: () => [
        out("Available commands:"),
        ...registry().map((c) => out(`  ${c.usage.padEnd(28)} ${c.summary}`)),
        out(""),
        out("More arriving: k get projects, k describe project <name>."),
      ],
    },
    {
      name: "clear",
      usage: "clear",
      summary: "Clear the screen.",
      // Handled by the shell, which owns the buffer. Declared here so `help`
      // lists it and so an unknown-command error is never shown for it.
      run: () => [],
    },
  ];
  return commands;
}

const KUBECTL_HINT = new Set(["k", "kubectl"]);

/**
 * Resolve a raw input line to output.
 *
 * Returns `null` for `clear`, which is the shell's job — the registry has no
 * access to the buffer and should not pretend otherwise.
 */
export function run(input: string): Line[] | null {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const [head, ...rest] = trimmed.split(/\s+/);
  const name = (head ?? "").toLowerCase();

  if (name === "clear") return null;

  const cmd = registry().find((c) => c.name === name);
  if (cmd) return cmd.run(rest);

  /*
   * `k` and `kubectl` are the whole point of this thing, so getting them wrong
   * deserves a better answer than "not found". Anyone typing them already knows
   * what they expect to happen.
   */
  if (KUBECTL_HINT.has(name)) {
    return [
      { kind: "hint", text: `${name}: not wired up yet.` },
      out("  This terminal is a working shell with an empty command set."),
      out("  `k get projects` and `k describe` are the next thing to land."),
      out("  Type `help` for what does work today."),
    ];
  }

  return [err(`${name}: command not found`), out("Type `help` for the list.")];
}
