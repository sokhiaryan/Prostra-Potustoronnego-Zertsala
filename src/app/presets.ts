// Curated views. The first preset is what the app opens on.
import { BOX, BULB, KIFS } from './fractals';

export interface Preset {
  name: string;
  fractal: number;
  params: number[];
  iter: number;
  palette: number;
  palShift: number;
  cam: [number, number, number];
  target: [number, number, number];
  /** Sun azimuth and elevation in radians. */
  sunAz: number;
  sunEl: number;
}

export const PRESETS: Preset[] = [
  {
    name: 'Zertsalo',
    fractal: BULB, params: [8, 0, 0, 0], iter: 10,
    palette: 0, palShift: 0,
    cam: [1.3, 0.95, 1.62], target: [0.2, 0.05, 0.15],
    sunAz: 1.9, sunEl: 0.6,
  },
  {
    name: 'Lotus',
    fractal: BULB, params: [5, 0.45, 0, 0], iter: 10,
    palette: 1, palShift: 0.1,
    cam: [0.35, 1.75, 1.55], target: [0, 0.1, 0],
    sunAz: -0.6, sunEl: 0.9,
  },
  {
    name: 'Cathedral',
    fractal: BOX, params: [2, 0.5, 1, 0], iter: 14,
    palette: 2, palShift: 0,
    cam: [10.3, 6.7, 14.8], target: [0, 0, 0],
    sunAz: 1.3, sunEl: 0.7,
  },
  {
    name: 'Reliquary',
    fractal: BOX, params: [2.6, 0.4, 1, 0], iter: 14,
    palette: 3, palShift: 0.15,
    cam: [7.5, 5.0, 9.5], target: [0, 0, 0],
    sunAz: 1.4, sunEl: 0.6,
  },
  {
    name: 'Lattice',
    fractal: KIFS, params: [3, 0, 0, 1], iter: 7,
    palette: 4, palShift: 0,
    cam: [2.1, 1.5, 2.6], target: [0, 0, 0],
    sunAz: 1.6, sunEl: 0.8,
  },
  {
    name: 'Thornfield',
    fractal: KIFS, params: [2.5, 0.22, -0.16, 0.85], iter: 8,
    palette: 5, palShift: 0.2,
    cam: [1.9, 1.3, 2.3], target: [0, 0, 0],
    sunAz: 1.5, sunEl: 0.7,
  },
];

/** Index of the first preset showing a given fractal (used when switching fractals). */
export function homePreset(fractal: number): number {
  const i = PRESETS.findIndex((p) => p.fractal === fractal);
  return i < 0 ? 0 : i;
}
