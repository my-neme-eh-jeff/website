/**
 * The SSG page and the WebGL worker both call `rasterize` and must agree cell
 * for cell, so it avoids every Math function ECMA-262 lets engines approximate
 * (sin, exp, pow...): arithmetic, Math.sqrt and rounding are exact everywhere.
 * `pnpm run verify` re-rasterises and compares the built page.
 */

/** Paths from the "Desk" artboard of the Portfolio Directions canvas. */
const VIEW = { x: 0, y: 24, w: 560, h: 356 };

const STROKES = [
  "M8 268 C 140 264, 420 271, 552 266",
  "M8 268 L 10 284 C 150 281, 420 287, 550 283 L 552 266",
  "M38 284 L 42 372",
  "M522 284 L 518 372",
  "M150 178 C 150 172, 154 168, 160 168 L 304 166 C 310 166, 314 170, 314 176 L 316 258 C 316 264, 312 267, 306 267 L 160 268 C 154 268, 150 264, 150 258 Z",
  "M176 186 L 176 246",
  "M188 186 L 188 246",
  "M200 186 L 200 246",
  "M212 186 L 212 246",
  "M316 236 C 352 238, 360 262, 380 265 C 420 266, 450 266, 474 268 C 490 300, 470 336, 500 374",
  "M392 206 L 396 262 C 397 266, 432 266, 434 262 L 438 206 Z",
  "M392 206 C 400 200, 430 200, 438 206 C 430 212, 400 212, 392 206 Z",
  "M438 218 C 456 218, 456 246, 436 248",
  "M40 262 L 126 256 L 128 266 L 42 270 Z",
  "M46 254 L 122 249 L 124 257",
  "M70 244 L 128 235",
  "M150 98 C 192 104, 214 128, 222 156",
  "M212 146 L 222 158 L 228 144",
];
const THIN = [
  "M232 194 L 290 190 L 292 214 L 234 218 Z",
  "M240 206 C 252 201, 262 209, 284 202",
];
const FILLS: [string, number][] = [
  [
    "M8 268 C 140 264, 420 271, 552 266 L 550 283 C 420 287, 150 281, 10 284 Z",
    0.3,
  ],
  [STROKES[4]!, 0.2],
  [THIN[0]!, 0.3],
  [STROKES[10]!, 0.2],
  [STROKES[13]!, 0.2],
];
const STEAM = [
  "M408 194 C 402 182, 414 174, 408 160 C 402 148, 414 140, 408 128",
  "M422 194 C 416 182, 428 174, 422 160 C 416 148, 428 140, 422 128",
];
const LED = { x: 294, y: 248, r: 5 };
const NOTE = {
  x: 18,
  y: 44,
  lines: ["# my desktop", "# answers your questions"],
};

export const GRIDS = {
  wide: { cols: 144, rows: 44 },
  narrow: { cols: 84, rows: 26 },
} as const;

/** Cell kinds, as the worker's mask stores them. */
export const KIND = {
  empty: 0,
  line: 1,
  fill: 2,
  note: 3,
  led: 4,
  steam: 5,
  joint: 6,
} as const;

export type Desk = {
  cols: number;
  rows: number;
  /** One character per cell, row-major. */
  chars: string[];
  kind: Uint8Array;
  /** Fill density, 0..1. */
  dens: Float32Array;
};

type Pt = [number, number];

function parse(d: string): { pts: Pt[]; closed: boolean }[] {
  const tok = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  const out: { pts: Pt[]; closed: boolean }[] = [];
  let pts: Pt[] = [];
  let i = 0;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    const c = tok[i++];
    if (c === "M") {
      if (pts.length) out.push({ pts, closed: false });
      pts = [[num(), num()]];
    } else if (c === "L") {
      pts.push([num(), num()]);
    } else if (c === "C") {
      const [x0, y0] = pts[pts.length - 1]!;
      const x1 = num(),
        y1 = num(),
        x2 = num(),
        y2 = num(),
        x3 = num(),
        y3 = num();
      for (let s = 1; s <= 24; s++) {
        const t = s / 24,
          u = 1 - t;
        const a = u * u * u,
          b = 3 * u * u * t,
          e = 3 * u * t * t,
          f = t * t * t;
        pts.push([
          a * x0 + b * x1 + e * x2 + f * x3,
          a * y0 + b * y1 + e * y2 + f * y3,
        ]);
      }
    } else if (c === "Z") {
      out.push({ pts, closed: true });
      pts = [];
    }
  }
  if (pts.length) out.push({ pts, closed: false });
  return out;
}

