// The single mutable application state, plus quality presets.
import { FRACTALS } from './fractals';
import type { Preset } from './presets';

export interface Quality {
  name: string;
  /** Upper bound on devicePixelRatio used for the canvas. */
  dprCap: number;
  maxSteps: number;
  shadowSteps: number;
  /** Jittered frames accumulated once the camera is still. */
  samples: number;
}

export const QUALITIES: Quality[] = [
  { name: 'Draft', dprCap: 1, maxSteps: 96, shadowSteps: 16, samples: 16 },
  { name: 'Balanced', dprCap: 1.25, maxSteps: 150, shadowSteps: 28, samples: 32 },
  { name: 'High', dprCap: 1.5, maxSteps: 220, shadowSteps: 40, samples: 48 },
  { name: 'Ultra', dprCap: 2, maxSteps: 340, shadowSteps: 72, samples: 96 },
];

export const DEFAULT_QUALITY = 2;

export interface AppState {
  preset: number;
  fractal: number;
  /** Parameter values per fractal (index matches FRACTALS). */
  params: Float64Array[];
  iters: number[];
  palette: number;
  palShift: number;
  glow: number;
  fog: number;
  bloom: number;
  exposure: number;
  sunAz: number;
  sunEl: number;
  quality: number;
  breathing: boolean;
}

export const LOOK_DEFAULTS = { glow: 1, fog: 1, bloom: 0.6, exposure: 1.3 };

export function createState(): AppState {
  return {
    preset: 0,
    fractal: 0,
    params: FRACTALS.map((f) => {
      const a = new Float64Array(4);
      f.params.forEach((p, i) => (a[i] = p.def));
      return a;
    }),
    iters: FRACTALS.map((f) => f.iter.def),
    palette: 0,
    palShift: 0,
    ...LOOK_DEFAULTS,
    sunAz: 1.5,
    sunEl: 0.75,
    quality: DEFAULT_QUALITY,
    breathing: false,
  };
}

/** Copy a preset's fractal, parameters, palette and light into the state (camera is handled by the caller). */
export function applyPreset(state: AppState, index: number, preset: Preset): void {
  state.preset = index;
  state.fractal = preset.fractal;
  const p = state.params[preset.fractal];
  for (let i = 0; i < 4; i++) p[i] = preset.params[i] ?? 0;
  state.iters[preset.fractal] = preset.iter;
  state.palette = preset.palette;
  state.palShift = preset.palShift;
  state.sunAz = preset.sunAz;
  state.sunEl = preset.sunEl;
  Object.assign(state, LOOK_DEFAULTS);
}
