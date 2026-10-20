/**
 * The desk as a scene for ./ascii.ts, in drawing units (VIEW). The PC is at
 * the desk's left end, its cable dropping over the edge beside it, so an
 * answer's words come out on the left, over the text they land in. Books
 * mid-desk, the top one's title showing where the lamp shines; the mug under
 * the lamp. The desk's edge is three rows, `-` / `:` / `-`.
 */
import { MAT, type Part, type Pt, type Scene, type Size } from "./ascii.ts";
import { ART } from "./xray.ts";

const rect = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;

/** A third of the PC's height, with a handle; s is its steam. */
const MUG_WIDE = {
  rows: [
    "  ( (",
    "   ) )",
    "  ( (",
    " _____ ",
    "|     |",
    "|     |]",
    "|     |]",
    "|_____|",
  ],
  kinds: [
    "  s s",
    "   s s",
    "  s s",
    " lllll ",
    "lfffffl",
    "lfffffll",
    "lfffffll",
    "lllllll",
  ],
};
const MUG_NARROW = {
  rows: ["  (", " )", " __ ", "|  |]", "|__|"],
  kinds: ["  s", " s", " ll ", "lffll", "llll"],
};

const DESK_Y = 268;
/** The slab's underside: row 32 wide as today, and a third row (19) narrow, where today's two rows squeeze the dots out. */
const DESK_B = 289;

const CELL = {
  wide: { cw: 560 / 144, ch: 356 / 44 },
  narrow: { cw: 560 / 84, ch: 356 / 26 },
} as const;
/** Cells c0..c1 by r0..r1 of a grid, a hair inside, so a fill covers them all and nothing else. */
const cells = (size: Size, c0: number, r0: number, c1: number, r1: number) => {
  const { cw, ch } = CELL[size];
  return rect(
    c0 * cw + 0.01,
    24 + r0 * ch + 0.01,
    (c1 - c0 + 1) * cw - 0.02,
    (r1 - r0 + 1) * ch - 0.02,
  );
};
/** The drawing point at a cell's centre. */
const mid = (size: Size, c: number, r: number): Pt => [
  (c + 0.5) * CELL[size].cw,
  24 + (r + 0.5) * CELL[size].ch,
];

/**
 * Today's box, per grid: its columns and rows on today's grid moved left, so
 * every vent, the panel and the LED sit where they do today relative to it.
 */
const BOX = {
  wide: { c: 7, r: 17, w: 43, h: 13 },
  narrow: { c: 4, r: 10, w: 26, h: 7 },
} as const;

const OUTLINE: Record<Size, string[]> = {
  wide: [
    " /" + "-".repeat(39) + "\\ ",
    ...Array(12).fill("|" + " ".repeat(41) + "|"),
  ],
  narrow: [
    " /" + "-".repeat(22) + "\\ ",
    ...Array(6).fill("|" + " ".repeat(24) + "|"),
  ],
};
const V_W = "       |  |  |  |";
/** Line glyphs, and the LED's @ as LED cells. */
const kindsOf = (rows: string[]) =>
  rows.map((r) => r.replace(/@/g, "e").replace(/[^ e]/g, "l"));
const FRONT_ROWS: Record<Size, string[]> = {
  wide: [
    "",
    "",
    "",
    V_W + "    .--------------.",
    V_W + "    |              |",
    V_W + "    |              |",
    V_W + "    '--------------'",
    V_W,
    V_W,
    V_W,
    V_W + " ".repeat(19) + "@@",
  ],
  narrow: [
    "",
    "    | | | |",
    "    | | | | .--------.",
    "    | | | | |        |",
    "    | | | | '--------'",
    "    | | | |",
    "    | | | |" + " ".repeat(10) + "@@",
  ],
};

