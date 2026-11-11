// The three fractals: their live parameters, safe marching factors and CPU distance functions.
import { deBox, deBulb, deKifs } from '../math/de';

export interface ParamDef {
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

export interface FractalDef {
  name: string;
  /** Up to four parameters; index i is uploaded as uP[i]. */
  params: ParamDef[];
  iter: { min: number; max: number; def: number };
  /** Fraction of the estimated distance the marcher advances per step. */
  stepScale: number;
  /** Orbit-trap weights (x, y, z, radius) that map the trap to a palette coordinate. */
  trapWeights: readonly [number, number, number, number];
  /** Radius of a sphere containing the whole set for these parameters. */
  bound(p: ArrayLike<number>): number;
  /** Typical coordinate magnitude near the surface; scales the float-precision floor. */
  coordScale(p: ArrayLike<number>): number;
  /** Zoom factor after which one more iteration is needed to keep adding detail. */
  detailBase(p: ArrayLike<number>): number;
  /** Gentle animated variation of the parameters at time t (seconds). */
  breathe(base: ArrayLike<number>, t: number, out: Float32Array): void;
  dist(p: ArrayLike<number>, rot: ArrayLike<number>, iter: number, x: number, y: number, z: number): number;
}

export const BULB = 0;
export const BOX = 1;
export const KIFS = 2;

const boxExtent = (p: ArrayLike<number>): number =>
  (2 * Math.max(p[2], 0.5) * (Math.abs(p[0]) + 1)) / (Math.abs(p[0]) - 1);

export const FRACTALS: FractalDef[] = [
  {
    name: 'Mandelbulb',
    params: [
      { label: 'Power', min: 2, max: 12, step: 0.01, def: 8 },
      { label: 'Polar twist', min: -1.5, max: 1.5, step: 0.005, def: 0 },
      { label: 'Azimuth twist', min: -3.14, max: 3.14, step: 0.01, def: 0 },
    ],
    iter: { min: 3, max: 18, def: 10 },
    stepScale: 0.75,
    trapWeights: [0, 1.2, 0, 2.4],
    bound: (p) => 1.25 + 2.2 / Math.pow(p[0], 1.2),
    coordScale: () => 1,
    detailBase: () => 2.5,
    breathe(base, t, out) {
      out[0] = base[0] + 0.4 * Math.sin(t * 0.37);
      out[1] = base[1] + 0.22 * Math.sin(t * 0.23 + 1.0);
      out[2] = base[2] + 0.3 * Math.sin(t * 0.17);
      out[3] = 0;
    },
    dist: (p, _rot, iter, x, y, z) => deBulb(x, y, z, p[0], p[1], p[2], iter),
  },
  {
    name: 'Mandelbox',
    params: [
      { label: 'Scale', min: 1.6, max: 3.2, step: 0.005, def: 2 },
      { label: 'Inner radius', min: 0.1, max: 1, step: 0.005, def: 0.5 },
      { label: 'Fold limit', min: 0.6, max: 1.4, step: 0.005, def: 1 },
    ],
    iter: { min: 4, max: 20, def: 14 },
    stepScale: 0.8,
    trapWeights: [1.2, 0, 0, 1.6],
    bound: (p) => boxExtent(p) * 1.75,
    coordScale: (p) => boxExtent(p),
    detailBase: (p) => Math.max(1.5, Math.abs(p[0])),
    breathe(base, t, out) {
      out[0] = base[0] + 0.05 * Math.sin(t * 0.31);
      out[1] = Math.max(0.05, base[1] + 0.07 * Math.sin(t * 0.43 + 0.7));
      out[2] = base[2] + 0.03 * Math.sin(t * 0.19);
      out[3] = 0;
    },
    dist: (p, _rot, iter, x, y, z) => deBox(x, y, z, p[0], p[1], p[2], iter),
  },
  {
    name: 'Kaleido Menger',
    params: [
      { label: 'Scale', min: 2, max: 3.6, step: 0.005, def: 3 },
      { label: 'Fold rotation A', min: -0.6, max: 0.6, step: 0.002, def: 0 },
      { label: 'Fold rotation B', min: -0.6, max: 0.6, step: 0.002, def: 0 },
      { label: 'Depth offset', min: 0.4, max: 1.3, step: 0.005, def: 1 },
    ],
    iter: { min: 2, max: 12, def: 7 },
    stepScale: 0.95,
    trapWeights: [1.5, 0, 3, 2],
    bound: () => 2.6,
    coordScale: () => 1,
    detailBase: (p) => Math.max(1.5, p[0]),
    breathe(base, t, out) {
      out[0] = base[0] + 0.03 * Math.sin(t * 0.21);
      out[1] = base[1] + 0.05 * Math.sin(t * 0.41);
      out[2] = base[2] + 0.05 * Math.sin(t * 0.29 + 2.0);
      out[3] = base[3] + 0.03 * Math.sin(t * 0.33);
    },
    dist: (p, rot, iter, x, y, z) => deKifs(x, y, z, p[0], rot, p[3], iter),
  },
];