/** Samples per cell. A cell is about twice as tall as it is wide. */
const SX = 4;
const SY = 8;

class Canvas {
  readonly cols: number;
  readonly rows: number;
  readonly w: number;
  readonly h: number;
  readonly hit: Uint8Array;
  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.w = cols * SX;
    this.h = rows * SY;
    this.hit = new Uint8Array(this.w * this.h);
  }
  /** Sample (i, j) in drawing units. */
  sx(i: number) {
    return VIEW.x + ((i + 0.5) * VIEW.w) / this.w;
  }
  sy(j: number) {
    return VIEW.y + ((j + 0.5) * VIEW.h) / this.h;
  }
  col(x: number) {
    return ((x - VIEW.x) * this.w) / VIEW.w;
  }
  row(y: number) {
    return ((y - VIEW.y) * this.h) / VIEW.h;
  }
  range(lo: number, hi: number, n: number): [number, number] {
    return [Math.max(0, Math.floor(lo)), Math.min(n - 1, Math.ceil(hi))];
  }
  stroke(d: string, hw: number, dx = 0, dy = 0) {
    const hw2 = hw * hw;
    for (const { pts, closed } of parse(d)) {
      const n = closed ? pts.length : pts.length - 1;
      for (let k = 0; k < n; k++) {
        const [ax, ay] = pts[k]!;
        const [bx, by] = pts[(k + 1) % pts.length]!;
        const x0 = ax + dx,
          y0 = ay + dy,
          x1 = bx + dx,
          y1 = by + dy;
        const vx = x1 - x0,
          vy = y1 - y0;
        const len2 = vx * vx + vy * vy;
        const [i0, i1] = this.range(
          this.col(Math.min(x0, x1) - hw),
          this.col(Math.max(x0, x1) + hw),
          this.w,
        );
        const [j0, j1] = this.range(
          this.row(Math.min(y0, y1) - hw),
          this.row(Math.max(y0, y1) + hw),
          this.h,
        );
        for (let j = j0; j <= j1; j++) {
          const py = this.sy(j);
          for (let i = i0; i <= i1; i++) {
            const px = this.sx(i);
            let t = len2 > 0 ? ((px - x0) * vx + (py - y0) * vy) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = x0 + t * vx - px,
              ey = y0 + t * vy - py;
            if (ex * ex + ey * ey <= hw2) this.hit[j * this.w + i] = 1;
          }
        }
      }
    }
  }
  fill(d: string) {
    const polys = parse(d).map((p) => p.pts);
    for (let j = 0; j < this.h; j++) {
      const py = this.sy(j);
      const xs: number[] = [];
      for (const pts of polys) {
        for (let k = 0; k < pts.length; k++) {
          const [ax, ay] = pts[k]!;
          const [bx, by] = pts[(k + 1) % pts.length]!;
          if (ay <= py !== by <= py)
            xs.push(ax + ((py - ay) * (bx - ax)) / (by - ay));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const [i0, i1] = this.range(
          this.col(xs[k]!) - 0.5,
          this.col(xs[k + 1]!) - 0.5,
          this.w,
        );
        for (let i = i0; i <= i1; i++) {
          const px = this.sx(i);
          if (px >= xs[k]! && px <= xs[k + 1]!) this.hit[j * this.w + i] = 1;
        }
      }
    }
  }
  disc(x: number, y: number, r: number) {
    const r2 = r * r;
    const [i0, i1] = this.range(this.col(x - r), this.col(x + r), this.w);
    const [j0, j1] = this.range(this.row(y - r), this.row(y + r), this.h);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const ex = this.sx(i) - x,
          ey = this.sy(j) - y;
        if (ex * ex + ey * ey <= r2) this.hit[j * this.w + i] = 1;
      }
    }
  }
  /** Share of each cell's samples that were hit. */
  cover(): Float32Array {
    const out = new Float32Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let n = 0;
        for (let y = 0; y < SY; y++) {
          const base = (r * SY + y) * this.w + c * SX;
          for (let x = 0; x < SX; x++) n += this.hit[base + x]!;
        }
        out[r * this.cols + c] = n / (SX * SY);
      }
    }
    return out;
  }
}

/**
 * Each segment marks the cells it passes through, so lines are one character
 * wide. Directions are summed as doubled angles, so a line counts the same
 * drawn either way, and where two paths cross the sum cancels to a joint.
 */
