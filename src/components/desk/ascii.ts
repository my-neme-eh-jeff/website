/**
 * The redraw engine. A scene is parts in drawing units; each part can have
 * outlines, a fill that hides what is behind it, and hand-drawn sprites per
 * grid for things too small to trace. Like desk.ts it uses only exact
 * arithmetic (+ - * /, sqrt, floor, round), so the page's text and the
 * worker's grid agree cell for cell.
 *
 * What makes it read as drawn rather than plotted:
 * - a line's glyph comes from where it sits in the cell, not only its angle:
 *   `_` low, `-` mid, a top edge moves up a row as `_`, slopes run `_.-'`;
 * - a cell needs a real length of line in it, so diagonals don't double up
 *   as `\\\\` and near-verticals don't wobble into `||`;
 * - `+` only where two lines at the same depth really cross;
 * - a part in front hides lines and fills behind it.
 */
export type Pt = [number, number];
export type Poly = { pts: Pt[]; closed: boolean };

export const VIEW = { x: 0, y: 24, w: 560, h: 356 } as const;
export const GRIDS = {
  wide: { cols: 144, rows: 44 },
  narrow: { cols: 84, rows: 26 },
} as const;
export type Size = keyof typeof GRIDS;

export const KIND = {
  empty: 0,
  line: 1,
  fill: 2,
  note: 3,
  led: 4,
  steam: 5,
  joint: 6,
} as const;

/** What a fill is made of, for its glyphs and, sculpted, how it takes light. */
export const MAT = {
  dots: 0,
  wood: 1,
  mesh: 2,
  glass: 3,
  ceramic: 4,
  paper: 5,
  metal: 6,
  shadow: 7,
  /** A horizontal surface the light lands on: the desk top. */
  top: 8,
} as const;

/** How a part's surface faces, for sculpted shading. */
export type Face =
  | { kind: "front" }
  | { kind: "top" }
  | { kind: "side"; dir: 1 | -1 }
  | { kind: "cyl"; cx: number; r: number };

export type Sprite = {
  /** The drawing point that `anchor` (a cell in `rows`) sits on. */
  at: Pt;
  anchor: [number, number];
  rows: string[];
  /**
   * Per character: l line, f fill, s steam, n note, e led, x a cell the sprite
   * clears to empty; a space leaves the cell to whatever is behind.
   */
  kinds?: string[];
  /** Spaces clear the cells behind, within each row's length. */
  opaque?: boolean;
  /**
   * Per cell, what the lamp's light shows there instead, as the x-ray does.
   * A space shows nothing new; a no-break space shows a blank, as between a title's words.
   */
  reveal?: string[];
};

export type Part = {
  id: string;
  /** Higher is nearer. */
  z?: number;
  lines?: string[];
  fill?: string;
  /** 0..1: how dense the fill's glyphs are; 0 still hides what is behind. */
  dens?: number;
  mat?: number;
  face?: Face;
  /** Default: true when there's a fill. */
  occlude?: boolean;
  /** Casts the lamp's shadow: its fill, or its lines at this half-width. */
  solid?: "fill" | number;
  /**
   * A solid fill that stands clear of the wall, its back and its front as
   * fractions of the way from the wall to the bulb. Its shadow only reaches
   * the wall when the bulb is low enough to throw it past the desk top.
   * Without it, a solid thing fills the space from the wall to its face.
   */
  standoff?: [number, number];
  sprite?: Partial<Record<Size, Sprite>>;
  role?: "box" | "cable" | "panel" | "wave";
  /** Drawn on one grid only. */
  only?: Size;
  /** Its lines give it a role and an owner for its sprite, but aren't drawn. */
  hidden?: boolean;
  /** Its level lines stay mid-cell as `-`, never lifted to the row above as `_`: today's desk edges. */
  flat?: boolean;
};