function pc(size: Size): Part[] {
  const b = BOX[size];
  const at = mid(size, b.c, b.r);
  const [x0, y0] = mid(size, b.c, b.r);
  const [x1, y1] = mid(size, b.c + b.w - 1, b.r + b.h - 1);
  // The panel's inside: two rows wide, one narrow, where the trace runs.
  const scr =
    size === "wide"
      ? { c0: 22, c1: 35, r0: 4, r1: 5 }
      : { c0: 13, c1: 20, r0: 3, r1: 3 };
  return [
    {
      id: "box",
      only: size,
      z: 2,
      role: "box",
      hidden: true,
      lines: [rect(x0, y0, x1 - x0, y1 - y0)],
      sprite: { [size]: { at, anchor: [0, 0], rows: OUTLINE[size] } },
    },
    {
      id: "face",
      only: size,
      z: 2,
      fill: cells(size, b.c, b.r + 1, b.c + b.w - 1, b.r + b.h - 1),
      dens: 0.2,
      solid: "fill",
      face: { kind: "front" },
    },
    {
      id: "screen",
      only: size,
      z: 2.5,
      fill: cells(size, b.c + scr.c0, b.r + scr.r0, b.c + scr.c1, b.r + scr.r1),
      dens: 0.3,
    },
    {
      id: "front",
      only: size,
      z: 3,
      sprite: {
        [size]: {
          at,
          anchor: [0, 0],
          rows: FRONT_ROWS[size],
          kinds: kindsOf(FRONT_ROWS[size]),
        },
      },
    },
  ];
}

/**
 * The book he's reading on top, a row thicker than the others so its title
 * sits inside the spine, shown where the lamp shines; the other two stay
 * blank. A phone's spine is 6 cells, too short for it.
 */
const BOOKS = {
  wide: {
    at: [62, 25],
    rows: [
      "    " + "_".repeat(20),
      "   |" + " ".repeat(20) + "|",
      " __|" + "_".repeat(20) + "|__",
      "|" + "_".repeat(26) + "|",
      " |" + "_".repeat(24) + "|",
    ],
    // The spine's inside is blank fill, so the wall's light stops at it.
    kinds: ["", "   l" + "f".repeat(20) + "l"],
    reveal: ["", "     Psycho-Cybernetics"],
    // Each book's cells, as [first col, last col] by sprite row.
    body: [null, [3, 24], [3, 24], [0, 27], [1, 26]],
  },
  narrow: {
    at: [37, 13],
    rows: ["  ______", " |______|", "|________|", " |_______|"],
    body: [null, [1, 8], [0, 9], [1, 9]],
  },
} as const;

function books(size: Size): Part {
  const b = BOOKS[size];
  const [c, r] = b.at;
  return {
    id: "books",
    only: size,
    z: 2,
    fill: b.body
      .map((span, k) =>
        span ? cells(size, c + span[0], r + k, c + span[1], r + k) : "",
      )
      .filter(Boolean)
      .join(" "),
    dens: 0,
    solid: "fill",
    // Lying on the desk in front of the wall: from a high bulb their shadow
    // falls on the desk top, which the drawing sees edge on; from a low one it
    // reaches the wall beside them.
    standoff: [0.04, 0.2],
    sprite: {
      [size]: {
        at: mid(size, c, r),
        anchor: [0, 0],
        rows: [...b.rows],
        ...("kinds" in b ? { kinds: [...b.kinds], reveal: [...b.reveal] } : {}),
      },
    },
  };
}

/**
 * The notes float up and left of what they name, the PC's further, with a
 * short straight tick each: a curved arrow read as one more cable. Top-left
 * cell per grid.
 */
const NOTES: Record<
  string,
  Record<Size, { at: [number, number]; rows: string[] }>
> = {
  pc: {
    wide: {
      at: [1, 10],
      rows: ["# my desktop at home", "  # answers your questions"],
    },
    narrow: {
      at: [1, 4],
      rows: ["# my desktop at home", "  # answers your questions"],
    },
  },
  "pc-tick": {
    wide: { at: [12, 12], rows: ["|", "v"] },
    narrow: { at: [7, 6], rows: ["|", "v"] },
  },
  books: {
    wide: { at: [64, 20], rows: ["# my reading pile"] },
    narrow: { at: [37, 11], rows: ["# my reading pile"] },
  },
  "books-tick": {
    wide: { at: [72, 21], rows: ["|", "v"] },
    // A row higher would put the note in the lamp's shade at rest.
    narrow: { at: [40, 12], rows: ["v"] },
  },
};

