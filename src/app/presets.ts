// Curated views. The 3D ones are the worlds of the Free Fly game; the flat ones are
// starting points for Deep Zoom. The first preset is what the menu shows behind it.
import { BOX, BULB, KIFS, MANDEL } from './fractals';

export interface Preset {
  /** Stable key for saved progress; never reuse or rename one. */
  id: string;
  name: string;
  /** One line for the world card in the menu. */
  blurb: string;
  /** 3D worlds: motes needed in total before the world opens (0 = open from the start). */
  unlockAt?: number;
  fractal: number;
  params: number[];
  iter: number;
  palette: number;
  palShift: number;
  cam: readonly [number, number, number];
  target: readonly [number, number, number];
  /** Sun azimuth and elevation in radians. */
  sunAz: number;
  sunEl: number;
  /** 2D presets: centre as decimal strings (any number of digits) and log2 of the zoom. */
  view?: { re: string; im: string; zoom: number };
}

const FLAT = { iter: 1, cam: [0, 0, 3], target: [0, 0, 0], sunAz: 1.5, sunEl: 0.75 } as const;

export const PRESETS: Preset[] = [
  {
    id: 'zertsalo',
    name: 'Zertsalo',
    blurb: 'The classic power-8 Mandelbulb: seven-fold buds, each carrying smaller ones.',
    unlockAt: 0,
    fractal: BULB, params: [8, 0, 0, 0], iter: 10,
    palette: 0, palShift: 0,
    cam: [1.3, 0.95, 1.62], target: [0.2, 0.05, 0.15],
    sunAz: 1.9, sunEl: 0.6,
  },
  {
    id: 'lotus',
    name: 'Lotus',
    blurb: 'A power-5 bulb with a polar twist that opens it like a flower.',
    unlockAt: 6,
    fractal: BULB, params: [5, 0.45, 0, 0], iter: 10,
    palette: 1, palShift: 0.1,
    cam: [0.35, 1.75, 1.55], target: [0, 0.1, 0],
    sunAz: -0.6, sunEl: 0.9,
  },
  {
    id: 'cathedral',
    name: 'Cathedral',
    blurb: 'The scale-2 Mandelbox: halls inside halls, big enough to get lost in.',
    unlockAt: 3,
    fractal: BOX, params: [2, 0.5, 1, 0], iter: 14,
    palette: 2, palShift: 0,
    cam: [10.3, 6.7, 14.8], target: [0, 0, 0],
    sunAz: 1.3, sunEl: 0.7,
  },
  {
    id: 'reliquary',
    name: 'Reliquary',
    blurb: 'A tighter Mandelbox, dense with filigree and narrow passages.',
    unlockAt: 15,
    fractal: BOX, params: [2.6, 0.4, 1, 0], iter: 14,
    palette: 3, palShift: 0.15,
    cam: [7.5, 5.0, 9.5], target: [0, 0, 0],
    sunAz: 1.4, sunEl: 0.6,
  },
  {
    id: 'lattice',
    name: 'Lattice',
    blurb: 'The Menger sponge: square tunnels straight through, at every size.',
    unlockAt: 0,
    fractal: KIFS, params: [3, 0, 0, 1], iter: 7,
    palette: 4, palShift: 0,
    cam: [2.1, 1.5, 2.6], target: [0, 0, 0],
    sunAz: 1.6, sunEl: 0.8,
  },
  {
    id: 'thornfield',
    name: 'Thornfield',
    blurb: 'The sponge with its folds turned a few degrees: tunnels become thorns.',
    unlockAt: 10,
    fractal: KIFS, params: [2.5, 0.22, -0.16, 0.85], iter: 8,
    palette: 5, palShift: 0.2,
    cam: [1.9, 1.3, 2.3], target: [0, 0, 0],
    sunAz: 1.5, sunEl: 0.7,
  },
  {
    ...FLAT,
    id: 'mandelbrot',
    name: 'Mandelbrot',
    blurb: 'The whole set. Every interesting place is on its edge.',
    fractal: MANDEL, params: [1, 1, 0, 0],
    palette: 3, palShift: 0,
    view: { re: '-0.65', im: '0', zoom: 0 },
  },
  {
    ...FLAT,
    id: 'seahorse',
    name: 'Seahorse',
    blurb: 'A spiral in Seahorse Valley, sixty-five thousand times in.',
    fractal: MANDEL, params: [1, 1, 0, 0],
    palette: 1, palShift: 0,
    view: { re: '-0.743643887037151', im: '0.131825904205330', zoom: 16 },
  },
  {
    // The dendrite tip at c = i looks the same at every depth: 10^320 times in, far past
    // the range of doubles, and still only about a thousand iterations per pixel.
    ...FLAT,
    id: 'dendrite',
    name: 'Dendrite',
    blurb: 'The branch tip at i, 10³²⁰ times in: past the end of ordinary numbers.',
    fractal: MANDEL, params: [1, 1, 0, 0],
    palette: 0, palShift: 0,
    view: { re: '0', im: '1', zoom: 1063 },
  },
];

/** Index of the first preset showing a given fractal (used when switching fractals). */
export function homePreset(fractal: number): number {
  const i = PRESETS.findIndex((p) => p.fractal === fractal);
  return i < 0 ? 0 : i;
}
