// The property the ray marcher relies on: a step of (stepScale * DE) never lands inside the set.
// Each test checks that against a membership test that is independent of the DE formula.
import { describe, expect, it } from 'vitest';
import { BOX, BULB, FRACTALS, KIFS } from '../src/app/fractals';
import { BULB_BAILOUT, deBox, deBulb, deKifs, kifsRotation } from '../src/math/de';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random unit vector written into out. */
function randomDir(rand: () => number, out: number[]): void {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  out[0] = s * Math.cos(a);
  out[1] = s * Math.sin(a);
  out[2] = z;
}

/** Escape-time membership of the Mandelbulb iterated to the same depth the DE uses. */
function bulbInside(px: number, py: number, pz: number, power: number, iter: number): boolean {
  let x = px, y = py, z = pz;
  for (let i = 0; i < iter; i++) {
    const r = Math.hypot(x, y, z);
    if (r > BULB_BAILOUT) return false;
    const theta = Math.acos(Math.min(1, Math.max(-1, z / Math.max(r, 1e-12)))) * power;
    const phi = Math.atan2(y, x) * power;
    const zr = Math.pow(r, power);
    x = zr * Math.sin(theta) * Math.cos(phi) + px;
    y = zr * Math.sin(theta) * Math.sin(phi) + py;
    z = zr * Math.cos(theta) + pz;
  }
  return Math.hypot(x, y, z) <= BULB_BAILOUT;
}

/** Bounded-orbit membership of the Mandelbox (long orbit, large escape radius). */
function boxInside(px: number, py: number, pz: number, scale: number, minR: number, fold: number): boolean {
  const f = (v: number): number => Math.min(fold, Math.max(-fold, v)) * 2 - v;
  let x = px, y = py, z = pz;
  for (let i = 0; i < 400; i++) {
    x = f(x); y = f(y); z = f(z);
    const k = 1 / Math.min(1, Math.max(minR * minR, x * x + y * y + z * z));
    x = x * k * scale + px;
    y = y * k * scale + py;
    z = z * k * scale + pz;
    if (x * x + y * y + z * z > 1e6) return false;
  }
  return true;
}