const notes = (): Part[] =>
  Object.entries(NOTES).map(([id, grids]) => ({
    id: `note-${id}`,
    z: 5,
    sprite: Object.fromEntries(
      (["wide", "narrow"] as const).map((size) => {
        const { at, rows } = grids[size];
        return [
          size,
          {
            at: mid(size, ...at),
            anchor: [0, 0],
            rows,
            kinds: rows.map((l) => l.replace(/\S/g, "n")),
          },
        ];
      }),
    ),
  }));

export const SCENE: Scene = {
  id: "desk",
  parts: [
    {
      id: "desk",
      flat: true,
      // The ends span only the dots' row, so the corners stay `-`.
      lines: [
        `M8 ${DESK_Y} L 552 ${DESK_Y}`,
        `M8 ${DESK_B} L 552 ${DESK_B}`,
        `M8 ${DESK_Y + 6} L 8 ${DESK_B - 6}`,
        `M552 ${DESK_Y + 6} L 552 ${DESK_B - 6}`,
      ],
      fill: rect(8, DESK_Y, 544, DESK_B - DESK_Y),
      dens: 0.3,
      solid: "fill",
      face: { kind: "front" },
    },
    {
      // Today's legs, each one line leaning in a little, from the new underside.
      id: "legs",
      z: -1,
      lines: [`M38 ${DESK_B} L 42 372`, `M522 ${DESK_B} L 518 372`],
      solid: 2,
    },
    ...pc("wide"),
    ...pc("narrow"),
    {
      id: "wave",
      z: 4,
      role: "wave",
      hidden: true,
      lines: ["M118 207 L 162 207"],
      sprite: {
        wide: {
          at: mid("wide", BOX.wide.c + 23, BOX.wide.r + 5),
          anchor: [0, 0],
          rows: ["------------"],
          opaque: true,
        },
        narrow: {
          at: mid("narrow", BOX.narrow.c + 14, BOX.narrow.r + 3),
          anchor: [0, 0],
          rows: ["------"],
          opaque: true,
        },
      },
    },
    {
      // Out of the box's side as today, but straight over the desk's edge beside it and along the floor to the left.
      id: "cable",
      z: 1,
      role: "cable",
      lines: [
        "M195 236 C 212 238, 220 250, 222 260 C 225 274, 236 286, 240 300 C 246 322, 230 352, 196 372",
      ],
    },
    books("wide"),
    books("narrow"),
    {
      id: "mug",
      z: 4,
      fill: rect(392, 234, 28, 34),
      dens: 0.22,
      mat: MAT.ceramic,
      solid: "fill",
      face: { kind: "cyl", cx: 406, r: 15 },
      sprite: {
        wide: { at: [392, 266], anchor: [0, 7], ...MUG_WIDE },
        narrow: { at: [392, 252], anchor: [0, 4], ...MUG_NARROW },
      },
    },
    ...notes(),
  ],
  // On the panel's right edge: aimed further left, the lamp's springs lean it
  // 20 degrees off today's upright arm; here it's 14, the lean of the drawing
  // the page ships, and the x-ray still covers the PC.
  aim: [150, 214],
  deskTop: DESK_Y,
  lampX: { wide: 478, narrow: 503 },
  xray: { rect: [27.2, 168, 193.2, 262], art: ART },
  panel: {
    wide: [
      [113.5, 194.5],
      [166.5, 194.5],
      [166.5, 209.5],
      [113.5, 209.5],
    ],
    narrow: [
      [114, 202.5],
      [166, 202.5],
      [166, 215],
      [114, 215],
    ],
  },
  heat: { top: 166, x0: 35, x1: 190 },
};
