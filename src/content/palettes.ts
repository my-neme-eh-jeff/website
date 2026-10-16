/**
 * Every colour palette the site can wear. `paletteCss` is the token stylesheet
 * root.tsx puts in <head>.
 *
 * The core tokens must be six-digit hex: the desk's WebGL light reads them
 * back with parseInt. `pnpm run verify` checks that, and every mode's contrast.
 *
 * verify imports this file straight into Node, so it imports nothing and uses
 * no TypeScript-only syntax beyond types.
 */

export type Mode = "light" | "dark";

/** Four opaque stops. `.field` in global.css applies each one's alpha. */
export type FieldStops = readonly [string, string, string, string];

export type Colours = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  /** Links, the focus ring, the prompt and the page you are on. */
  accent: string;
  /** Commands: typed into the shell, and suggested by its hints. */
  alt: string;
  /** "say hi" in the header, and nothing else. */
  cta: string;
  danger: string;
  /** Hairlines. Derived from `text` when absent. */
  line?: string;
  dot?: string;
  /**
   * The background field's stops, which it drifts between over time.
   * One entry holds still while the blobs drift; none leaves the page flat.
   */
  field?: readonly FieldStops[];
};

export type Palette = {
  id: string;
  name: string;
  /** Where it comes from, in a few words. */
  from: string;
  light?: Colours;
  dark?: Colours;
};

const EMBER_PLUM_TEAL: readonly FieldStops[] = [
  ["#ff8a3d", "#d0341f", "oklch(52% 0.19 318)", "oklch(72% 0.15 78)"],
  [
    "oklch(75% 0.14 330)",
    "oklch(56.5% 0.17 300)",
    "oklch(52% 0.17 285)",
    "oklch(72% 0.12 345)",
  ],
  [
    "oklch(75% 0.13 205)",
    "oklch(56.5% 0.13 225)",
    "oklch(52% 0.12 195)",
    "oklch(72% 0.1 200)",
  ],
];

const WADA: Palette = {
  /*
   * Sanzo Wada, Haishoku Soukan (1933-34), reissued by Seigensha as "A
   * Dictionary of Color Combinations". Values are the book's CMYK through
   * Matt DesLauriers' open conversion (approximate by its own account):
   * https://github.com/mattdesl/dictionary-of-colour-combinations
   *
   * The light accent is Burnt Sienna, not the study's Raw Sienna, which is
   * short of the 4.5:1 that link and hint text need on the lemon page. Few
   * of the book's combinations read on either ground, so `alt` and `cta`
   * are its colours picked by hue, clear of the accent and the red.
   */
  id: "wada",
  name: "Wada",
  from: "Sanzo Wada, 1933",
  light: {
    bg: "#ffefae", // Pale Lemon Yellow
    surface: "#ffffff",
    text: "#12354e", // Dark Tyrian Blue
    muted: "#547076", // Dark Medici Blue
    accent: "#ae5224", // Burnt Sienna
    alt: "#1a7444", // Diamine Green
    cta: "#b73f74", // Rosolanc Purple
    danger: "#a72144", // Red
    field: [["#f99d1b", "#bb7125", "#5a82b3", "#a5c8d1"]],
  },
  dark: {
    bg: "#051230", // Deep Indigo
    surface: "#12354e", // Dark Tyrian Blue
    text: "#ffefae", // Pale Lemon Yellow
    muted: "#a5c8d1", // Light Glaucous Blue
    accent: "#f99d1b", // Yellow Orange
    alt: "#87c540", // Night Green
    cta: "#f9c1ce", // Hermosa Pink
    danger: "#f48067", // Grenadine Pink
    field: [["#f99d1b", "#f48067", "#12354e", "#bb7125"]],
  },
};

/*
 * rebelot's Neovim theme, after Hokusai's Great Wave. Only the dark "wave"
 * variant: no Kanagawa red reaches 4.5:1 on the light "lotus" paper. Muted is
 * springViolet2 because the theme's comment grey is too faint.
 * https://github.com/rebelot/kanagawa.nvim (lua/kanagawa/colors.lua)
 */
