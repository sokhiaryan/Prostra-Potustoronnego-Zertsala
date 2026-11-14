// Player settings: how the game looks and handles, as opposed to what is on screen
// (that is AppState). Stored with the rest of the saved record; see explore/store.ts.
import { DEFAULT_QUALITY, QUALITIES } from './state';

export const HEADLAMP_MODES = ['auto', 'on', 'off'] as const;
export type HeadlampMode = (typeof HEADLAMP_MODES)[number];

export interface Settings {
  /** Index into QUALITIES. */
  quality: number;
  /** Vertical field of view while flying, in degrees. */
  fov: number;
  /** Blend frames over time while moving, which hides the lower resolution used in motion. */
  smoothing: boolean;
  headlamp: HeadlampMode;
  hud: boolean;
  /** Show the frame-rate and renderer line. */
  stats: boolean;
  /** Mouse-look speed multiplier. */
  sensitivity: number;
  invertY: boolean;
  /** Flight speed multiplier, on top of the speed gear. */
  speed: number;
  /** No automatic camera motion and no field-of-view effects. */
  reduceMotion: boolean;
}

export const FOV_RANGE = { min: 50, max: 110, def: 80 };
export const SENSITIVITY_RANGE = { min: 0.2, max: 3, def: 1 };
export const SPEED_RANGE = { min: 0.25, max: 3, def: 1 };

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function defaultSettings(): Settings {
  return {
    quality: DEFAULT_QUALITY,
    fov: FOV_RANGE.def,
    smoothing: true,
    headlamp: 'auto',
    hud: true,
    stats: false,
    sensitivity: SENSITIVITY_RANGE.def,
    invertY: false,
    speed: SPEED_RANGE.def,
    reduceMotion: prefersReducedMotion(),
  };
}

const inRange = (v: unknown, r: { min: number; max: number }, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : fallback;

/** Validate an untrusted value into Settings; anything missing or malformed takes its default. */
export function sanitizeSettings(raw: unknown): Settings {
  const out = defaultSettings();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.quality === 'number' && Number.isInteger(r.quality) && r.quality >= 0 && r.quality < QUALITIES.length) {
    out.quality = r.quality;
  }
  out.fov = inRange(r.fov, FOV_RANGE, out.fov);
  out.sensitivity = inRange(r.sensitivity, SENSITIVITY_RANGE, out.sensitivity);
  out.speed = inRange(r.speed, SPEED_RANGE, out.speed);
  if (typeof r.headlamp === 'string' && (HEADLAMP_MODES as readonly string[]).includes(r.headlamp)) {
    out.headlamp = r.headlamp as HeadlampMode;
  }
  for (const key of ['smoothing', 'hud', 'stats', 'invertY', 'reduceMotion'] as const) {
    if (typeof r[key] === 'boolean') out[key] = r[key];
  }
  return out;
}