function trace(paths: string[], cols: number, rows: number): string[] {
  const n = cols * rows;
  const A = new Float64Array(n);
  const B = new Float64Array(n);
  const hits = new Uint16Array(n);
  const owner = new Int16Array(n).fill(-1);
  const crossed = new Uint8Array(n);
  paths.forEach((d, id) => {
    for (const { pts, closed } of parse(d)) {
      const m = closed ? pts.length : pts.length - 1;
      for (let k = 0; k < m; k++) {
        const [ax, ay] = pts[k]!;
        const [bx, by] = pts[(k + 1) % pts.length]!;
        const u0 = ((ax - VIEW.x) * cols) / VIEW.w;
        const v0 = ((ay - VIEW.y) * rows) / VIEW.h;
        const du = ((bx - ax) * cols) / VIEW.w;
        const dv = ((by - ay) * rows) / VIEW.h;
        const sx = du * 0.6;
        const sy = dv * 1.25;
        const l2 = sx * sx + sy * sy;
        if (l2 === 0) continue;
        const c2 = (sx * sx - sy * sy) / l2;
        const s2 = (2 * sx * sy) / l2;
        const steps = Math.ceil(Math.max(Math.abs(du), Math.abs(dv)) * 2) + 1;
        for (let s = 0; s <= steps; s++) {
          const u = u0 + (s * du) / steps;
          const v = v0 + (s * dv) / steps;
          const c = Math.floor(u);
          const r = Math.floor(v);
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const i = r * cols + c;
          A[i] = A[i]! + c2;
          B[i] = B[i]! + s2;
          hits[i] = hits[i]! + 1;
          if (owner[i] === -1) owner[i] = id;
          else if (owner[i] !== id) crossed[i] = 1;
        }
      }
    }
  });
  const out = new Array<string>(n).fill("");
  for (let i = 0; i < n; i++) {
    const h = hits[i]!;
    if (!h) continue;
    const a = A[i]! / h;
    const b = B[i]! / h;
    const m = Math.sqrt(a * a + b * b);
    if (crossed[i] && m < 0.7) out[i] = "+";
    else if (a >= 0.7071 * m) out[i] = "-";
    else if (a <= -0.7071 * m) out[i] = "|";
    else out[i] = b > 0 ? "\\" : "/";
  }
  return out;
}

export function rasterize(cols: number, rows: number): Desk {
  const n = cols * rows;
  const cellW = VIEW.w / cols;

  const line = trace([...STROKES, ...THIN], cols, rows);
  const fills = FILLS.map(([d, a]) => {
    const c = new Canvas(cols, rows);
    c.fill(d);
    return [c.cover(), a] as const;
  });
  const steam = new Canvas(cols, rows);
  for (const d of STEAM) steam.stroke(d, cellW * 1.4);
  const led = new Canvas(cols, rows);
  led.disc(LED.x, LED.y, Math.max(LED.r, cellW * 0.9));
  const sm = steam.cover();
  const ld = led.cover();

  const chars: string[] = new Array(n).fill(" ");
  const kind = new Uint8Array(n);
  const dens = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (const [cov, a] of fills) f = Math.max(f, cov[i]! * a);
    dens[i] = f;
    if (ld[i]! >= 0.3) {
      kind[i] = KIND.led;
      chars[i] = "@";
    } else if (line[i]) {
      kind[i] = line[i] === "+" ? KIND.joint : KIND.line;
      chars[i] = line[i]!;
    } else if (f >= 0.15) {
      kind[i] = KIND.fill;
      chars[i] = f >= 0.35 ? "+" : f >= 0.25 ? ":" : ".";
    } else if (sm[i]! >= 0.3) {
      kind[i] = KIND.steam;
      chars[i] = (i * 7 + ((i / cols) | 0) * 3) % 5 < 2 ? ":" : ".";
    }
  }

  const noteCol = Math.round(((NOTE.x - VIEW.x) * cols) / VIEW.w);
  const noteRow = Math.round(((NOTE.y - VIEW.y) * rows) / VIEW.h);
  NOTE.lines.forEach((line, k) => {
    const r = noteRow + k;
    for (let j = 0; j < line.length && noteCol + j < cols; j++) {
      const i = r * cols + noteCol + j;
      if (line[j] === " ") continue;
      kind[i] = KIND.note;
      chars[i] = line[j]!;
    }
  });

  return { cols, rows, chars, kind, dens };
}

/** The grid as text, one line per row, with the LED cells split out. */
export function segments(desk: Desk): { text: string; led: boolean }[] {
  const out: { text: string; led: boolean }[] = [];
  let run = "";
  let led = false;
  for (let r = 0; r < desk.rows; r++) {
    for (let c = 0; c < desk.cols; c++) {
      const i = r * desk.cols + c;
      const isLed = desk.kind[i] === KIND.led;
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
