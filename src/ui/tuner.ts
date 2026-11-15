// The Tuner: a side sheet for changing the shape, the colours and the light while the
// picture stays visible and orbitable. Each slider says what it does and what to try.
// Reads and writes the shared AppState and reports changes through hooks.
import { FRACTALS } from '../app/fractals';
import { PALETTES, paletteCss } from '../app/palettes';
import type { AppState } from '../app/state';
import { NOTES } from '../explore/notes';
import { button, choice, el, section, slider } from './widgets';
import type { SliderSpec } from './widgets';

export interface TunerHooks {
  /** Any value that affects the image changed. */
  onChange(): void;
  onMutate(): void;
  onSurprise(): void;
  /** Put the shape back to the world's own. */
  onReset(): void;
  onClose(): void;
}

export interface Tuner {
  /** Re-read every control from the state (after presets, shortcuts, etc.). */
  refresh(): void;
}

export function buildTuner(root: HTMLElement, state: AppState, hooks: TunerHooks): Tuner {
  const syncs: Array<() => void> = [];
  const sheet = el('aside', 'sheet tuner');
  sheet.setAttribute('aria-label', 'Tuner');

  const header = el('header', 'sheet-head');
  const done = button('pill', 'Done', 'Back to the world (Esc)');
  done.addEventListener('click', () => hooks.onClose());
  header.append(el('h2', 'menu-title', 'Tuner'), done);
  sheet.append(header);

  function refresh(): void {
    for (const s of syncs) s();
  }

  // --- shape ---
  const shape = section('Shape');
  const paramBox = el('div', 'params');
  shape.body.append(paramBox);
  let builtFor = -1;
  let paramSyncs: Array<() => void> = [];
  const buildParams = (): void => {
    if (builtFor === state.fractal) {
      paramSyncs.forEach((s) => s());
      return;
    }
    builtFor = state.fractal;
    const def = FRACTALS[state.fractal];
    const notes = NOTES[state.fractal];
    const values = state.params[state.fractal];
    shape.root.firstElementChild!.textContent = def.name;
    paramBox.replaceChildren();
    paramSyncs = [];
    def.params.forEach((p, i) => {
      const s = slider(
        { label: p.label, min: p.min, max: p.max, step: p.step, note: notes.params[i], get: () => values[i], set: (v) => (values[i] = v) },
        hooks.onChange,
      );
      paramBox.append(s.row);
      paramSyncs.push(s.sync);
    });
    if (!def.flat) {
      const it = slider(
        {
          label: 'Iterations',
          min: def.iter.min,
          max: def.iter.max,
          step: 1,
          note: notes.iterations,
          get: () => state.iters[state.fractal],
          set: (v) => (state.iters[state.fractal] = v),
        },
        hooks.onChange,
      );
      paramBox.append(it.row);
      paramSyncs.push(it.sync);
    }
  };
  syncs.push(buildParams);

  const tools = el('div', 'grid grid-2');
  const breathe = button('chip', 'Breathing');
  const mutate = button('chip', 'Mutate', 'Take a small random step from the current shape (key M)');
  const surprise = button('chip', 'Surprise me', 'Jump to random settings, or to a random place in the flat set (key X)');
  const reset = button('chip', 'Reset shape', 'Back to the world as it was made, where its motes are');
  breathe.addEventListener('click', () => {
    state.breathing = !state.breathing;
    refresh();
    hooks.onChange();
  });
  mutate.addEventListener('click', () => hooks.onMutate());
  surprise.addEventListener('click', () => hooks.onSurprise());
  reset.addEventListener('click', () => hooks.onReset());
  tools.append(breathe, mutate, surprise, reset);
  shape.body.append(tools);
  syncs.push(() => {
    const flat = !!FRACTALS[state.fractal].flat;
    breathe.textContent = flat ? 'Colour cycling' : 'Breathing';
    breathe.title = flat ? 'Slowly cycle the colours (key B)' : 'Gently animate the parameters (key B)';
    breathe.setAttribute('aria-pressed', String(state.breathing));
    mutate.disabled = flat;
  });
  sheet.append(shape.root);

  // --- palette ---
  const palette = section('Palette');
  const swatches = choice(
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
  );
  palette.body.append(swatches.root);
  syncs.push(swatches.sync);
  sheet.append(palette.root);

  // --- light ---
  const look = section('Light and atmosphere');
  const lookSliders: Array<SliderSpec & { solid?: boolean }> = [
    { label: 'Colour shift', min: -0.5, max: 0.5, step: 0.005, get: () => state.palShift, set: (v) => (state.palShift = v) },
    { label: 'Sun direction', solid: true, min: -3.14, max: 3.14, step: 0.01, get: () => state.sunAz, set: (v) => (state.sunAz = v) },
    { label: 'Sun height', solid: true, min: 0.05, max: 1.5, step: 0.01, get: () => state.sunEl, set: (v) => (state.sunEl = v) },
    { label: 'Glow', solid: true, min: 0, max: 2, step: 0.01, get: () => state.glow, set: (v) => (state.glow = v) },
    { label: 'Fog', solid: true, min: 0, max: 3, step: 0.01, get: () => state.fog, set: (v) => (state.fog = v) },
    { label: 'Bloom', min: 0, max: 2, step: 0.01, get: () => state.bloom, set: (v) => (state.bloom = v) },
    { label: 'Exposure', min: 0.3, max: 3, step: 0.01, get: () => state.exposure, set: (v) => (state.exposure = v) },
  ];
  for (const spec of lookSliders) {
    const s = slider(spec, hooks.onChange);
    look.body.append(s.row);
    syncs.push(s.sync);
    // Sun, glow and fog light a solid; the flat set has none of them.
    if (spec.solid) syncs.push(() => (s.row.hidden = !!FRACTALS[state.fractal].flat));
  }
  sheet.append(look.root);

  root.append(sheet);
  refresh();
  return { refresh };
}