export type Scene = {
  id: string;
  parts: Part[];
  /** Centre lines of the steam's wisps. */
  steam?: string[];
  steamW?: number;
  led?: { x: number; y: number; r: number };
  note?: { x: number; y: number; lines: string[] };
  /** Where the lamp points at rest. */
  aim: Pt;
  /** The desk top's y where the lamp stands, and the lamp base's x. */
  deskTop: number;
  lampX: number | Record<Size, number>;
  /** The inside of the box the lamp sees through, and what's in it. */
  xray: { rect: [number, number, number, number]; art: Record<Size, string[]> };
  panel?: Pt[] | Record<Size, Pt[]>;
  heat: { top: number; x0: number; x1: number };
};

export type Desk = {
  cols: number;
  rows: number;
  chars: string[];
  kind: Uint8Array;
  dens: Float32Array;
  mat: Uint8Array;
  /** Index into `faces` + 1 per fill cell, 0 for none. */
  face: Uint8Array;
  faces: Face[];
  /** Which path won each cell (-1 none), and how far along it, in drawing units. */
  owner: Int16Array;
  along: Float32Array;
  /** Each path's length in drawing units. */
  lengths: number[];
  /** Path indices by role. */
  roles: { box: number; cable: number; panel: number; wave: number };
  /** Which part owns each cell (-1 none). */
  part: Int16Array;
  /** Per cell, the character code the light reveals there (0 none). */
  reveal: Uint8Array;
};

