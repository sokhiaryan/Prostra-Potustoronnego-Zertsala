// Control panel: presets, fractal picker, parameter sliders, palettes, look, quality.
// Plain DOM; the panel reads and writes the shared AppState and reports changes through hooks.
import { FRACTALS } from '../app/fractals';
import { PALETTES, paletteCss } from '../app/palettes';
import { PRESETS } from '../app/presets';
import { QUALITIES } from '../app/state';
import type { AppState } from '../app/state';

export interface PanelHooks {
  /** Any value that affects the image changed. */
  onChange(): void;
  onPreset(index: number): void;
  onFractal(index: number): void;
  onQuality(index: number): void;
  onScreenshot(): void;
}

export interface Panel {
  /** Re-read every control from the state (after presets, shortcuts, etc.). */
  refresh(): void;
  toggleHidden(): void;
  setHidden(hidden: boolean): void;
  setStats(text: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
}

function decimals(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(3, s.length - i - 1);
}

/** A labelled range input; returns the row and a function that re-syncs it from the state. */
function slider(spec: SliderSpec, onChange: () => void): { row: HTMLElement; sync: () => void } {
  const row = el('label', 'row');
  const head = el('span', 'row-head');
  const name = el('span', 'row-name', spec.label);
  const value = el('span', 'row-value');
  head.append(name, value);
  const input = el('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  const dp = decimals(spec.step);
  const sync = (): void => {
    const v = spec.get();
    input.value = String(v);
    value.textContent = v.toFixed(dp);
    input.style.setProperty('--fill', `${((v - spec.min) / (spec.max - spec.min)) * 100}%`);
  };
  input.addEventListener('input', () => {
    spec.set(Number(input.value));
    sync();
    onChange();
  });
  row.append(head, input);
  sync();
  return { row, sync };
}

function section(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'section');
  root.append(el('h2', 'section-title', title));
  const body = el('div', 'section-body');
  root.append(body);
  return { root, body };
}

export function buildPanel(root: HTMLElement, state: AppState, hooks: PanelHooks): Panel {
  const syncs: Array<() => void> = [];
  const panel = el('aside', 'panel');
  panel.setAttribute('aria-label', 'Controls');

  const header = el('header', 'panel-header');
  header.append(
    el('h1', 'title', 'Prostra Potustoronnego Zertsala'),
    el('p', 'subtitle', 'Space of the Otherworldly Mirror'),
  );
  panel.append(header);

  /** A row of mutually exclusive buttons. */
  const choice = (
    cls: string,
    labels: string[],
    current: () => number,
    pick: (i: number) => void,
    decorate?: (b: HTMLButtonElement, i: number) => void,
  ): HTMLElement => {
    const wrap = el('div', cls);
    const buttons = labels.map((label, i) => {
      const b = el('button', 'chip', label);
      b.type = 'button';
      decorate?.(b, i);
      b.addEventListener('click', () => pick(i));
      wrap.append(b);
      return b;
    });
    syncs.push(() => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === current()))));
    return wrap;
  };

  // Presets
  const presets = section('Presets');
  presets.body.append(
    choice('grid grid-3', PRESETS.map((p) => p.name), () => state.preset, (i) => hooks.onPreset(i), (b, i) => {
      b.title = `${FRACTALS[PRESETS[i].fractal].name} (key ${i + 1})`;
    }),
  );
  panel.append(presets.root);

  // Fractal + parameters
  const fractal = section('Fractal');
  fractal.body.append(
    choice('grid grid-3', FRACTALS.map((f) => f.name), () => state.fractal, (i) => hooks.onFractal(i)),
  );
  const paramBox = el('div', 'params');
  fractal.body.append(paramBox);
  let builtFor = -1;
  let paramSyncs: Array<() => void> = [];
  const buildParams = (): void => {
    if (builtFor === state.fractal) {
      paramSyncs.forEach((s) => s());
      return;
    }
    builtFor = state.fractal;
    const def = FRACTALS[state.fractal];
    const values = state.params[state.fractal];
    paramBox.replaceChildren();
    paramSyncs = [];
    def.params.forEach((p, i) => {
      const s = slider(
        { label: p.label, min: p.min, max: p.max, step: p.step, get: () => values[i], set: (v) => (values[i] = v) },
        hooks.onChange,
      );
      paramBox.append(s.row);
      paramSyncs.push(s.sync);
    });
    const it = slider(
      {
        label: 'Iterations',
        min: def.iter.min,
        max: def.iter.max,
        step: 1,
        get: () => state.iters[state.fractal],
        set: (v) => (state.iters[state.fractal] = v),
      },
      hooks.onChange,
    );
    paramBox.append(it.row);
    paramSyncs.push(it.sync);
  };
  syncs.push(buildParams);

  const breathe = el('button', 'chip wide', 'Breathing');
  breathe.type = 'button';
  breathe.title = 'Gently animate the parameters (key B)';
  breathe.addEventListener('click', () => {
    state.breathing = !state.breathing;
    refresh();
    hooks.onChange();
  });
  syncs.push(() => breathe.setAttribute('aria-pressed', String(state.breathing)));
  fractal.body.append(breathe);
  panel.append(fractal.root);

  // Palette
  const palette = section('Palette');
  palette.body.append(
    choice(
      'grid grid-swatch',
      PALETTES.map((p) => p.name),
      () => state.palette,
      (i) => {
        state.palette = i;
        refresh();
        hooks.onChange();
      },
      (b, i) => {
        b.classList.add('swatch');
        b.style.setProperty('--swatch', paletteCss(PALETTES[i]));
      },
    ),
  );
  panel.append(palette.root);

  // Look
  const look = section('Light and atmosphere');
  const lookSliders: SliderSpec[] = [
    { label: 'Colour shift', min: -0.5, max: 0.5, step: 0.005, get: () => state.palShift, set: (v) => (state.palShift = v) },
    { label: 'Sun direction', min: -3.14, max: 3.14, step: 0.01, get: () => state.sunAz, set: (v) => (state.sunAz = v) },
    { label: 'Sun height', min: 0.05, max: 1.5, step: 0.01, get: () => state.sunEl, set: (v) => (state.sunEl = v) },
    { label: 'Glow', min: 0, max: 2, step: 0.01, get: () => state.glow, set: (v) => (state.glow = v) },
    { label: 'Fog', min: 0, max: 3, step: 0.01, get: () => state.fog, set: (v) => (state.fog = v) },
    { label: 'Bloom', min: 0, max: 2, step: 0.01, get: () => state.bloom, set: (v) => (state.bloom = v) },
    { label: 'Exposure', min: 0.3, max: 3, step: 0.01, get: () => state.exposure, set: (v) => (state.exposure = v) },
  ];
  for (const spec of lookSliders) {
    const s = slider(spec, hooks.onChange);
    look.body.append(s.row);
    syncs.push(s.sync);
  }
  panel.append(look.root);

  // Quality
  const quality = section('Quality');
  quality.body.append(
    choice('grid grid-4', QUALITIES.map((q) => q.name), () => state.quality, (i) => hooks.onQuality(i)),
  );
  panel.append(quality.root);

  // Actions
  const actions = el('div', 'grid grid-2 actions');
  const shot = el('button', 'chip primary', 'Save PNG');
  shot.type = 'button';
  shot.title = 'Save a screenshot (key P)';
  shot.addEventListener('click', () => hooks.onScreenshot());
  const hide = el('button', 'chip', 'Hide panel');
  hide.type = 'button';
  hide.title = 'Hide the interface (key H)';
  actions.append(shot, hide);
  panel.append(actions);

  const help = el('p', 'help');
  help.textContent =
    'Drag to orbit · scroll to zoom into the point under the cursor · shift-drag to pan · ' +
    'W A S D Q E to fly · 1–6 presets · R reset · B breathing · P save · H hide';
  panel.append(help);

  const stats = el('div', 'stats');
  const reveal = el('button', 'reveal', 'Show panel');
  reveal.type = 'button';
  reveal.title = 'Show the interface (key H)';

  const setHidden = (hidden: boolean): void => {
    document.body.classList.toggle('ui-hidden', hidden);
  };
  const toggleHidden = (): void => setHidden(!document.body.classList.contains('ui-hidden'));
  hide.addEventListener('click', () => setHidden(true));
  reveal.addEventListener('click', () => setHidden(false));

  function refresh(): void {
    for (const s of syncs) s();
  }

  root.append(panel, stats, reveal);
  refresh();
  return {
    refresh,
    toggleHidden,
    setHidden,
    setStats: (text) => {
      stats.textContent = text;
    },
  };
}
