/**
 * The lamp's joints, run in the light's worker. Each is a damped spring toward
 * where the aim point asks it to be, held in its range by a stiff spring past
 * the limit, so the arm leans and settles instead of spinning round.
 */
import { lampHead, type Pt } from "./desk";

export { AIM } from "./desk";

const deg = (d: number) => (d * Math.PI) / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

/** Screen angles, y down: 0 points right, -90deg straight up. */
const ARM = {
  L1: 112,
  L2: 100,
  shoulder: [deg(-128), deg(-64)],
  elbow: [deg(-150), deg(-22)],
  head: [deg(-118), deg(38)],
  // Absolute, clockwise from right: never above 20deg over the horizon, never at the wall.
  beam: [deg(25), deg(200)],
  knee: deg(14),
  w: [7.5, 9.5, 13],
  z: [0.78, 0.72, 0.62],
  stiff: 1400,
  REST: [440, 116] as Pt,
} as const;


function soft(x: number, lo: number, hi: number, k: number) {
  if (x > hi - k) return hi - k * Math.exp(-(x - (hi - k)) / k);
  if (x < lo + k) return lo + k * Math.exp(-(lo + k - x) / k);
  return x;
}

/** An angle kept inside [lo, hi] (0..2PI); outside, the bound nearer the current one. */
function keepIn(a: number, lo: number, hi: number, cur: number | null) {
  const TAU = Math.PI * 2;
  const n = ((a % TAU) + TAU) % TAU;
  if (n >= lo && n <= hi) return n;
  const ref = cur === null ? n : ((cur % TAU) + TAU) % TAU;
  return Math.abs(wrap(ref - lo)) < Math.abs(wrap(ref - hi)) ? lo : hi;
}

export type Pose = {
  S: Pt;
  E: Pt;
  H: Pt;
  dir: Pt;
} & ReturnType<typeof lampHead>;

export class Rig {
  q: [number, number, number] | null = null;
  v: [number, number, number] = [0, 0, 0];
  readonly S: Pt;
  constructor(S: Pt) {
    this.S = S;
  }

  /** Starts from a pose, so the first frame matches the text the page shipped. */
  from(E: Pt, H: Pt, dir: Pt) {
    const sh = Math.atan2(E[1] - this.S[1], E[0] - this.S[0]);
    const ua = Math.atan2(H[1] - E[1], H[0] - E[0]);
    this.q = [sh, wrap(ua - sh), wrap(Math.atan2(dir[1], dir[0]) - ua)];
    this.v = [0, 0, 0];
  }

  goal(P: Pt): [number, number, number] {
    const { L1, L2, REST, knee } = ARM;
    const S = this.S;
    let H: Pt = [
      REST[0] + (P[0] - REST[0]) * 0.3,
      REST[1] + (P[1] - REST[1]) * 0.22,
    ];
    H = [clamp(H[0], 330, 540), clamp(H[1], 44, S[1] - 40)];
    let dx = H[0] - S[0];
    let dy = H[1] - S[1];
    let d = Math.hypot(dx, dy);
    const maxR = L1 + L2 - 10;
    if (d > maxR) {
      H = [S[0] + (dx / d) * maxR, S[1] + (dy / d) * maxR];
      dx = H[0] - S[0];
      dy = H[1] - S[1];
      d = maxR;
    }
    const a = Math.atan2(dy, dx);
    const B = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    let sh = Math.sin(a + B) < Math.sin(a - B) ? a + B : a - B;
    sh = soft(wrap(sh), ARM.shoulder[0], ARM.shoulder[1], knee);
    const E: Pt = [S[0] + L1 * Math.cos(sh), S[1] + L1 * Math.sin(sh)];
    const el = soft(
      wrap(Math.atan2(H[1] - E[1], H[0] - E[0]) - sh),
      ARM.elbow[0],
      ARM.elbow[1],
      knee,
    );
    const ua = sh + el;
    const Hc: Pt = [E[0] + L2 * Math.cos(ua), E[1] + L2 * Math.sin(ua)];
    const now = this.q ? this.q[0] + this.q[1] + this.q[2] : null;
    const want = keepIn(
      Math.atan2(P[1] - Hc[1], P[0] - Hc[0]),
      ARM.beam[0],
      ARM.beam[1],
      now,
    );
    const [lo, hi] = ARM.head;
    let hd = wrap(want - ua);
    if (hd < lo || hd > hi) {
      const cur = this.q ? this.q[2] : hd;
      hd = Math.abs(wrap(cur - lo)) < Math.abs(wrap(cur - hi)) ? lo : hi;
    }
    return [sh, el, soft(hd, lo, hi, knee)];
  }

  /** Sub-stepped, so the stiff spring past a limit stays stable on a long frame. */
  step(goal: [number, number, number], dt: number, snap: boolean) {
    if (!this.q || snap) {
      this.q = [...goal];
      this.v = [0, 0, 0];
      return false;
    }
    const lim = [ARM.shoulder, ARM.elbow, ARM.head];
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    const cs = 2 * Math.sqrt(ARM.stiff);
    for (let s = 0; s < n; s++) {
      for (let j = 0; j < 3; j++) {
        const w = ARM.w[j]!;
        const q = this.q[j]!;
        let acc = w * w * wrap(goal[j]! - q) - 2 * ARM.z[j]! * w * this.v[j]!;
        const [lo, hi] = lim[j]!;
        if (q > hi!) acc -= ARM.stiff * (q - hi!) + cs * Math.max(0, this.v[j]!);
        else if (q < lo!) acc -= ARM.stiff * (q - lo!) + cs * Math.min(0, this.v[j]!);
        this.v[j] = this.v[j]! + acc * h;
        this.q[j] = q + this.v[j]! * h;
      }
    }
    return this.v.some((v, j) => Math.abs(v) > 0.02 || Math.abs(wrap(goal[j]! - this.q![j]!)) > 0.002);
  }

  pose(): Pose {
    const { L1, L2 } = ARM;
    const [sh, el, hd] = this.q!;
    const S = this.S;
    const E: Pt = [S[0] + L1 * Math.cos(sh), S[1] + L1 * Math.sin(sh)];
    const ua = sh + el;
    const H: Pt = [E[0] + L2 * Math.cos(ua), E[1] + L2 * Math.sin(ua)];
    const ang = ua + hd;
    const dir: Pt = [Math.cos(ang), Math.sin(ang)];
    return { S, E, H, dir, ...lampHead(H, dir) };
  }
}
