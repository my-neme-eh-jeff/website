/**
 * What the lamp shows inside the box. Read from the box on 2026-10-17 with
 * lscpu, nvidia-smi and udevadm's DMI memory fields (three of four DIMM slots
 * filled). The board and SSD are left unnamed on purpose; no software can
 * read a PSU.
 */
import { KIND, VIEW, type Desk } from "./ascii.ts";

const SPECS = {
  gpu: "RTX 2060",
  vram: "6GB GDDR6",
  cpu: "Ryzen 5 5600X",
  cpuShort: "5600X",
  ram: "24GB DDR4",
  ramShort: "24GB",
  ssd: "SSD",
  psu: "PSU",
};

/** Sized to the box's inside: 40x11 cells on the wide grid, 24x6 on the narrow. ~ is the load meter. */
export const ART = {
  wide: [
    `${" ".repeat(7)}${SPECS.cpu}${" ".repeat(20)}`,
    " .-.     .---------.    |||     .-.     ",
    "( + )    |  ( + )  |    |||    ( + )    ",
    " '-'     '---------'    |||     '-'     ",
    ` .-.${" ".repeat(20)}${SPECS.ram.padEnd(16)}`,
    `( + )   [::: ${SPECS.ssd} :::]${" ".repeat(19)}`,
    " '-'  .--------------------------------.",
    `      | ${SPECS.gpu.padEnd(8)}  ~~~~~~  ( + )  ( + ) |`,
    `      '${SPECS.vram.padStart(30, "-")}--'`,
    " ".repeat(40),
    `      [::::::::::::: ${SPECS.psu} ::::::::::::]  `,
  ],
  narrow: [
    " .-.   .------.  |||    ",
    "( + )  | (+)  |  |||    ",
    ` '-'   '-${SPECS.cpuShort}'  ${SPECS.ramShort}   `,
    " .--------------------. ",
    ` |${SPECS.gpu.padEnd(8)}  (+)  (+)  | `,
    ` '${SPECS.vram.padStart(20, "-")}' `,
  ],
};

/** Inks, as the shader numbers them. */
const TEXT = 0;
const MUTED = 1;
const ACCENT = 2;
const ALT = 3;

/** The box's own outline stays in front of what the light sees inside. */
const OUTLINE: number[] = [KIND.line, KIND.joint, KIND.steam];

/**
 * Per cell, for the worker's aux texture: 0 outside the box, 1 inside and
 * empty (the face is cleared, you see into the case), else the glyph index
 * + 2. Ink takes the low 3 bits of the second byte; 8 marks a fan's hub, 16 a
 * meter cell, whose index is in the top 3 bits. `inside` is the box's inside
 * in drawing units: x0, y0, x1, y1.
 */
export function xray(desk: Desk, inside: [number, number, number, number]) {
  const { cols, rows, owner, kind, roles } = desk;
  const [x0, y0, x1, y1] = inside;
  const n = cols * rows;
  const glyph = new Uint8Array(n);
  const ink = new Uint8Array(n);
  const cw = VIEW.w / cols;
  const ch = VIEW.h / rows;
  let c0 = cols;
  let c1 = -1;
  let r0 = rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = VIEW.x + (c + 0.5) * cw;
      const y = VIEW.y + (r + 0.5) * ch;
      if (!(x > x0 && x < x1 && y > y0 && y < y1)) continue;
      if (owner[i] === roles.box && OUTLINE.includes(kind[i]!)) continue;
      // The LED says whether the desk is online, so it always shows.
      if (kind[i] === KIND.led) continue;
      glyph[i] = 1;
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
    }
  const art = cols >= 120 ? ART.wide : ART.narrow;
  const left = c0 + Math.max(0, Math.floor((c1 - c0 + 1 - art[0]!.length) / 2));
  const labels: [string, number][] = [
    [SPECS.gpu, ALT],
    [SPECS.vram, TEXT],
    [SPECS.cpu, TEXT],
    [SPECS.cpuShort, TEXT],
    [SPECS.ram, TEXT],
    [SPECS.ramShort, TEXT],
    [SPECS.ssd, MUTED],
    [SPECS.psu, MUTED],
  ];
  let meter = 0;
  art.forEach((line, lr) => {
    const inks = new Array<number>(line.length).fill(TEXT);
    for (const [word, k] of labels) {
      const at = line.indexOf(word);
      if (at >= 0) for (let j = 0; j < word.length; j++) inks[at + j] = k;
    }
    for (let lc = 0; lc < line.length; lc++) {
      const chr = line[lc]!;
      const i = (r0 + lr) * cols + left + lc;
      if (chr === " " || !glyph[i]) continue;
      const hub = chr === "+" && (line[lc - 1] === "(" || line[lc - 2] === "(");
      const fan = hub || chr === "(" || chr === ")";
      glyph[i] = chr.charCodeAt(0) - 32 + 2;
      ink[i] =
        (fan ? ACCENT : inks[lc]!) |
        (hub ? 8 : 0) |
        (chr === "~" ? 16 | (meter++ << 5) : 0);
    }
  });
  return { glyph, ink, meters: meter };
}
