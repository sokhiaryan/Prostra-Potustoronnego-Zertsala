// "Surprise me" and "Mutate": two ways of searching parameter space for shapes worth
// keeping. Surprise jumps somewhere new; Mutate takes a small step from where you are,
// which is how good settings are usually found: wander, keep what improves, repeat.
import { FRACTALS, MANDEL } from '../app/fractals';

/** Places in the Mandelbrot set that are worth a visit. Centres are exact to the digits given. */
export interface Landmark {
  name: string;
  re: string;
  im: string;
  /** log2 of a magnification that frames it well. */
  zoom: number;
  /** For nuclei of miniature sets: the period, checked in the tests. */
  period?: number;
}

export const LANDMARKS: Landmark[] = [
  { name: 'Seahorse Valley', re: '-0.7453', im: '0.1127', zoom: 7 },
  { name: 'Seahorse spiral', re: '-0.743643887037151', im: '0.131825904205330', zoom: 16 },
  { name: 'Elephant Valley', re: '0.2825', im: '0.0105', zoom: 5.5 },
  { name: 'Triple junction', re: '-0.1010963638456222', im: '0.9562865108091415', zoom: 6 },
  { name: 'Period-3 miniature', re: '-1.7548776662466927', im: '0', zoom: 5.5, period: 3 },
  { name: 'Period-4 miniature', re: '-0.1565201668337551', im: '1.0322471089228318', zoom: 6.5, period: 4 },
  { name: 'Feigenbaum point', re: '-1.4011551890920506', im: '0', zoom: 6 },
  { name: 'Dendrite at i', re: '0', im: '1', zoom: 9 },
  { name: 'Antenna tip', re: '-2', im: '0', zoom: 8 },
  { name: 'Western needle', re: '-1.985424253', im: '0', zoom: 12 },
];

export type Rng = () => number;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number): number => Math.round(v / step) * step;

/** Fresh parameters for a 3D fractal, biased toward the middle of each range where most good shapes live. */
export function surpriseParams(fractal: number, rng: Rng, out: Float64Array): void {
  const def = FRACTALS[fractal];
  out.fill(0);
  def.params.forEach((p, i) => {
    // Average of two uniforms: triangular distribution, fewer extreme values.
    const t = (rng() + rng()) / 2;
    out[i] = clamp(snap(p.min + (p.max - p.min) * t, p.step), p.min, p.max);
  });
}

/** Nudge every parameter by up to `amount` of its range (default 6%). */
export function mutateParams(fractal: number, rng: Rng, params: Float64Array, amount = 0.06): void {
  const def = FRACTALS[fractal];
  def.params.forEach((p, i) => {
    const d = (rng() * 2 - 1) * amount * (p.max - p.min);
    params[i] = clamp(snap(params[i] + d, p.step), p.min, p.max);
  });
}

/** Pick a fractal other than the flat set and, if possible, other than the current one. */
export function surpriseFractal(current: number, rng: Rng): number {
  const options = FRACTALS.map((_, i) => i).filter((i) => i !== MANDEL && i !== current);
  return options[Math.floor(rng() * options.length) % options.length];
}

export function pickLandmark(rng: Rng, avoid = -1): number {
  let i = Math.floor(rng() * LANDMARKS.length) % LANDMARKS.length;
  if (i === avoid) i = (i + 1) % LANDMARKS.length;
  return i;
}
