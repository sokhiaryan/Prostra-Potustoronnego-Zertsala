// Colour palettes. The orbit trap selects a position along a smooth four-stop gradient
// (linear RGB). Each palette also carries a matching sky, key light and glow tint so the
// whole frame stays in one colour world.
export type V3 = readonly [number, number, number];

export interface Palette {
  name: string;
  stops: readonly [V3, V3, V3, V3];
  skyTop: V3;
  skyHorizon: V3;
  sun: V3;
  glow: V3;
}

export const PALETTES: Palette[] = [
  {
    name: 'Aurora',
    stops: [[0.06, 0.1, 0.42], [0.04, 0.55, 0.62], [0.78, 0.93, 0.88], [0.85, 0.22, 0.55]],
    skyTop: [0.006, 0.01, 0.035], skyHorizon: [0.085, 0.06, 0.2], sun: [1.0, 0.86, 0.7], glow: [0.3, 0.78, 1.0],
  },
  {
    name: 'Nebula',
    stops: [[0.09, 0.03, 0.26], [0.62, 0.1, 0.52], [0.95, 0.56, 0.4], [0.94, 0.84, 0.58]],
    skyTop: [0.012, 0.006, 0.035], skyHorizon: [0.16, 0.055, 0.19], sun: [1.0, 0.82, 0.8], glow: [0.95, 0.4, 1.0],
  },
  {
    name: 'Ember',
    stops: [[0.07, 0.03, 0.03], [0.55, 0.07, 0.035], [0.95, 0.4, 0.07], [1.0, 0.85, 0.52]],
    skyTop: [0.02, 0.008, 0.012], skyHorizon: [0.19, 0.07, 0.045], sun: [1.0, 0.78, 0.55], glow: [1.0, 0.45, 0.15],
  },
  {
    name: 'Abyss',
    stops: [[0.01, 0.04, 0.11], [0.03, 0.22, 0.46], [0.09, 0.68, 0.74], [0.8, 0.95, 0.9]],
    skyTop: [0.003, 0.009, 0.022], skyHorizon: [0.025, 0.1, 0.15], sun: [0.85, 0.95, 1.0], glow: [0.15, 0.9, 0.85],
  },
  {
    name: 'Opal',
    stops: [[0.9, 0.84, 0.78], [0.95, 0.42, 0.58], [0.33, 0.4, 0.95], [0.28, 0.85, 0.7]],
    skyTop: [0.01, 0.012, 0.04], skyHorizon: [0.1, 0.09, 0.2], sun: [1.0, 0.95, 0.9], glow: [0.8, 0.8, 1.0],
  },
  {
    name: 'Verdigris',
    stops: [[0.17, 0.09, 0.035], [0.72, 0.37, 0.15], [0.23, 0.64, 0.51], [0.7, 0.9, 0.78]],
    skyTop: [0.005, 0.016, 0.014], skyHorizon: [0.06, 0.13, 0.105], sun: [1.0, 0.9, 0.72], glow: [0.35, 1.0, 0.7],
  },
  {
    name: 'Moonstone',
    stops: [[0.09, 0.11, 0.17], [0.34, 0.44, 0.62], [0.8, 0.83, 0.88], [0.95, 0.9, 0.82]],
    skyTop: [0.006, 0.009, 0.026], skyHorizon: [0.06, 0.08, 0.16], sun: [0.95, 0.97, 1.0], glow: [0.6, 0.75, 1.0],
  },
];

/** CSS gradient preview of a palette's surface colours (UI swatches). */
export function paletteCss(p: Palette): string {
  const css = (c: V3): string => {
    const ch = (v: number): number => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));
    return `rgb(${ch(c[0])} ${ch(c[1])} ${ch(c[2])})`;
  };
  return `linear-gradient(90deg, ${p.stops.map(css).join(', ')})`;
}
