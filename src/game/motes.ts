// Motes: small lights hidden on a world's surface, one per depth tier. The first can be
// seen from the starting view; each later one sits in a crevice of the one before, at
// about half the size, so finding them all means descending through the fractal's levels.
//
// Placement is a pure function of the preset (seeded by its id), so every player gets
// the same motes and nothing but a bitmask needs saving.
import { FRACTALS, KIFS } from '../app/fractals';
import type { Preset } from '../app/presets';
import { kifsRotation } from '../math/de';

export interface Mote {
  x: number;
  y: number;
  z: number;
  /** Size of the surface features the mote sits among, in world units. */
  scale: number;
  /** 0 = out in the open, MOTES_PER_WORLD - 1 = deepest. */
  tier: number;
}

export const MOTES_PER_WORLD = 7;
/** Feature size per tier, as a fraction of the world's bounding radius. */
export const TIER_SCALES = [0.2, 0.1, 0.05, 0.025, 0.012, 0.006, 0.003];

/** A mote hovers this many scales above the surface, with at least CLEARANCE scales of room. */
const HOVER = 0.5;
const CLEARANCE = 0.12;
const GLOW_RADIUS = 0.12;
const COLLECT_RADIUS = 0.5;
/** The view scale at which a mote of scale 1 is being looked at; matches main.ts (3 × distance to surface). */
const VIEW_FACTOR = 1.5;
const MAX_ITERATIONS = 64;

const START_ATTEMPTS = 16;
const STEP_ATTEMPTS = 14;

type Dist = (x: number, y: number, z: number) => number;
type Rng = () => number;

/** FNV-1a, to turn a preset id into a seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded generator with a uniform output in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sphere-trace; returns the distance to the first point closer than eps to the surface, or -1. */
function trace(
  dist: Dist,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  eps: number, tMax: number, step: number,
): number {
  let t = 0;
  for (let i = 0; i < 600 && t < tMax; i++) {
    const d = dist(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < eps) return t;
    t += d * step;
  }
  return -1;
}

/** Outward unit normal from the distance field (tetrahedral differences); false where it is flat. */
function normalAt(dist: Dist, x: number, y: number, z: number, h: number, out: Float64Array): boolean {
  const a = dist(x + h, y - h, z - h);
  const b = dist(x - h, y - h, z + h);
  const c = dist(x - h, y + h, z - h);
  const d = dist(x + h, y + h, z + h);
  const nx = a - b - c + d;
  const ny = -a - b + c + d;
  const nz = -a + b - c + d;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-300)) return false;
  out[0] = nx / len;
  out[1] = ny / len;
  out[2] = nz / len;
  return true;
}

/** log10 of the magnification at which a mote's surroundings fill the view. */
export function moteDepth(m: Mote, bound: number): number {
  return Math.log10(bound / (VIEW_FACTOR * m.scale));
}

export const moteGlowRadius = (m: Mote): number => m.scale * GLOW_RADIUS;
export const moteCollectRadius = (m: Mote): number => m.scale * COLLECT_RADIUS;

