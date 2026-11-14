// Control panel. Three tabs: Controls (presets, fractal and its parameters, palettes,
// light, quality, exploration tools), Guide (what the current fractal is and what each
// control does) and Quests (things to find). Plain DOM; the panel reads and writes the
// shared AppState and reports changes through hooks.
import { FRACTALS } from '../app/fractals';
import { PALETTES, paletteCss } from '../app/palettes';
import { PRESETS } from '../app/presets';
import { QUALITIES } from '../app/state';
import type { AppState } from '../app/state';
import { DEPTH_NOTES, NOTES } from '../explore/notes';
import { QUESTS } from '../explore/quests';
import type { Saved } from '../explore/store';

export interface PanelHooks {
  /** Any value that affects the image changed. */
  onChange(): void;
  onPreset(index: number): void;
  onFractal(index: number): void;
  onQuality(index: number): void;
  onScreenshot(): void;
  onSurprise(): void;
  onMutate(): void;
  onBookmark(): void;
  onOpenBookmark(index: number): void;
  onDeleteBookmark(index: number): void;
  onShare(): void;
  /** The panel was shown or hidden, or another tab was chosen (to persist the preference). */
  onPrefs(hidden: boolean, tab: number): void;
}

export interface Panel {
  /** Re-read every control from the state (after presets, shortcuts, etc.). */
  refresh(): void;
  /** Re-read quests and bookmarks from the saved record. */
  refreshExplore(): void;
  toggleHidden(): void;
  setHidden(hidden: boolean): void;
  /** Status line; `progress` in [0, 1] shows a bar, a negative value hides it. */
  setStats(text: string, progress: number): void;
  /** Where the 2D view is (shown under the Mandelbrot parameters). */
  setLocation(text: string): void;
  toast(title: string, body: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, text: string, title?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
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
  if (spec.hint) row.title = spec.hint;
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

/** A section whose title collapses and expands its body. */
function section(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'section');
  const head = button('section-title', title);
  head.setAttribute('aria-expanded', 'true');
  const body = el('div', 'section-body');
  head.addEventListener('click', () => {
    const collapsed = root.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
  });
  root.append(head, body);
  return { root, body };
}

const TAB_NAMES = ['Controls', 'Guide', 'Quests'];

export function buildPanel(root: HTMLElement, state: AppState, saved: Saved, hooks: PanelHooks): Panel {
  const syncs: Array<() => void> = [];
  const panel = el('aside', 'panel');
  panel.setAttribute('aria-label', 'Controls');

  const header = el('header', 'panel-header');
  const titles = el('div', 'titles');
  titles.append(
    el('h1', 'title', 'Prostra Potustoronnego Zertsala'),
    el('p', 'subtitle', 'Space of the Otherworldly Mirror'),
  );
  const collapse = button('icon-btn', '', 'Hide the panel (key H)');
  collapse.setAttribute('aria-label', 'Hide the panel');
  collapse.append(el('span', 'chevron'));
  header.append(titles, collapse);
  panel.append(header);

  // --- tabs ---
  let tab = saved.prefs.tab;
  const tabBar = el('div', 'tabs');
  tabBar.setAttribute('role', 'tablist');
  const pages = TAB_NAMES.map(() => el('div', 'page'));
  const tabButtons = TAB_NAMES.map((name, i) => {
    const b = button('tab', name);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = i;
      syncTabs();
      hooks.onPrefs(document.body.classList.contains('ui-hidden'), tab);
    });
    tabBar.append(b);
    return b;
  });
  const syncTabs = (): void => {
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', String(i === tab)));
    pages.forEach((p, i) => (p.hidden = i !== tab));
  };
  panel.append(tabBar, ...pages);
  const [controls, guide, quests] = pages;

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
      const b = button('chip', label);
      decorate?.(b, i);
      b.addEventListener('click', () => pick(i));
      wrap.append(b);
      return b;
    });
    syncs.push(() => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === current()))));
    return wrap;
  };

  // --- Controls: fractal + parameters ---
  const fractal = section('Fractal');
  fractal.body.append(
    choice('grid grid-2', FRACTALS.map((f) => f.name), () => state.fractal, (i) => hooks.onFractal(i)),
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
    const notes = NOTES[state.fractal];
    const values = state.params[state.fractal];
    paramBox.replaceChildren();
    paramSyncs = [];
    def.params.forEach((p, i) => {
      const s = slider(
        {
          label: p.label,
          min: p.min,
          max: p.max,
          step: p.step,
          hint: notes.params[i]?.does,
          get: () => values[i],
          set: (v) => (values[i] = v),
        },
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
          hint: notes.iterations?.does,
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

  const location = el('p', 'location');
  fractal.body.append(location);

  const breathe = button('chip wide', 'Breathing');
  breathe.addEventListener('click', () => {
    state.breathing = !state.breathing;
    refresh();
    hooks.onChange();
  });
  syncs.push(() => {
    const flat = !!FRACTALS[state.fractal].flat;
    breathe.textContent = flat ? 'Colour cycling' : 'Breathing';
    breathe.title = flat ? 'Slowly cycle the colours (key B)' : 'Gently animate the parameters (key B)';
    breathe.setAttribute('aria-pressed', String(state.breathing));
    location.hidden = !flat;
  });
  fractal.body.append(breathe);
  controls.append(fractal.root);

  // --- Controls: explore ---
  const explore = section('Explore');
  const tools = el('div', 'grid grid-2');
  const surprise = button('chip', 'Surprise me', 'Jump to random settings, or to a random place in the flat set');
  const mutate = button('chip', 'Mutate', 'Take a small random step from the current settings');
  const mark = button('chip', 'Bookmark', 'Remember this exact view');
  const share = button('chip', 'Copy link', 'Copy a link that reopens this exact view');
  surprise.addEventListener('click', () => hooks.onSurprise());
  mutate.addEventListener('click', () => hooks.onMutate());
  mark.addEventListener('click', () => hooks.onBookmark());
  share.addEventListener('click', () => hooks.onShare());
  tools.append(surprise, mutate, mark, share);
  const bookmarkList = el('div', 'bookmarks');
  explore.body.append(tools, bookmarkList);
  controls.append(explore.root);
  syncs.push(() => {
    mutate.disabled = !!FRACTALS[state.fractal].flat;
  });

  // --- Controls: presets ---
  const presets = section('Presets');
  presets.body.append(
    choice('grid grid-3', PRESETS.map((p) => p.name), () => state.preset, (i) => hooks.onPreset(i), (b, i) => {
      b.title = `${FRACTALS[PRESETS[i].fractal].name}${i < 9 ? ` (key ${i + 1})` : ''}`;
    }),
  );
  controls.append(presets.root);

  // --- Controls: palette ---
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
  controls.append(palette.root);

  // --- Controls: look ---
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
  controls.append(look.root);

  // --- Controls: quality + actions ---
  const quality = section('Quality');
  quality.body.append(
    choice('grid grid-4', QUALITIES.map((q) => q.name), () => state.quality, (i) => hooks.onQuality(i)),
  );
  controls.append(quality.root);

  const actions = el('div', 'grid grid-2 actions');
  const shot = button('chip primary', 'Save PNG', 'Save a screenshot (key P)');
  shot.addEventListener('click', () => hooks.onScreenshot());
  const hide = button('chip', 'Hide panel', 'Hide the interface (key H)');
  actions.append(shot, hide);
  controls.append(actions);

  // --- Guide ---
  let guideFor = -1;
  const buildGuide = (): void => {
    if (guideFor === state.fractal) return;
    guideFor = state.fractal;
    const def = FRACTALS[state.fractal];
    const notes = NOTES[state.fractal];
    const card = (title: string, does: string, tryThis: string): HTMLElement => {
      const c = el('div', 'card');
      c.append(el('h3', 'card-title', title), el('p', 'card-text', does));
      const t = el('p', 'card-try');
      t.append(el('span', 'tag', 'Try'), document.createTextNode(tryThis));
      c.append(t);
      return c;
    };
    const list = (items: string[]): HTMLElement => {
      const ul = el('ul', 'facts');
      for (const item of items) ul.append(el('li', undefined, item));
      return ul;
    };
    const nodes: HTMLElement[] = [el('h2', 'guide-title', def.name), el('p', 'guide-text', notes.about)];
    nodes.push(el('h2', 'guide-head', 'What the controls do'));
    def.params.forEach((p, i) => {
      const n = notes.params[i];
      if (n) nodes.push(card(p.label, n.does, n.tryThis));
    });
    if (notes.iterations) nodes.push(card('Iterations', notes.iterations.does, notes.iterations.tryThis));
    nodes.push(el('h2', 'guide-head', 'Worth knowing'), list(notes.facts));
    nodes.push(el('h2', 'guide-head', 'How deep can it go?'), list(DEPTH_NOTES));
    nodes.push(el('h2', 'guide-head', 'Finding good places'));
    nodes.push(
      list(
        def.flat
          ? [
              'The interesting places are all on the edge of the black region. Aim for the boundary and keep it in view.',
              'Zoom into whatever looks most tangled: spirals lead to smaller spirals, and eventually to a miniature copy of the whole set.',
              'When detail turns into blurry black blobs, raise the Iteration budget.',
            ]
          : [
              'Change one slider slowly while watching one spot. Most of the surprises are in small changes.',
              'Mutate takes a small random step from the current shape. Press it a few times and bookmark what you like.',
              'Look where two large forms meet: creases and saddles hold the richest detail.',
              'Move the sun low for long shadows; they show depth better than any colour.',
            ],
      ),
    );
    nodes.push(el('h2', 'guide-head', 'Controls'));
    nodes.push(
      list(
        def.flat
          ? ['Drag to move.', 'Scroll or pinch to zoom at the cursor.', 'R returns to the preset, H hides the panel, P saves a PNG.']
          : [
              'Drag to orbit around the point under the cursor.',
              'Scroll or pinch to zoom toward the cursor.',
              'Shift-drag, right-drag or two fingers to pan.',
              'W A S D Q E to fly.',
              'R returns to the preset, B toggles breathing, H hides the panel, P saves a PNG.',
            ],
      ),
    );
    guide.replaceChildren(...nodes);
  };
  syncs.push(buildGuide);

  // --- Quests ---
  const questHead = el('div', 'quest-head');
  const questCount = el('span', 'quest-count');
  const questBar = el('div', 'bar');
  const questFill = el('div', 'bar-fill');
  questBar.append(questFill);
  questHead.append(el('span', 'quest-lead', 'Discoveries'), questCount);
  const questList = el('ol', 'quest-list');
  quests.append(questHead, questBar, questList);

  const refreshExplore = (): void => {
    const done = new Set(saved.quests);
    const n = QUESTS.filter((q) => done.has(q.id)).length;
    questCount.textContent = `${n} of ${QUESTS.length}`;
    questFill.style.width = `${(100 * n) / QUESTS.length}%`;
    tabButtons[2].textContent = `Quests ${n}/${QUESTS.length}`;
    questList.replaceChildren(
      ...QUESTS.map((q) => {
        const li = el('li', done.has(q.id) ? 'quest done' : 'quest');
        li.append(el('span', 'quest-title', q.title), el('span', 'quest-text', done.has(q.id) ? q.reward : q.hint));
        return li;
      }),
    );
    bookmarkList.replaceChildren(
      ...saved.bookmarks.map((b, i) => {
        const row = el('div', 'bookmark');
        const open = button('chip bookmark-open', b.name, 'Return to this view');
        open.addEventListener('click', () => hooks.onOpenBookmark(i));
        const del = button('icon-btn small', '×', 'Delete this bookmark');
        del.setAttribute('aria-label', `Delete bookmark ${b.name}`);
        del.addEventListener('click', () => hooks.onDeleteBookmark(i));
        row.append(open, del);
        return row;
      }),
    );
  };

  // --- overlays ---
  const stats = el('div', 'stats');
  const statsText = el('span', 'stats-text');
  const statsBar = el('div', 'bar stats-bar');
  const statsFill = el('div', 'bar-fill');
  statsBar.append(statsFill);
  stats.append(statsText, statsBar);
  const reveal = button('reveal', 'Controls', 'Show the panel (key H)');
  const toasts = el('div', 'toasts');
  toasts.setAttribute('aria-live', 'polite');

  const setHidden = (hidden: boolean): void => {
    if (document.body.classList.contains('ui-hidden') === hidden) return;
    document.body.classList.toggle('ui-hidden', hidden);
    hooks.onPrefs(hidden, tab);
  };
  const toggleHidden = (): void => setHidden(!document.body.classList.contains('ui-hidden'));
  hide.addEventListener('click', () => setHidden(true));
  collapse.addEventListener('click', () => setHidden(true));
  reveal.addEventListener('click', () => setHidden(false));

  function refresh(): void {
    for (const s of syncs) s();
  }

  root.append(panel, stats, reveal, toasts);
  document.body.classList.toggle('ui-hidden', saved.prefs.hidden);
  syncTabs();
  refresh();
  refreshExplore();
  return {
    refresh,
    refreshExplore,
    toggleHidden,
    setHidden,
    setStats: (text, progress) => {
      if (statsText.textContent !== text) statsText.textContent = text;
      statsBar.hidden = progress < 0;
      stats.classList.toggle('busy', progress >= 0);
      if (progress >= 0) statsFill.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    },
    setLocation: (text) => {
      if (location.textContent !== text) location.textContent = text;
    },
    toast: (title, body) => {
      const t = el('div', 'toast');
      t.append(el('strong', 'toast-title', title), el('span', 'toast-body', body));
      toasts.append(t);
      while (toasts.childElementCount > 3) toasts.firstElementChild?.remove();
      setTimeout(() => t.classList.add('leaving'), 5200);
      setTimeout(() => t.remove(), 5800);
    },
  };
}