/** Exact membership of the level-n Menger sponge on [-1, 1]^3, from base-3 digits. */
function mengerInside(px: number, py: number, pz: number, levels: number): boolean {
  if (Math.abs(px) > 1 || Math.abs(py) > 1 || Math.abs(pz) > 1) return false;
  let x = (px + 1) / 2, y = (py + 1) / 2, z = (pz + 1) / 2;
  for (let i = 0; i < levels; i++) {
    x *= 3; y *= 3; z *= 3;
    const dx = Math.min(2, Math.floor(x)), dy = Math.min(2, Math.floor(y)), dz = Math.min(2, Math.floor(z));
    if ((dx === 1 ? 1 : 0) + (dy === 1 ? 1 : 0) + (dz === 1 ? 1 : 0) >= 2) return false;
    x -= dx; y -= dy; z -= dz;
  }
  return true;
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// The Mandelbulb and Mandelbox estimators are first-order (see docs/MATH.md), not rigorous
// bounds, so the tests pin down exactly how far they can be trusted:
//   - any step longer than `safeStep` never enters the set, and
//   - shorter steps (already inside the thin shell next to the surface) overshoot only rarely.
interface Tally {
  rays: number;
  overshoots: number;
  longOvershoots: number;
}

function tallySteps(
  rand: () => number,
  samples: number,
  extent: number,
  safeStep: number,
  step: number,
  inside: (x: number, y: number, z: number) => boolean,
  de: (x: number, y: number, z: number) => number,
): Tally {
  const dir = [0, 0, 0];
  const tally: Tally = { rays: 0, overshoots: 0, longOvershoots: 0 };
  for (let tested = 0; tested < samples; ) {
    const px = (rand() * 2 - 1) * extent, py = (rand() * 2 - 1) * extent, pz = (rand() * 2 - 1) * extent;
    if (inside(px, py, pz)) continue;
    const d = de(px, py, pz);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
    tested++;
    for (let k = 0; k < 16; k++) {
      randomDir(rand, dir);
      tally.rays++;
      if (inside(px + dir[0] * d * step, py + dir[1] * d * step, pz + dir[2] * d * step)) {
        tally.overshoots++;
        if (d >= safeStep) tally.longOvershoots++;
      }
    }
  }
  return tally;
}

describe('Mandelbulb distance estimator', () => {
  it.each([8, 5, 3, 2])('marching steps stay outside the set (power %d)', (power) => {
    const iter = 10;
    const t = tallySteps(
      rng(1000 + power), 6000, 1.4, 0.03, FRACTALS[BULB].stepScale,
      (x, y, z) => bulbInside(x, y, z, power, iter),
      (x, y, z) => deBulb(x, y, z, power, 0, 0, iter),
    );
    expect(t.longOvershoots).toBe(0);
    expect(t.overshoots / t.rays).toBeLessThan(0.002);
  });

  it('shrinks to zero toward the surface and grows with distance outside', () => {
    const far = deBulb(3, 0.2, 0.1, 8, 0, 0, 10);
    const near = deBulb(1.3, 0.2, 0.1, 8, 0, 0, 10);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThan(3); // never claims more room than the distance to the origin
    expect(near).toBeGreaterThan(0);
  });
});

describe('Mandelbox distance estimator', () => {
  it.each([
    [2.0, 0.5, 1.0],
    [2.6, 0.4, 1.0],
    [1.8, 0.7, 0.9],
  ])('marching steps stay outside the set (scale %d, minR %d, fold %d)', (scale, minR, fold) => {
    const extent = ((2 * fold * (scale + 1)) / (scale - 1)) * 1.1;
    const t = tallySteps(
      rng(Math.round(scale * 1000)), 5000, extent, 0.003, FRACTALS[BOX].stepScale,
      (x, y, z) => boxInside(x, y, z, scale, minR, fold),
      (x, y, z) => deBox(x, y, z, scale, minR, fold, 14),
    );
    expect(t.longOvershoots).toBe(0);
    expect(t.overshoots / t.rays).toBeLessThan(0.02);
  });
});

describe('Kaleidoscopic Menger distance estimator', () => {
  it('reproduces the Menger sponge exactly at its default parameters', () => {
    const rand = rng(7);
    const levels = 5;
    let mismatches = 0;
    for (let i = 0; i < 20000; i++) {
      const px = (rand() * 2 - 1) * 1.2, py = (rand() * 2 - 1) * 1.2, pz = (rand() * 2 - 1) * 1.2;
      const d = deKifs(px, py, pz, 3, IDENTITY, 1, levels);
      if (Math.abs(d) < 1e-9) continue; // on the boundary: either answer is fine
      if (d < 0 !== mengerInside(px, py, pz, levels)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('a full-length step never enters the sponge', () => {
    const rand = rng(11);
    const dir = [0, 0, 0];
    const levels = 5;
    let violations = 0;
    for (let i = 0; i < 4000; i++) {
      const px = (rand() * 2 - 1) * 1.6, py = (rand() * 2 - 1) * 1.6, pz = (rand() * 2 - 1) * 1.6;
      const d = deKifs(px, py, pz, 3, IDENTITY, 1, levels);
      if (d <= 0) continue;
      for (let k = 0; k < 16; k++) {
        randomDir(rand, dir);
        const s = d * 0.999;
        if (mengerInside(px + dir[0] * s, py + dir[1] * s, pz + dir[2] * s, levels)) violations++;
      }
    }
    expect(violations).toBe(0);
  });

  it('is 1-Lipschitz for arbitrary fold rotations, scales and offsets', () => {
    // |DE(p) - DE(q)| <= |p - q| together with DE <= 0 inside the set implies DE never overshoots.
    const rand = rng(23);
    const rot = new Float64Array(9);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      kifsRotation((rand() * 2 - 1) * 0.6, (rand() * 2 - 1) * 0.6, rot);
      const scale = 2 + rand() * 1.6;
      const offZ = 0.4 + rand() * 0.9;
      const px = (rand() * 2 - 1) * 2, py = (rand() * 2 - 1) * 2, pz = (rand() * 2 - 1) * 2;
      const h = Math.pow(10, -4 * rand());
      const qx = px + (rand() * 2 - 1) * h, qy = py + (rand() * 2 - 1) * h, qz = pz + (rand() * 2 - 1) * h;
      const gap = Math.hypot(px - qx, py - qy, pz - qz);
      if (gap < 1e-12) continue;
      const diff = Math.abs(deKifs(px, py, pz, scale, rot, offZ, 8) - deKifs(qx, qy, qz, scale, rot, offZ, 8));
      worst = Math.max(worst, diff / gap);
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('fractal definitions', () => {
  it('bounding spheres contain the sets (DE is positive on the bounding sphere)', () => {
    const rand = rng(31);
    const dir = [0, 0, 0];
    const rot = new Float64Array(9);
    FRACTALS.forEach((def, id) => {
      const p = def.params.map((d) => d.def);
      while (p.length < 4) p.push(0);
      if (id === KIFS) kifsRotation(p[1], p[2], rot);
      const R = def.bound(p);
      for (let i = 0; i < 2000; i++) {
        randomDir(rand, dir);
        expect(def.dist(p, rot, def.iter.def, dir[0] * R, dir[1] * R, dir[2] * R)).toBeGreaterThan(0);
      }
    });
  });
});