/** The motes of a 3D preset, shallowest first. Deterministic. */
export function generateMotes(preset: Preset): Mote[] {
  const def = FRACTALS[preset.fractal];
  const p = preset.params;
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (preset.fractal === KIFS) kifsRotation(p[1], p[2], rot);
  const bound = def.bound(p);
  const logBase = Math.log(def.detailBase(p));
  const rng = mulberry32(hashString(preset.id));
  const n = new Float64Array(3);

  /** The surface as it is drawn when looked at from a mote of scale s (iterations follow zoom). */
  const distAt = (s: number): Dist => {
    const extra = Math.floor(Math.log(Math.max(1, bound / (VIEW_FACTOR * s))) / logBase);
    const iter = Math.min(MAX_ITERATIONS, preset.iter + extra);
    return (x, y, z) => def.dist(p, rot, iter, x, y, z);
  };
  const dists = TIER_SCALES.map((f) => distAt(f * bound));

  /** Hover point above a surface hit at tier j, into `c`; false if it is flat there or too cramped. */
  const hover = (j: number, px: number, py: number, pz: number, c: Float64Array): boolean => {
    const s = TIER_SCALES[j] * bound;
    const dist = dists[j];
    if (!normalAt(dist, px, py, pz, s * 0.05, n)) return false;
    c[0] = px + n[0] * s * HOVER;
    c[1] = py + n[1] * s * HOVER;
    c[2] = pz + n[2] * s * HOVER;
    return dist(c[0], c[1], c[2]) >= s * CLEARANCE && Math.hypot(c[0], c[1], c[2]) < bound;
  };

  const phase = rng() * Math.PI * 2;
  const tilt = rng();
  const cur = new Float64Array(3);
  const next = new Float64Array(3);
  const best = new Float64Array(3);

  const place = (k: number): Mote => {
    let bestTier = -1;
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
      // Start outside, spread around the shape on a golden-angle spiral, aimed near the middle.
      const u = ((k + tilt + attempt * 0.37) / MOTES_PER_WORLD) % 1;
      const cy = 1 - 2 * u;
      const sy = Math.sqrt(Math.max(0, 1 - cy * cy));
      const az = phase + (k + attempt * 0.61) * 2.399963229728653;
      const r = bound * 1.05;
      const ox = r * sy * Math.cos(az);
      const oy = r * cy;
      const oz = r * sy * Math.sin(az);
      let dx = (rng() * 2 - 1) * 0.3 * bound - ox;
      let dy = (rng() * 2 - 1) * 0.3 * bound - oy;
      let dz = (rng() * 2 - 1) * 0.3 * bound - oz;
      let inv = 1 / Math.hypot(dx, dy, dz);
      dx *= inv;
      dy *= inv;
      dz *= inv;
      const s0 = TIER_SCALES[0] * bound;
      const t0 = trace(dists[0], ox, oy, oz, dx, dy, dz, s0 * 0.02, bound * 2.2, def.stepScale);
      if (t0 < 0 || !hover(0, ox + dx * t0, oy + dy * t0, oz + dz * t0, cur)) continue;

      // Descend: from each hover point, drop a jittered ray back at the surface and hover
      // above the hit at the next, smaller scale.
      let j = 0;
      for (; j < k; j++) {
        const sPrev = TIER_SCALES[j] * bound;
        const sNext = TIER_SCALES[j + 1] * bound;
        if (!normalAt(dists[j], cur[0], cur[1], cur[2], sPrev * 0.05, n)) break;
        const nx = n[0];
        const ny = n[1];
        const nz = n[2];
        let stepped = false;
        for (let tries = 0; tries < STEP_ATTEMPTS && !stepped; tries++) {
          dx = -nx + (rng() * 2 - 1) * 0.7;
          dy = -ny + (rng() * 2 - 1) * 0.7;
          dz = -nz + (rng() * 2 - 1) * 0.7;
          inv = 1 / Math.hypot(dx, dy, dz);
          if (!Number.isFinite(inv)) continue;
          dx *= inv;
          dy *= inv;
          dz *= inv;
          const t = trace(dists[j + 1], cur[0], cur[1], cur[2], dx, dy, dz, sNext * 0.02, sPrev * 4, def.stepScale);
          if (t < 0) continue;
          stepped = hover(j + 1, cur[0] + dx * t, cur[1] + dy * t, cur[2] + dz * t, next);
        }
        if (!stepped) break;
        cur.set(next);
      }
      if (j > bestTier) {
        bestTier = j;
        best.set(cur);
      }
      if (j === k) break;
    }
    if (bestTier < 0) {
      // Nothing could be hit at all (it never happens for the shipped worlds): park it in the open.
      best[0] = 0;
      best[1] = bound * 0.98;
      best[2] = 0;
      bestTier = 0;
    }
    return { x: best[0], y: best[1], z: best[2], scale: TIER_SCALES[bestTier] * bound, tier: bestTier };
  };

  const motes: Mote[] = [];
  for (let k = 0; k < MOTES_PER_WORLD; k++) motes.push(place(k));
  return motes;
}