const KANAGAWA: Palette = {
  id: "kanagawa",
  name: "Kanagawa",
  from: "Hokusai, via rebelot, 2021",
  dark: {
    bg: "#1f1f28", // sumiInk3
    surface: "#2a2a37", // sumiInk4
    text: "#dcd7ba", // fujiWhite
    muted: "#9cabca", // springViolet2
    accent: "#7e9cd8", // crystalBlue
    alt: "#98bb6c", // springGreen
    cta: "#ffa066", // surimiOrange
    danger: "#ff5d62", // peachRed
    field: [["#2d4f67", "#7e9cd8", "#957fb8", "#e6c384"]],
  },
};

export const PALETTES: readonly Palette[] = [
  // Until a visitor chooses: Kanagawa on a dark system, Wada on a light one.
  {
    id: "default",
    name: "Default",
    from: "Kanagawa at night, Wada by day",
    light: WADA.light!,
    dark: KANAGAWA.dark!,
  },
  WADA,
  {
    id: "paper",
    name: "Paper",
    from: "this site, 2026",
    light: {
      bg: "#fbfaf8",
      surface: "#ffffff",
      text: "#16150f",
      muted: "#5f5d55",
      accent: "#bd5334",
      alt: "#007176", // the field's teal and plum, darkened to read
      cta: "#883e9d",
      danger: "#c4472c",
      line: "rgb(0 0 0 / 0.1)",
      dot: "rgb(0 0 0 / 0.09)",
      field: EMBER_PLUM_TEAL,
    },
    dark: {
      bg: "#12110d",
      surface: "#1b1a15",
      text: "#f2f0e9",
      muted: "#a4a096",
      accent: "#d97757",
      alt: "#64c3c8",
      cta: "#cd90e0",
      danger: "#e0715c",
      line: "rgb(255 255 255 / 0.12)",
      dot: "rgb(255 255 255 / 0.07)",
      field: EMBER_PLUM_TEAL,
    },
  },
  {
    /*
     * Protesilaos Stavrou's Modus themes, built into Emacs since 28. Designed
     * for 7:1 between every text and background pairing.
     * https://github.com/protesilaos/modus-themes (modus-themes.el)
     */
    id: "modus",
    name: "Modus",
    from: "Emacs, built for 7:1 contrast",
    light: {
      bg: "#ffffff",
      surface: "#f2f2f2",
      text: "#000000",
      muted: "#595959",
      accent: "#0031a9", // blue-warmer
      alt: "#006800", // green
      cta: "#721045", // magenta
      danger: "#a60000",
    },
    dark: {
      bg: "#000000",
      surface: "#1e1e1e",
      text: "#ffffff",
      muted: "#989898",
      accent: "#2fafff", // blue-warmer
      alt: "#44bc44", // green
      cta: "#f78fe7", // magenta-warmer
      danger: "#ff5f59",
    },
  },
  KANAGAWA,
  {
    /*
     * Rob Pike's acme, the Plan 9 editor (USENIX, 1994). Its pale yellow and
     * blue-green, mixed with white, give #ffffea for a window's body (the page)
     * and #eaffff for its tag, where commands are typed (the shell). The accent
     * is the navy of a window with unsaved changes, the error its
     * execute-selection red, muted rio's unfocused grey, the call to action its
     * plumb green. It has no fourth ink, so commands stay black.
     * https://github.com/9fans/plan9port (src/cmd/acme/acme.c, libdraw/allocimagemix.c)
     */
    id: "acme",
    name: "Acme",
    from: "Plan 9, 1994",
    light: {
      bg: "#ffffea",
      surface: "#eaffff",
      text: "#000000",
      muted: "#666666",
      accent: "#000099",
      alt: "#000000",
      cta: "#006600",
      danger: "#aa0000",
    },
  },
  {
    /*
     * An amber terminal. The text is cool-retro-term's default amber, the
     * ground is what it renders (black with about 6% of the text mixed in),
     * and the bright #ffb700 is one estimate of the P3 phosphor's 602 nm peak.
     * A monochrome screen has no red, so errors use the bright amber too, and
     * commands and "say hi" are its two strengths of amber.
     * https://github.com/Swordfish90/cool-retro-term (app/qml/ApplicationSettings.qml)
     */
    id: "amber",
    name: "Amber",
    from: "P3 phosphor terminals",
    dark: {
      bg: "#0f0802",
      // A tube has one ground. The shell's border is what separates it.
      surface: "#0f0802",
      text: "#ff8100",
      muted: "#c56400",
      accent: "#ffb700",
      alt: "#ff8100",
      cta: "#ffb700",
      danger: "#ffb700",
      field: [["#ff8100", "#c56400", "#0f0802", "#ffb700"]],
    },
  },
];

