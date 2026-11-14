// Persistence: finished quests, bookmarks and panel preferences in localStorage, and a
// compact text encoding of a complete view (used for bookmarks and for share links in
// the URL hash). Everything here tolerates missing or malformed data.

/** A complete, restorable description of what is on screen. */
export interface ViewState {
  fractal: number;
  params: number[];
  iter: number;
  palette: number;
  palShift: number;
  glow: number;
  fog: number;
  bloom: number;
  exposure: number;
  sunAz: number;
  sunEl: number;
  /** 3D: camera position then orbit target. */
  cam?: [number, number, number, number, number, number];
  /** 2D: centre as decimal strings and log2 zoom. */
  flat?: { re: string; im: string; zoom: number };
}

export interface Bookmark {
  name: string;
  /** encodeView() of the saved view. */
  code: string;
}

export interface Saved {
  quests: string[];
  bookmarks: Bookmark[];
  prefs: { hidden: boolean; tab: number };
}

const KEY = 'pz.explorer.v2';
export const MAX_BOOKMARKS = 24;

const nums = (a: number[]): string => a.map((v) => String(v)).join(',');

/** Doubles are written with String(), which round-trips exactly. */
export function encodeView(v: ViewState): string {
  const parts = [
    `f=${v.fractal}`,
    `p=${nums(v.params)}`,
    `i=${v.iter}`,
    `c=${v.palette},${v.palShift}`,
    `l=${nums([v.glow, v.fog, v.bloom, v.exposure, v.sunAz, v.sunEl])}`,
  ];
  if (v.cam) parts.push(`v=${nums(v.cam)}`);
  if (v.flat) parts.push(`m=${v.flat.re},${v.flat.im},${v.flat.zoom}`);
  return parts.join('&');
}

function parseNums(text: string | undefined, count: number): number[] | null {
  if (text === undefined) return null;
  const a = text.split(',').map(Number);
  return a.length === count && a.every((x) => Number.isFinite(x)) ? a : null;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Parse encodeView() output; returns null for anything that is not a complete, sane view. */
export function decodeView(code: string, fractalCount: number, paletteCount: number): ViewState | null {
  const map = new Map<string, string>();
  for (const part of code.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const f = parseNums(map.get('f'), 1);
  const p = parseNums(map.get('p'), 4);
  const i = parseNums(map.get('i'), 1);
  const c = parseNums(map.get('c'), 2);
  const l = parseNums(map.get('l'), 6);
  if (!f || !p || !i || !c || !l) return null;
  if (!Number.isInteger(f[0]) || f[0] < 0 || f[0] >= fractalCount) return null;
  if (!Number.isInteger(c[0]) || c[0] < 0 || c[0] >= paletteCount) return null;
  const view: ViewState = {
    fractal: f[0],
    params: p,
    iter: Math.round(i[0]),
    palette: c[0],
    palShift: c[1],
    glow: l[0],
    fog: l[1],
    bloom: l[2],
    exposure: l[3],
    sunAz: l[4],
    sunEl: l[5],
  };
  const cam = parseNums(map.get('v'), 6);
  if (cam) view.cam = cam as ViewState['cam'];
  const m = map.get('m');
  if (m !== undefined) {
    const [re, im, zoom] = m.split(',');
    const z = Number(zoom);
    if (!re || !im || !DECIMAL.test(re) || !DECIMAL.test(im) || !Number.isFinite(z)) return null;
    view.flat = { re, im, zoom: z };
  }
  if (!view.cam && !view.flat) return null;
  return view;
}

function emptySaved(): Saved {
  return { quests: [], bookmarks: [], prefs: { hidden: false, tab: 0 } };
}

/** Validate an untrusted value into a Saved record. */
export function sanitizeSaved(raw: unknown): Saved {
  const out = emptySaved();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.quests)) out.quests = r.quests.filter((q): q is string => typeof q === 'string');
  if (Array.isArray(r.bookmarks)) {
    for (const b of r.bookmarks) {
      if (b && typeof b === 'object') {
        const { name, code } = b as Record<string, unknown>;
        if (typeof name === 'string' && typeof code === 'string') out.bookmarks.push({ name: name.slice(0, 60), code });
      }
    }
    out.bookmarks = out.bookmarks.slice(0, MAX_BOOKMARKS);
  }
  if (r.prefs && typeof r.prefs === 'object') {
    const p = r.prefs as Record<string, unknown>;
    out.prefs.hidden = p.hidden === true;
    if (typeof p.tab === 'number' && Number.isInteger(p.tab) && p.tab >= 0 && p.tab <= 2) out.prefs.tab = p.tab;
  }
  return out;
}

export function loadSaved(): Saved {
  try {
    const text = localStorage.getItem(KEY);
    return text ? sanitizeSaved(JSON.parse(text)) : emptySaved();
  } catch {
    return emptySaved(); // storage disabled or corrupt: start fresh
  }
}

export function storeSaved(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage full or disabled: progress simply lasts for this session only.
  }
}
