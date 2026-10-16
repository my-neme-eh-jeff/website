/**
 * Every colour palette the site can wear, and the only place their values live.
 *
 * From this file:
 *   - `paletteCss` is the token stylesheet `src/root.tsx` puts in <head>,
 *   - `themeScript` (src/content/theme.ts) applies a visitor's saved choice
 *     before first paint,
 *   - the footer picker and the shell's `theme` command list the palettes,
 *   - `pnpm run verify` checks every palette, in every mode it has, against
 *     the contrast bars, and that each value is six-digit hex.
 *
 * Six-digit hex is a hard requirement, not a style. `src/components/desk/light.ts`
 * reads the tokens back with parseInt to feed its shader, so `oklch()` or a
 * three-digit hex would draw the desk in black.
 *
 * This file is imported by verify straight into Node, so it imports nothing
 * and uses no TypeScript-only syntax beyond types.
 */

export type Mode = "light" | "dark";

/** Four field stops, opaque. `.field` in global.css applies each one's alpha. */
export type FieldStops = readonly [string, string, string, string];

export type Colours = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  danger: string;
  /** Hairlines and the dot grid. Derived from `text` when absent. */
  line?: string;
  dot?: string;
  /**
   * The background field's stops at the top, middle and bottom of a page.
   * One entry holds still while the blobs drift; none leaves the page flat.
   */
  field?: readonly FieldStops[];
};

export type Palette = {
  id: string;
  name: string;
  /** Where it comes from, in a few words. Shown in the picker and the shell. */
  from: string;
  light?: Colours;
  dark?: Colours;
};

/*
 * The original palette. Its contrast history is worth keeping: clay comes in
 * two strengths because #d97757 measured 2.99:1 on the light ground, which
 * failed the 3:1 focus-ring bar by a hair, so light uses #bd5334 (4.52:1). The
 * error red got the same treatment: #e0715c is 3.01:1 on the light ground,
 * #c4472c is 4.70:1.
 */
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

export const PALETTES: readonly Palette[] = [
  {
    /*
     * Sanzo Wada, Haishoku Soukan (1933-34), reissued by Seigensha as "A
     * Dictionary of Color Combinations". Values are the book's CMYK through
     * Matt DesLauriers' open conversion (approximate by its own account):
     * https://github.com/mattdesl/dictionary-of-colour-combinations
     *
     * The light accent is Burnt Sienna rather than the Raw Sienna of the colour
     * study: the accent is also hint and link text, and Raw Sienna is 3.31:1
     * on the lemon page. Burnt Sienna is 4.52:1 on lemon and 5.13:1 on white.
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
      danger: "#a72144", // Red
      field: [["#f99d1b", "#bb7125", "#5a82b3", "#a5c8d1"]],
    },
    dark: {
      bg: "#051230", // Deep Indigo
      surface: "#12354e", // Dark Tyrian Blue
      text: "#ffefae", // Pale Lemon Yellow
      muted: "#a5c8d1", // Light Glaucous Blue
      accent: "#f99d1b", // Yellow Orange
      danger: "#f48067", // Grenadine Pink
      field: [["#f99d1b", "#f48067", "#12354e", "#bb7125"]],
    },
  },
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
      accent: "#0031a9",
      danger: "#a60000",
    },
    dark: {
      bg: "#000000",
      surface: "#1e1e1e",
      text: "#ffffff",
      muted: "#989898",
      accent: "#2fafff",
      danger: "#ff5f59",
    },
  },
  {
    /*
     * rebelot's Neovim theme, after Hokusai's Great Wave. Only the dark "wave"
     * variant ships: no red in Kanagawa reaches 4.5:1 for error text on the
     * light "lotus" paper (the closest, #c34043, is 4.23:1). Muted is
     * springViolet2 because the theme's comment grey is 2.88:1.
     * https://github.com/rebelot/kanagawa.nvim (lua/kanagawa/colors.lua)
     */
    id: "kanagawa",
    name: "Kanagawa",
    from: "Hokusai, via rebelot, 2021",
    dark: {
      bg: "#1f1f28", // sumiInk3
      surface: "#2a2a37", // sumiInk4
      text: "#dcd7ba", // fujiWhite
      muted: "#9cabca", // springViolet2
      accent: "#7e9cd8", // crystalBlue
      danger: "#ff5d62", // peachRed
      field: [["#2d4f67", "#7e9cd8", "#957fb8", "#e6c384"]],
    },
  },
  {
    /*
     * Rob Pike's acme, the Plan 9 editor (USENIX, 1994). The source mixes pale
     * yellow #ffffaa and pale blue-green #aaffff with white at 63/255, which
     * is #ffffea for a window's body and #eaffff for its tag, the line where
     * commands are typed. So the page is the body and the shell is the tag.
     * The accent is the navy acme draws for a window with unsaved changes; the
     * error is its execute-selection red; muted is rio's unfocused grey.
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
      danger: "#aa0000",
    },
  },
  {
    /*
     * An amber terminal. The text is cool-retro-term's default amber, the
     * ground is what it renders (black with about 6% of the text mixed in),
     * and the bright #ffb700 is one estimate of the P3 phosphor's 602 nm peak.
     * A monochrome screen has no red, so errors use the bright amber too.
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
      danger: "#ffb700",
      field: [["#ff8100", "#c56400", "#0f0802", "#ffb700"]],
    },
  },
];

/** What a visitor sees until they choose. Must have both modes. */
export const DEFAULT_PALETTE = "wada";

export const MODES = ["auto", "light", "dark"] as const;
export type ModeChoice = (typeof MODES)[number];

/** localStorage keys, in the same style as `shell:muted` and `analytics:off`. */
export const THEME_KEY = "theme:name";
export const MODE_KEY = "theme:mode";

export const modesOf = (p: Palette): Mode[] =>
  (["light", "dark"] as const).filter((m) => p[m]);

/* --- the token stylesheet -------------------------------------------------- */

const TOKENS = ["bg", "surface", "text", "muted", "accent", "danger"] as const;

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
    // Hairlines are the text colour, faint. Dark grounds need a touch more.
    `--sem-line:${c.line ?? `color-mix(in oklab,${c.text} ${mode === "light" ? 10 : 12}%,transparent)`}`,
    `--sem-dot:${c.dot ?? `color-mix(in oklab,${c.text} ${mode === "light" ? 9 : 7}%,transparent)`}`,
    fieldVars(c),
    `color-scheme:${mode}`,
  ].join(";");

const swatch = (c: Colours) =>
  `--swatch-bg:${c.bg};--swatch-accent:${c.accent}`;

/**
 * Selector shapes, in source order. Specificity decides most of it and source
 * order breaks the ties, so the default comes first:
 *
 *   default light   :root                                          (0,1,0)
 *   default dark    @media dark  :root:not([data-mode=light])      (0,2,0)
 *                   :root[data-mode=dark]                          (0,2,0)
 *   other, light    :root[data-palette=x]                          (0,2,0)
 *   other, dark     @media dark  :root[data-palette=x]:not(...)    (0,3,0)
 *                   :root[data-palette=x][data-mode=dark]          (0,3,0)
 *   one-mode only   :root[data-palette=x], whatever the mode       (0,2,0)
 *
 * A one-mode palette ties with the default's dark rules and wins on order,
 * which is why the default is emitted first.
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
