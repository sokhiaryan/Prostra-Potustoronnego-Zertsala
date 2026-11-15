// The Settings page: how the game looks and handles. Edits the Settings record in place
// and reports each change, so the caller can apply and store it.
import { FOV_RANGE, HEADLAMP_MODES, SENSITIVITY_RANGE, SPEED_RANGE } from '../app/settings';
import type { Settings } from '../app/settings';
import { QUALITIES } from '../app/state';
import { choice, el, slider, toggle } from './widgets';

const HEADLAMP_LABELS: Record<(typeof HEADLAMP_MODES)[number], string> = { auto: 'Auto', on: 'On', off: 'Off' };

export function buildSettingsPage(s: Settings, onChange: () => void): HTMLElement {
  const page = el('div', 'settings');
  const group = (title: string, ...rows: HTMLElement[]): void => {
    const g = el('div', 'settings-group');
    g.append(el('h3', 'guide-head', title), ...rows);
    page.append(g);
  };
  const times = (v: number): string => `${v.toFixed(2)}×`;

  const quality = choice('grid grid-4', QUALITIES.map((q) => q.name), () => s.quality, (i) => {
    s.quality = i;
    quality.sync();
    onChange();
  });
  const headlamp = choice(
    'grid grid-3',
    HEADLAMP_MODES.map((m) => HEADLAMP_LABELS[m]),
    () => HEADLAMP_MODES.indexOf(s.headlamp),
    (i) => {
      s.headlamp = HEADLAMP_MODES[i];
      headlamp.sync();
      onChange();
    },
  );
  const lampRow = el('div', 'row');
  lampRow.append(
    el('span', 'row-name', 'Headlamp'),
    headlamp.root,
    el('span', 'row-note', 'A light carried in flight. Auto brings it up as you go inside, where the sun does not reach.'),
  );

  group(
    'Picture',
    quality.root,
    toggle(
      'Motion smoothing',
      'Blend frames while moving, which hides the lower resolution used in motion.',
      () => s.smoothing,
      (v) => (s.smoothing = v),
      onChange,
    ).row,
    lampRow,
    slider(
      {
        label: 'Field of view in flight',
        min: FOV_RANGE.min,
        max: FOV_RANGE.max,
        step: 1,
        format: (v) => `${v.toFixed(0)}°`,
        get: () => s.fov,
        set: (v) => (s.fov = v),
      },
      onChange,
    ).row,
  );

  group(
    'Flight',
    slider(
      {
        label: 'Mouse sensitivity',
        min: SENSITIVITY_RANGE.min,
        max: SENSITIVITY_RANGE.max,
        step: 0.05,
        format: times,
        get: () => s.sensitivity,
        set: (v) => (s.sensitivity = v),
      },
      onChange,
    ).row,
    slider(
      {
        label: 'Flight speed',
        min: SPEED_RANGE.min,
        max: SPEED_RANGE.max,
        step: 0.05,
        format: times,
        get: () => s.speed,
        set: (v) => (s.speed = v),
      },
      onChange,
    ).row,
    toggle('Invert vertical look', 'Pull the mouse back to look up.', () => s.invertY, (v) => (s.invertY = v), onChange).row,
  );

  group(
    'Interface',
    toggle('Heads-up display', 'Depth, motes and the marker that points to the nearest one.', () => s.hud, (v) => (s.hud = v), onChange)
      .row,
    toggle('Renderer statistics', 'Frame rate, resolution and renderer progress.', () => s.stats, (v) => (s.stats = v), onChange).row,
    toggle(
      'Reduce motion',
      'No drifting camera behind the menu.',
      () => s.reduceMotion,
      (v) => (s.reduceMotion = v),
      onChange,
    ).row,
  );
  return page;
}
