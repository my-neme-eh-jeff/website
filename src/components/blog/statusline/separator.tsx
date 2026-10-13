import { component$, useSignal } from "@qwik.dev/core";
import { Choice } from "../controls";
import type { Seg } from "./model";
import { Terminal } from "./terminal";

const NAMES = [
  "SESSION_NAME",
  "BASE_MODEL",
  "CTX_TAG",
  "EFFORT",
  "PCT",
  "CENTS",
  "KUBE_CTX",
];
// A model without the 1M context, so CTX_TAG is the empty field.
const VALUES = ["fix auth", "Sonnet 5.5", "", "high", "64", "576", "staging"];

const OPTIONS = [
  { value: "tab", label: "Tab" },
  { value: "us", label: "\\x1f, the unit separator" },
] as const;

/**
 * bash's `IFS=<sep> read -r a b c …`. A whitespace IFS character collapses
 * runs of itself and trims the ends; any other character splits exactly.
 * The last variable takes whatever is left.
 */
function read(fields: string[], sep: "tab" | "us", n: number) {
  const parts =
    sep === "us"
      ? fields
      : fields
          .join("\t")
          .replace(/^\t+|\t+$/g, "")
          .split(/\t+/);
  const out = parts.slice(0, n - 1);
  out.push(parts.slice(n - 1).join(sep === "us" ? "\x1f" : "\t"));
  while (out.length < n) out.push("");
  return out;
}

const int = (s: string) => (/^-?[0-9]+$/.test(s) ? Number(s) : 0);

/** Line 1 and 2 as statusline.sh builds them from those variables. */
function lines(v: string[]): Seg[][] {
  const [, model, ctx, effort, pctS, centsS, kube] = v;
  const parts = [ctx, effort].filter(Boolean).join(", ");
  const pct = int(pctS ?? "");
  const cents = int(centsS ?? "");
  const bar: Seg = { text: " | ", tone: "dim" };
  const out: Seg[][] = [
    [
      { text: parts ? `${model} (${parts})` : `${model}`, tone: "normal" },
      bar,
      { text: "🧠", tone: "grad", pct, says: "context" },
      { text: ` ${pct}%`, tone: "grad", pct },
      bar,
      {
        text: `$${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
        tone: "normal",
      },
    ],
  ];
  if (kube)
    out.push([
      { text: "☸", tone: "cyan", says: "kube context" },
      { text: ` ${kube}`, tone: "cyan" },
    ]);
  return out;
}

export const SeparatorBug = component$(() => {
  const sep = useSignal<string>("tab");
  const mode = sep.value === "us" ? "us" : "tab";
  const got = read(VALUES, mode, NAMES.length);
  const glyph = mode === "us" ? "␟" : "⇥";

  return (
    <div>
      <Choice legend="Join the fields with" options={OPTIONS} value={sep} />

      <p class="text-muted mt-5 mb-2 text-sm">What jq prints</p>
      <div class="flex flex-wrap items-center gap-y-2 font-mono text-xs">
        {VALUES.map((v, i) => (
          <span key={i} class="flex items-center">
            {i > 0 && (
              <span class="text-accent px-1" aria-hidden="true">
                {glyph}
              </span>
            )}
            <span
              class={[
                "rounded px-1.5 py-0.5",
                v ? "bg-text/5" : "border-muted border border-dashed",
              ]}
            >
              {v || <span class="text-muted">empty</span>}
            </span>
          </span>
        ))}
      </div>

      <p class="text-muted mt-5 mb-2 text-sm">
        What <code class="font-mono">read</code> puts in each variable
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        {NAMES.map((n, i) => {
          const wrong = got[i] !== VALUES[i];
          return (
            <div key={n} class="contents">
              <dt class="text-muted">{n}</dt>
              <dd class={wrong ? "text-danger" : ""}>
                {JSON.stringify(got[i])}
                {wrong && (
                  <span class="text-muted">
                    {"  "}should be {JSON.stringify(VALUES[i])}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div class="mt-5">
        <Terminal lines={lines(got)} label="The status line it draws" />
      </div>
    </div>
  );
});
