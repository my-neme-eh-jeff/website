import { component$ } from "@qwik.dev/core";

type Props = {
  /** Same seed always yields the same figure. */
  seed?: number;
  nodes?: number;
};

/**
 * Deterministic generative figure.
 *
 * Seeded rather than random: SSG runs at build time, so Math.random() would
 * emit different HTML on every deploy, churning the diff and making output
 * impossible to eyeball. Same seed, same bytes.
 */
function prng(seed: number) {
  // Mulberry32 — small, fast, good enough for layout jitter.
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Mesh = {
  pts: Array<{ x: number; y: number; r: number; d: number }>;
  /**
   * Resolved coordinates, not index pairs.
   *
   * Indices would force the render to do `pts[a].x`, which under
   * `noUncheckedIndexedAccess` is `possibly undefined` -- true for the
   * compiler even though the edge list is built from real indices. Resolving
   * here removes the lookup instead of asserting it away, and the geometry is
   * precomputed anyway, so it costs nothing.
   */
  edges: Array<{ x1: number; y1: number; x2: number; y2: number }>;
};

/**
 * Geometry lives outside the component and is memoised.
 *
 * Qwik best practice: keep computation out of the component body, so a render
 * never redoes work. Deterministic inputs mean the cache is always valid.
 * https://next.qwik.dev/docs/guides/best-practices/
 */
const meshCache = new Map<string, Mesh>();

function buildMesh(seed: number, nodes: number): Mesh {
  const key = `${seed}:${nodes}`;
  const hit = meshCache.get(key);
  if (hit) return hit;

  const rand = prng(seed);
  const pts = Array.from({ length: nodes }, () => ({
    x: +(rand() * 100).toFixed(2),
    y: +(rand() * 60).toFixed(2),
    r: +(0.5 + rand() * 1.4).toFixed(2),
    d: +(rand() * 3.6).toFixed(2),
  }));

  // Nearest-neighbour only — a full graph reads as noise.
  const edges: Mesh["edges"] = [];
  pts.forEach((p, i) => {
    pts
      .map((q, j) => ({ q, j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach((o) => {
        if (i < o.j) edges.push({ x1: p.x, y1: p.y, x2: o.q.x, y2: o.q.y });
      });
  });

  const mesh = { pts, edges };
  meshCache.set(key, mesh);
  return mesh;
}

export const GenerativeMesh = component$<Props>(({ seed = 7, nodes = 26 }) => {
  const { pts, edges } = buildMesh(seed, nodes);

  return (
    <svg
      class="block h-auto w-full"
      viewBox="0 0 100 60"
      role="img"
      aria-label="Abstract network figure"
      preserveAspectRatio="xMidYMid meet"
    >
      {edges.map((e, i) => (
        <line
          key={`e${i}`}
          class="stroke-accent [stroke-width:0.4] opacity-[0.28]"
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
        />
      ))}
      {pts.map((p, i) => (
        <circle
          key={`n${i}`}
          class="fill-accent animate-mesh-pulse motion-reduce:animate-none motion-reduce:opacity-50"
          cx={p.x}
          cy={p.y}
          r={p.r}
          style={{ animationDelay: `${p.d}s` }}
        />
      ))}
    </svg>
  );
});
