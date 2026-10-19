/**
 * The desk: the scene in ./scene.ts, drawn by ./ascii.ts. The SSG page and
 * the WebGL worker both call `rasterize` and must agree cell for cell, so the
 * engine avoids every Math function ECMA-262 lets engines approximate (sin,
 * exp, pow...): arithmetic, Math.sqrt and rounding are exact everywhere.
 * `pnpm run verify` re-rasterises and compares the built page.
 */
import * as A from "./ascii.ts";
import { SCENE } from "./scene.ts";

export {
  GRIDS,
  KIND,
  MAT,
  VIEW,
  lampHead,
  traceLines,
  type Desk,
  type Poly,
  type Pt,
  type Size,
} from "./ascii.ts";
export { SCENE };

/** Where the shade points at rest and while idle. */
export const AIM: A.Pt = SCENE.aim;

/** Where the box's cable ends, on the floor: its path's last point, where an answer's words come out. */
export const CABLE_END: A.Pt = (() => {
  const d = SCENE.parts.find((p) => p.role === "cable")?.lines?.[0] ?? "";
  const pts = A.parse(d).at(-1)?.pts ?? [];
  return pts.at(-1) ?? [0, 0];
})();

export function rasterize(
  cols: number,
  rows: number,
  // `lamp: false` leaves the lamp out, for a renderer that draws it moving.
  { lamp = true }: { lamp?: boolean } = {},
): A.Desk {
  const desk = A.rasterize(SCENE, cols, rows);
  return lamp ? A.withLamp(SCENE, desk) : desk;
}

export const lampBase = (cols: number, rows: number) =>
  A.lampBase(SCENE, cols, rows);
export const lampRest = (S: A.Pt) => A.lampRest(S, SCENE.aim);
/** Solid things against the wall, for the lamp's shadows. */
export const occupancy = (cols: number, rows: number) =>
  A.occupancy(SCENE, cols, rows);
/** Solid things clear of the wall (the books), and how far clear. */
export const standing = (cols: number, rows: number) =>
  A.standing(SCENE, cols, rows);

/** The grid as text, one line per row, with the LED cells split out. */
export function segments(desk: A.Desk): { text: string; led: boolean }[] {
  const out: { text: string; led: boolean }[] = [];
  let run = "";
  let led = false;
  for (let r = 0; r < desk.rows; r++) {
    for (let c = 0; c < desk.cols; c++) {
      const i = r * desk.cols + c;
      const isLed = desk.kind[i] === A.KIND.led;
      if (isLed !== led && run) {
        out.push({ text: run, led });
        run = "";
      }
      led = isLed;
      run += desk.chars[i];
    }
    if (r < desk.rows - 1) {
      if (led) {
        out.push({ text: run, led });
        run = "";
        led = false;
      }
      run += "\n";
    }
  }
  if (run) out.push({ text: run, led });
  return out;
}