/** What a visitor sees until they choose. Must have both modes. */
export const DEFAULT_PALETTE = "default";

export const MODES = ["auto", "light", "dark"] as const;
export type ModeChoice = (typeof MODES)[number];

/** localStorage keys. */
export const THEME_KEY = "theme:name";
export const MODE_KEY = "theme:mode";

export const modesOf = (p: Palette): Mode[] =>
  (["light", "dark"] as const).filter((m) => p[m]);

const TOKENS = [
  "bg",
  "surface",
  "text",
  "muted",
  "accent",
  "alt",
  "cta",
  "danger",
] as const;

const fieldVars = (c: Colours): string => {
  const stops = c.field ?? [];
  const at = (i: number) => stops[Math.min(i, stops.length - 1)];
  return (["a", "b", "c"] as const)
    .flatMap((step, i) =>
      [0, 1, 2, 3].map(
        (n) => `--field-${n + 1}${step}:${at(i)?.[n] ?? "transparent"}`,
      ),
    )
    .join(";");
};

const block = (c: Colours, mode: Mode): string =>
  [
    ...TOKENS.map((t) => `--sem-${t}:${c[t]}`),
    `--sem-line:${c.line ?? `color-mix(in oklab,${c.text} ${mode === "light" ? 10 : 12}%,transparent)`}`,
    `--sem-dot:${c.dot ?? `color-mix(in oklab,${c.text} ${mode === "light" ? 9 : 7}%,transparent)`}`,
    fieldVars(c),
    `color-scheme:${mode}`,
  ].join(";");

const swatch = (c: Colours) =>
  `--swatch-bg:${c.bg};--swatch-accent:${c.accent}`;

/*
 * The default palette is emitted first: a one-mode palette's
 * `:root[data-palette=x]` ties in specificity with the default's dark rules,
 * and wins only by coming after them.
 */
const DARK = "@media (prefers-color-scheme: dark)";

function rules(scope: string, light?: string, dark?: string): string[] {
  const out: string[] = [];
  if (light && dark) {
    out.push(`${scope}{${light}}`);
    out.push(`${DARK}{${scope}:not([data-mode="light"]){${dark}}}`);
    out.push(`${scope}[data-mode="dark"]{${dark}}`);
  } else {
    out.push(`${scope}{${(light ?? dark)!}}`);
  }
  return out;
}

const byId = new Map(PALETTES.map((p) => [p.id, p]));
const def = byId.get(DEFAULT_PALETTE)!;

export const paletteCss = [
  ...rules(":root", block(def.light!, "light"), block(def.dark!, "dark")),
  ...PALETTES.filter((p) => p !== def).flatMap((p) =>
    rules(
      `:root[data-palette="${p.id}"]`,
      p.light && block(p.light, "light"),
      p.dark && block(p.dark, "dark"),
    ),
  ),
  // The picker's swatches show each palette as it would render right now.
  ...PALETTES.flatMap((p) => {
    const s = `[data-swatch="${p.id}"]`;
    if (!(p.light && p.dark)) return [`${s}{${swatch((p.light ?? p.dark)!)}}`];
    return [
      `${s}{${swatch(p.light)}}`,
      `${DARK}{:root:not([data-mode="light"]) ${s}{${swatch(p.dark)}}}`,
      `:root[data-mode="dark"] ${s}{${swatch(p.dark)}}`,
    ];
  }),
].join("\n");