export function parse(d: string): Poly[] {
  const tok = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  const out: Poly[] = [];
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

export class Canvas {
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
  stroke(d: string, hw: number) {
    const hw2 = hw * hw;
    for (const { pts, closed } of parse(d)) {
      const n = closed ? pts.length : pts.length - 1;
      for (let k = 0; k < n; k++) {
        const [x0, y0] = pts[k]!;
        const [x1, y1] = pts[(k + 1) % pts.length]!;
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

/* Cell size in em: Fira Mono's advance, by the line height. */
const CW = 0.6;
const CH = 1.25;

type Acc = {
  path: number;
  W: number;
  A: number;
  B: number;
  Y: number;
  y0: number;
  y1: number;
  /** Horizontal-ish samples: weight and summed fy. */
  Hw: number;
  HY: number;
  /** Vertical-ish samples: weight, summed fy. */
  Vw: number;
  VY: number;
  /** Rising and falling diagonal samples, and their summed fy. */
  Rw: number;
  RY: number;
  Fw: number;
  FY: number;
  RX: number;
  FX: number;
  L: number;
  /** A top edge lifted from the cell below: drawn as this. */
  force?: string;
};

/**
 * Every path's samples, per cell. Doubled angles, so a line counts the same
 * drawn either way; sub-cell positions, so its glyph can sit where it is.
 */
function accumulate(paths: Poly[][], cols: number, rows: number) {
  const cells = new Map<number, Acc[]>();
  const lengths: number[] = [];
  paths.forEach((polys, id) => {
    let walked = 0;
    for (const { pts, closed } of polys) {
      const m = closed ? pts.length : pts.length - 1;
      for (let k = 0; k < m; k++) {
        const [ax, ay] = pts[k]!;
        const [bx, by] = pts[(k + 1) % pts.length]!;
        const seg = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
        const u0 = ((ax - VIEW.x) * cols) / VIEW.w;
        const v0 = ((ay - VIEW.y) * rows) / VIEW.h;
        const du = ((bx - ax) * cols) / VIEW.w;
        const dv = ((by - ay) * rows) / VIEW.h;
        const sx = du * CW;
        const sy = dv * CH;
        const l2 = sx * sx + sy * sy;
        if (l2 === 0) continue;
        const vis = Math.sqrt(l2);
        const c2 = (sx * sx - sy * sy) / l2;
        const s2 = (2 * sx * sy) / l2;
        const steps = Math.ceil(Math.max(Math.abs(du), Math.abs(dv)) * 8) + 1;
        const w = vis / steps;
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const u = u0 + t * du;
          const v = v0 + t * dv;
          const c = Math.floor(u);
          const r = Math.floor(v);
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const i = r * cols + c;
          const fy = v - r;
          let list = cells.get(i);
          if (!list) cells.set(i, (list = []));
          let e = list.find((x) => x.path === id);
          if (!e) {
            e = {
              path: id,
              W: 0,
              A: 0,
              B: 0,
              Y: 0,
              y0: 1,
              y1: 0,
              Hw: 0,
              HY: 0,
              Vw: 0,
              VY: 0,
              Rw: 0,
              RY: 0,
              Fw: 0,
              FY: 0,
              RX: 0,
              FX: 0,
              L: 0,
            };
            list.push(e);
          }
          e.W += w;
          e.A += c2 * w;
          e.B += s2 * w;
          e.Y += fy * w;
          if (fy < e.y0) e.y0 = fy;
          if (fy > e.y1) e.y1 = fy;
          // cos 2θ past ±0.5: within 30° of horizontal, or of vertical.
          if (c2 > 0.5) {
            e.Hw += w;
            e.HY += fy * w;
          } else if (c2 < -0.5) {
            e.Vw += w;
            e.VY += fy * w;
          } else if (s2 < 0) {
            e.Rw += w;
            e.RY += fy * w;
            e.RX += (u - c) * w;
          } else {
            e.Fw += w;
            e.FY += fy * w;
            e.FX += (u - c) * w;
          }
          e.L += (walked + t * seg) * w;
        }
        walked += seg;
      }
    }
    lengths[id] = walked;
  });
  return { cells, lengths };
}

/**
 * A steep line that straddles a column boundary within a row leaves two
 * half-glyphs side by side (`\\\\`), and a flat one straddling a row boundary
 * stacks two: keep the one holding more of the line.
 */
function thin(cells: Map<number, Acc[]>, cols: number) {
  const angle = (e: Acc) => {
    const m = Math.sqrt(e.A * e.A + e.B * e.B);
    return m < 0.55 * e.W ? 0 : e.A / m;
  };
  const drop = new Set<Acc>();
  for (const [i, list] of cells) {
    for (const e of list) {
      const a = angle(e);
      if (a === 0) continue;
      const steep = a < COS2_45;
      const j = steep ? i + 1 : i + cols;
      if (steep && (i + 1) % cols === 0) continue;
      const f = cells.get(j)?.find((x) => x.path === e.path);
      if (!f) continue;
      const b = angle(f);
      if (b === 0 || b < COS2_45 !== steep) continue;
      drop.add(e.W < f.W ? e : f);
    }
  }
  for (const [i, list] of cells) {
    const keep = list.filter((e) => !drop.has(e));
    if (keep.length) cells.set(i, keep);
    else cells.delete(i);
  }
}

/**
 * A line in a cell's top quarter is the bottom of the cell above: move it up
 * as `_` before anything is resolved, so depth still decides who shows. If the
 * same path already runs in the cell above, it's drawn; drop the stray.
 */
function lift(cells: Map<number, Acc[]>, cols: number) {
  const moves: [number, Acc][] = [];
  for (const [i, list] of cells)
    for (const e of list) if (glyphOf(e)?.up) moves.push([i, e]);
  for (const [i, e] of moves) {
    const list = cells.get(i)!;
    list.splice(list.indexOf(e), 1);
    if (!list.length) cells.delete(i);
    const up = i - cols;
    if (up < 0) continue;
    const above = cells.get(up) ?? [];
    const same = above.find((x) => x.path === e.path);
    if (same && glyphOf(same)) continue;
    if (same) above.splice(above.indexOf(same), 1);
    above.push({ ...e, force: "_" });
    cells.set(up, above);
  }
}

/* cos 2θ at the angle bands' edges. */
const COS2_10 = 0.9396926;
const COS2_20 = 0.7660444;
const COS2_36 = 0.309017;
const COS2_45 = 0;
const COS2_55 = -0.3420201;
const COS2_74 = -0.8480481;

type Pick = { ch: string; up?: boolean; len: number };

/** The glyph for one path's share of a cell, or null if it barely touches it. */
function glyphOf(e: Acc): Pick | null {
  if (e.force) return { ch: e.force, len: e.W };
  const W = e.W;
  const m = Math.sqrt(e.A * e.A + e.B * e.B) / W;
  const fy = e.Y / W;
  const ext = e.y1 - e.y0;
  if (m >= 0.55) {
    const a = e.A / (W * m);
    const b = e.B / (W * m);
    const cos = Math.sqrt((1 + a) / 2);
    const sin = Math.sqrt(Math.max(0, (1 - a) / 2));
    const full = Math.min(
      cos > 1e-6 ? CW / cos : 1e9,
      sin > 1e-6 ? CH / sin : 1e9,
    );
    if (W / full < 0.42) return null;
    if (a >= COS2_10) {
      if (fy >= 0.6) return { ch: "_", len: W };
      if (fy >= 0.24) return { ch: "-", len: W };
      return { ch: "-", up: true, len: W };
    }
    if (a >= COS2_36) {
      if (fy < 0.2 && a >= COS2_20) return { ch: "-", up: true, len: W };
      if (fy >= 0.7) return { ch: "_", len: W };
      if (fy >= 0.5) return { ch: ".", len: W };
      if (fy >= 0.3) return { ch: "-", len: W };
      return { ch: b < 0 ? "'" : "`", len: W };
    }
    if (a >= COS2_55) {
      if (ext >= 0.55) return { ch: b < 0 ? "/" : "\\", len: W };
      if (fy >= 0.5) return { ch: ".", len: W };
      return { ch: b < 0 ? "'" : "`", len: W };
    }
    if (a >= COS2_74) return { ch: b < 0 ? "/" : "\\", len: W };
    return { ch: "|", len: W };
  }
  // Mixed directions from one path: a corner, a peak or a dip.
  if (W < CW * 0.5) return null;
  const big = Math.max(e.Hw, e.Vw, e.Rw, e.Fw);
  if (e.Rw > 0.35 * W && e.Fw > 0.35 * W) {
    // Falling then rising, left to right, meeting low, is a dip; the mirror, high, a peak.
    const low = (e.RY + e.FY) / (e.Rw + e.Fw) > 0.5;
    const dip = e.FX / e.Fw < e.RX / e.Rw;
    if (dip && low) return { ch: "v", len: W };
    if (!dip && !low) return { ch: "^", len: W };
  }
  if (e.Hw > 0.2 * W && e.Vw > 0.2 * W) {
    const hy = e.HY / e.Hw;
    const vy = e.VY / e.Vw;
    if (hy >= 0.62) return vy > hy ? null : { ch: "|", len: W };
    if (hy < 0.24)
      return vy > hy ? { ch: "|", len: W } : { ch: "-", up: true, len: W };
    return { ch: vy > hy ? "." : "'", len: W };
  }
  // A curve's bend: low or high in the cell.
  if (big === e.Hw) return { ch: fy >= 0.6 ? "_" : "-", len: W };
  if (big === e.Vw) return { ch: "|", len: W };
  if (fy >= 0.55) return { ch: ".", len: W };
  return { ch: big === e.Rw ? "'" : "`", len: W };
}

export function rasterize(scene: Scene, cols: number, rows: number): Desk {
  const n = cols * rows;
  const size: Size = cols >= 120 ? "wide" : "narrow";
  const parts = scene.parts.filter((p) => !p.only || p.only === size);

  // Paths, in part order; each knows its part.
  const pathPart: number[] = [];
  const polys: Poly[][] = [];
  const roles = { box: -1, cable: -1, panel: -1, wave: -1 };
  const firstPath: number[] = [];
  parts.forEach((p, pi) => {
    firstPath[pi] = p.lines?.length ? polys.length : -1;
    (p.lines ?? []).forEach((d, k) => {
      if (p.role && k === 0) roles[p.role] = polys.length;
      pathPart.push(pi);
      polys.push(parse(d));
    });
  });
  const z = (pi: number) => parts[pi]!.z ?? 0;

  // What each part's fill covers.
  const covers = parts.map((p) => {
    if (!p.fill || p.sprite?.[size]) return null;
    const c = new Canvas(cols, rows);
    c.fill(p.fill);
    return c.cover();
  });

  const { cells, lengths } = accumulate(polys, cols, rows);
  thin(cells, cols);
  // A flat part's level lines keep their row, mid-cell, before lift can move them.
  for (const list of cells.values())
    for (const e of list)
      if (parts[pathPart[e.path]!]!.flat && level(e)) e.force = "-";
  lift(cells, cols);

  const chars: string[] = new Array(n).fill(" ");
  const kind = new Uint8Array(n);
  const dens = new Float32Array(n);
  const mat = new Uint8Array(n);
  const face = new Uint8Array(n);
  const faces: Face[] = [];
  const faceOf = parts.map((p) => {
    if (!p.face) return 0;
    faces.push(p.face);
    return faces.length;
  });
  const owner = new Int16Array(n).fill(-1);
  const along = new Float32Array(n);
  const partAt = new Int16Array(n).fill(-1);
  const top = new Int16Array(n).fill(-1);
  const reveal = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    // The nearest part whose fill hides this cell.
    let oz = -Infinity;
    let opi = -1;
    covers.forEach((cov, pi) => {
      if (!cov || cov[i]! < 0.5) return;
      if (parts[pi]!.occlude === false) return;
      if (z(pi) > oz || (z(pi) === oz && pi > opi)) {
        oz = z(pi);
        opi = pi;
      }
    });

    // Lines at or in front of it; the nearest of those win.
    const picks: { e: Acc; g: Pick; pz: number; pi: number }[] = [];
    for (const e of cells.get(i) ?? []) {
      const pi = pathPart[e.path]!;
      if (z(pi) < oz || parts[pi]!.hidden) continue;
      const g = glyphOf(e);
      if (g) picks.push({ e, g, pz: z(pi), pi });
    }
    if (picks.length) {
      const nz = Math.max(...picks.map((p) => p.pz));
      const near = picks.filter((p) => p.pz === nz);
      near.sort((x, y) => y.g.len - x.g.len);
      const best = near[0]!;
      // Two lines that both run the cell, at different angles: they cross.
      const other = near.find(
        (p) =>
          p.e.path !== best.e.path &&
          p.pi !== best.pi &&
          p.g.len > 0.6 * best.g.len &&
          "_-|/\\".includes(p.g.ch) &&
          "_-|/\\".includes(best.g.ch) &&
          dirClass(p.g.ch) !== dirClass(best.g.ch),
      );
      if (other) {
        chars[i] = "+";
        kind[i] = KIND.joint;
      } else {
        chars[i] = best.g.ch;
        kind[i] = KIND.line;
      }
      owner[i] = best.e.path;
      along[i] = best.e.L / best.e.W;
      partAt[i] = best.pi;
      top[i] = nz;
      continue;
    }
    if (opi >= 0) {
      const p = parts[opi]!;
      const d = (p.dens ?? 0) * covers[opi]![i]!;
      dens[i] = d;
      mat[i] = p.mat ?? MAT.dots;
      face[i] = faceOf[opi]!;
      partAt[i] = opi;
      top[i] = oz;
      if (d >= 0.15) {
        kind[i] = KIND.fill;
        chars[i] = fillGlyph(mat[i]!, d, i, cols);
      }
    }
  }

  // Sprites, nearest last.
  const order = parts
    .map((p, pi) => ({ p, pi }))
    .filter(({ p }) => p.sprite?.[size])
    .sort((a, b) => z(a.pi) - z(b.pi));
  for (const { p, pi } of order) {
    const s = p.sprite![size]!;
    const ac = Math.floor(((s.at[0] - VIEW.x) * cols) / VIEW.w) - s.anchor[0];
    const ar = Math.floor(((s.at[1] - VIEW.y) * rows) / VIEW.h) - s.anchor[1];
    s.rows.forEach((line, r) => {
      // Opaque means between a row's first and last glyph, not its margins.
      const lo = line.search(/\S/);
      const hi = line.length - 1 - (line.match(/\s*$/)?.[0].length ?? 0);
      for (let c = 0; c < line.length; c++) {
        const ch = line[c]!;
        const inside = s.opaque && c > lo && c < hi;
        const k =
          s.kinds?.[r]?.[c] ?? (ch === " " ? (inside ? "x" : " ") : "l");
        if (k === " ") continue;
        const cc = ac + c;
        const rr = ar + r;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const i = rr * cols + cc;
        if (top[i]! > z(pi)) continue;
        top[i] = z(pi);
        partAt[i] = pi;
        owner[i] = firstPath[pi]!;
        // Where it sits along the part's own path, so the comet and the draw-in can follow a drawn outline.
        along[i] =
          firstPath[pi]! >= 0
            ? nearestAlong(
                polys[firstPath[pi]!]!,
                VIEW.x + ((cc + 0.5) * VIEW.w) / cols,
                VIEW.y + ((rr + 0.5) * VIEW.h) / rows,
              )
            : 0;
        const rv = s.reveal?.[r]?.[c];
        reveal[i] =
          !rv || rv === " " ? 0 : rv === "\u00a0" ? 32 : rv.charCodeAt(0);
        if (k === "x") {
          chars[i] = " ";
          kind[i] = KIND.empty;
          continue;
        }
        chars[i] = ch;
        kind[i] =
          k === "f"
            ? KIND.fill
            : k === "s"
              ? KIND.steam
              : k === "n"
                ? KIND.note
                : k === "e"
                  ? KIND.led
                  : KIND.line;
        if (k === "f") {
          dens[i] = p.dens ?? 0.3;
          mat[i] = p.mat ?? MAT.dots;
          face[i] = faceOf[pi]!;
        }
      }
    });
  }

  if (scene.steam) {
    const sc = new Canvas(cols, rows);
    for (const d of scene.steam)
      sc.stroke(d, (scene.steamW ?? 1.4) * (VIEW.w / cols));
    const sm = sc.cover();
    for (let i = 0; i < n; i++) {
      if (kind[i] !== KIND.empty || sm[i]! < 0.3) continue;
      kind[i] = KIND.steam;
      chars[i] = ((i / cols) | 0) % 2 === 0 ? "(" : ")";
    }
  }

  if (scene.led) {
    const lc = new Canvas(cols, rows);
    lc.disc(
      scene.led.x,
      scene.led.y,
      Math.max(scene.led.r, (VIEW.w / cols) * 0.9),
    );
    const ld = lc.cover();
    for (let i = 0; i < n; i++)
      if (ld[i]! >= 0.3) {
        kind[i] = KIND.led;
        chars[i] = "@";
      }
  }

  if (scene.note) {
    const { note } = scene;
    const nc = Math.round(((note.x - VIEW.x) * cols) / VIEW.w);
    const nr = Math.round(((note.y - VIEW.y) * rows) / VIEW.h);
    note.lines.forEach((line, k) => {
      const r = nr + k;
      for (let j = -1; j <= line.length && nc + j < cols; j++) {
        const i = r * cols + nc + j;
        if (nc + j < 0) continue;
        const ch = line[j] ?? " ";
        kind[i] = ch === " " ? KIND.empty : KIND.note;
        chars[i] = ch;
        owner[i] = -1;
        partAt[i] = -1;
      }
    });
  }

  return {
    cols,
    rows,
    chars,
    kind,
    dens,
    mat,
    face,
    faces,
    owner,
    along,
    lengths,
    roles,
    part: partAt,
    reveal,
  };
}

/** A line within 10° of level that runs most of its cell. */
function level(e: Acc) {
  const m = Math.sqrt(e.A * e.A + e.B * e.B);
  return m >= 0.55 * e.W && e.A / m >= COS2_10 && e.W >= 0.42 * CW;
}

/** How far along a path, in drawing units, its nearest point to (x, y) is. */
function nearestAlong(polys: Poly[], x: number, y: number) {
  let best = Infinity;
  let at = 0;
  let walked = 0;
  for (const { pts, closed } of polys) {
    const m = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < m; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[(k + 1) % pts.length]!;
      const vx = bx - ax;
      const vy = by - ay;
      const l2 = vx * vx + vy * vy;
      const seg = Math.sqrt(l2);
      let t = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ax + t * vx - x;
      const dy = ay + t * vy - y;
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy;
        at = walked + t * seg;
      }
      walked += seg;
    }
  }
  return at;
}

function dirClass(ch: string) {
  return ch === "_" || ch === "-" ? 0 : ch === "|" ? 1 : ch === "/" ? 2 : 3;
}

/** A fill's glyph by material and density; seeded by the cell, never random. */
export function fillGlyph(m: number, d: number, i: number, cols: number) {
  const h = (i * 2654435761) >>> 0;
  const r = (i / cols) | 0;
  if (m === MAT.wood) {
    // Grain: long runs along the board, broken now and then.
    const run = ((((i % cols) + r * 37) / 9) | 0) * 7 + r * 13;
    const g = (run * 2654435761) >>> 0;
    if (g % 5 === 0) return h % 3 === 0 ? "=" : "-";
    return d >= 0.3 && h % 7 === 0 ? "." : " ";
  }
  if (m === MAT.mesh) return (i + r) % 2 === 0 ? ":" : ".";
  if (m === MAT.glass) return h % 11 === 0 ? "." : " ";
  if (m === MAT.paper) return "=";
  if (m === MAT.shadow) return d >= 0.35 ? ":" : ".";
  return d >= 0.35 ? "+" : d >= 0.25 ? ":" : ".";
}

/** The grid as rows of text. */
export function text(desk: Desk) {
  const out: string[] = [];
  for (let r = 0; r < desk.rows; r++)
    out.push(desk.chars.slice(r * desk.cols, (r + 1) * desk.cols).join(""));
  return out;
}

/** Characters for polylines on the grid, the way the drawing's own lines are placed. */
export function traceLines(paths: Poly[][], cols: number, rows: number) {
  const { cells } = accumulate(paths, cols, rows);
  thin(cells, cols);
  // The lamp's level strokes stay `-`, as today's tracer draws its arm, not stepped into `_`.
  for (const list of cells.values())
    for (const e of list) if (level(e)) e.force = "-";
  lift(cells, cols);
  const out = new Array<string>(cols * rows).fill("");
  for (const [i, list] of cells) {
    let best: Pick | null = null;
    for (const e of list) {
      const g = glyphOf(e);
      if (g && (!best || g.len > best.len)) best = g;
    }
    if (best) out[i] = best.ch;
  }
  return out;
}

/** What casts the lamp's shadow from against the wall. */
export function occupancy(scene: Scene, cols: number, rows: number) {
  const c = new Canvas(cols, rows);
  const size: Size = cols >= 120 ? "wide" : "narrow";
  for (const p of scene.parts) {
    if (p.only && p.only !== size) continue;
    if (p.standoff) continue;
    if (p.solid === "fill" && p.fill) c.fill(p.fill);
    else if (typeof p.solid === "number")
      for (const d of p.lines ?? []) c.stroke(d, p.solid);
  }
  const cov = c.cover();
  const occ = new Uint8Array(cols * rows);
  for (let i = 0; i < occ.length; i++) occ[i] = cov[i]! > 0.28 ? 1 : 0;
  return occ;
}

/** What casts the lamp's shadow from clear of the wall, and how far clear: one depth for all of it. */
export function standing(scene: Scene, cols: number, rows: number) {
  const size: Size = cols >= 120 ? "wide" : "narrow";
  const parts = scene.parts.filter(
    (p) =>
      p.standoff &&
      p.solid === "fill" &&
      p.fill &&
      (!p.only || p.only === size),
  );
  if (!parts.length) return null;
  const c = new Canvas(cols, rows);
  for (const p of parts) c.fill(p.fill!);
  const cov = c.cover();
  const occ = new Uint8Array(cols * rows);
  for (let i = 0; i < occ.length; i++) occ[i] = cov[i]! > 0.28 ? 1 : 0;
  return { occ, depth: parts[0]!.standoff! };
}

/**
 * The lamp's base on the desk top, ending before anything else there, with
 * the switch in it (I on, O off) and the pivot above it.
 */
export function lampBase(scene: Scene, cols: number, rows: number) {
  const text = cols >= 120 ? "/====[I]===\\" : "/=[I]=\\";
  const cw = VIEW.w / cols;
  const ch = VIEW.h / rows;
  const row = Math.floor((scene.deskTop - VIEW.y) / ch) - 1;
  const lx =
    typeof scene.lampX === "number"
      ? scene.lampX
      : scene.lampX[cols >= 120 ? "wide" : "narrow"];
  const start = Math.round((lx - VIEW.x) / cw) - Math.floor(text.length / 2);
  const sw = start + text.indexOf("[");
  return {
    row,
    start,
    text,
    sw,
    S: [VIEW.x + (sw + 1.5) * cw, VIEW.y + (row - 0.5) * ch] as Pt,
    pivot: (row - 1) * cols + sw + 1,
  };
}

/** The shade, its bulb and the neck, for a head position and direction. */
export function lampHead(H: Pt, dir: Pt) {
  const p: Pt = [-dir[1], dir[0]];
  const at = (s: number, k: number): Pt => [
    H[0] + dir[0] * s + p[0] * k,
    H[1] + dir[1] * s + p[1] * k,
  ];
  return {
    bulb: at(22, 0),
    shade: [at(0, 4.5), at(30, 18), at(30, -18), at(0, -4.5)] as Pt[],
    neck: [H, at(-8, 0)] as Pt[],
  };
}

/** The lamp at rest, leaning over the desk with the shade on `aim`. */
export function lampRest(S: Pt, aim: Pt) {
  const E: Pt = [S[0] - 26, S[1] - 110];
  const H: Pt = [E[0] - 99, E[1] - 7];
  const ax = aim[0] - H[0];
  const ay = aim[1] - H[1];
  const len = Math.sqrt(ax * ax + ay * ay);
  const dir: Pt = [ax / len, ay / len];
  return { E, H, dir, ...lampHead(H, dir) };
}

export const cellOf = ([x, y]: Pt, cols: number, rows: number) => {
  const c = Math.floor(((x - VIEW.x) * cols) / VIEW.w);
  const r = Math.floor(((y - VIEW.y) * rows) / VIEW.h);
  return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
};

/** The whole static drawing, lamp at rest included, as the page ships it. */
export function withLamp(scene: Scene, desk: Desk) {
  const { cols, rows } = desk;
  const chars = desk.chars.slice();
  const kind = desk.kind.slice();
  const base = lampBase(scene, cols, rows);
  const rest = lampRest(base.S, scene.aim);
  const drawn = traceLines(
    [
      [{ pts: [base.S, rest.E, rest.H], closed: false }],
      [{ pts: rest.shade, closed: true }],
      [{ pts: rest.neck, closed: false }],
    ],
    cols,
    rows,
  );
  const put = (i: number, ch: string) => {
    if (i < 0 || i >= chars.length) return;
    kind[i] = KIND.line;
    chars[i] = ch;
  };
  drawn.forEach((ch, i) => ch && put(i, ch));
  [...base.text].forEach((ch, k) =>
    put(base.row * cols + base.start + k, ch === "I" ? "O" : ch),
  );
  put(base.pivot, "o");
  put(cellOf(rest.E, cols, rows), "o");
  return { ...desk, chars, kind };
}
