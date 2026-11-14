import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings } from '../src/app/settings';
import { MAX_BOOKMARKS, decodeView, encodeView, sanitizeSaved } from '../src/explore/store';
import type { ViewState } from '../src/explore/store';

const VIEW_3D: ViewState = {
  fractal: 0,
  params: [8, 0.125, -0.5, 0],
  iter: 10,
  palette: 2,
  palShift: 0.1,
  glow: 1,
  fog: 1.5,
  bloom: 0.6,
  exposure: 1.3,
  sunAz: 1.9,
  sunEl: 0.6,
  cam: [1.3, 0.95, 1.62, 0.2, 0.05, 1e-7],
};

describe('view codes', () => {
  it('round-trip a 3D view exactly', () => {
    expect(decodeView(encodeView(VIEW_3D), 4, 6)).toEqual(VIEW_3D);
  });

  it('remember that a view was saved in flight', () => {
    const code = encodeView({ ...VIEW_3D, fly: true });
    expect(decodeView(code, 4, 6)).toEqual({ ...VIEW_3D, fly: true });
    expect(decodeView(encodeView(VIEW_3D), 4, 6)?.fly).toBeUndefined();
  });

  it('round-trip a 2D view with more digits than a double holds', () => {
    const { cam: _cam, ...rest } = VIEW_3D;
    const flat: ViewState = {
      ...rest,
      fractal: 3,
      flat: { re: '-0.743643887037158704752191506114774', im: '0.131825904205311970493132056385139', zoom: 96.5 },
    };
    const back = decodeView(`#${encodeView(flat)}`, 4, 6);
    expect(back).toEqual(flat);
    expect(back?.fly).toBeUndefined();
  });

  it('reject anything that is not a complete, sane view', () => {
    const code = encodeView(VIEW_3D);
    expect(decodeView('', 4, 6)).toBeNull();
    expect(decodeView('hello', 4, 6)).toBeNull();
    expect(decodeView(code.replace('f=0', 'f=9'), 4, 6)).toBeNull();
    expect(decodeView(code.replace('c=2', 'c=7'), 4, 6)).toBeNull();
    expect(decodeView(code.replace(/&v=[^&]*/, ''), 4, 6)).toBeNull();
    expect(decodeView(code.replace('p=8', 'p=NaN'), 4, 6)).toBeNull();
    expect(decodeView(code.replace(/&v=[^&]*/, '&m=abc,0,3'), 4, 6)).toBeNull();
  });
});

describe('saved record', () => {
  it('starts empty for missing or malformed data', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}]) {
      const s = sanitizeSaved(raw);
      expect(s.quests).toEqual([]);
      expect(s.bookmarks).toEqual([]);
      expect(s.motes).toEqual({});
      expect(s.resume).toBe('');
      expect(s.settings).toEqual(defaultSettings());
    }
  });

  it('keeps quests and bookmarks from a record written before the game existed', () => {
    const old = {
      quests: ['closer', 'worlds', 7],
      bookmarks: [{ name: 'Mandelbulb · 12.5×', code: encodeView(VIEW_3D) }, { name: 3 }, null],
      prefs: { hidden: true, tab: 2 },
    };
    const s = sanitizeSaved(JSON.parse(JSON.stringify(old)));
    expect(s.quests).toEqual(['closer', 'worlds']);
    expect(s.bookmarks).toEqual([{ name: 'Mandelbulb · 12.5×', code: encodeView(VIEW_3D) }]);
    expect(s.motes).toEqual({});
    expect(s.settings).toEqual(defaultSettings());
    expect('prefs' in s).toBe(false);
  });

  it('keeps valid progress and drops the rest', () => {
    const s = sanitizeSaved({
      motes: { zertsalo: 5, lattice: 0, lotus: -3, cathedral: 1.5, thornfield: 'x', reliquary: 0x1ffff },
      resume: 'f=0&p=8,0,0,0',
      bookmarks: Array.from({ length: MAX_BOOKMARKS + 5 }, (_, i) => ({ name: `b${i}`, code: 'c' })),
    });
    expect(s.motes).toEqual({ zertsalo: 5, reliquary: 0xffff });
    expect(s.resume).toBe('f=0&p=8,0,0,0');
    expect(s.bookmarks.length).toBe(MAX_BOOKMARKS);
    expect(sanitizeSaved({ resume: 'x'.repeat(9000) }).resume).toBe('');
    expect(sanitizeSaved({ resume: 12 }).resume).toBe('');
    expect(sanitizeSaved({ motes: [1, 2] }).motes).toEqual({});
  });

  it('survives a JSON round trip unchanged', () => {
    const s = sanitizeSaved({ quests: ['a'], motes: { zertsalo: 3 }, resume: 'r', settings: { fov: 95, invertY: true } });
    expect(sanitizeSaved(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('settings', () => {
  it('fall back to defaults field by field', () => {
    const d = defaultSettings();
    const s = sanitizeSettings({
      quality: 9,
      fov: 'wide',
      smoothing: 'yes',
      headlamp: 'strobe',
      sensitivity: NaN,
      speed: null,
      invertY: true,
      stats: true,
    });
    expect(s).toEqual({ ...d, invertY: true, stats: true });
  });

  it('clamp numbers into range and keep valid choices', () => {
    const s = sanitizeSettings({ quality: 0, fov: 500, sensitivity: 0, speed: 2, headlamp: 'off', smoothing: false, hud: false });
    expect(s.quality).toBe(0);
    expect(s.fov).toBe(110);
    expect(s.sensitivity).toBe(0.2);
    expect(s.speed).toBe(2);
    expect(s.headlamp).toBe('off');
    expect(s.smoothing).toBe(false);
    expect(s.hud).toBe(false);
  });
});
