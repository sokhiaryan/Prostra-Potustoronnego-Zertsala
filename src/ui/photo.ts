// Photo mode: a small sheet shown while the view is frozen for a picture. The lens
// opens for depth of field (focused on whatever is at the centre), and the still frame
// accumulates until it is clean.
import type { AppState } from '../app/state';
import { button, el, slider } from './widgets';

export interface PhotoState {
  /** Lens opening, 0 (everything sharp) to 1. */
  aperture: number;
}

export interface PhotoHooks {
  onChange(): void;
  onSave(): void;
  onClose(): void;
}

export interface Photo {
  refresh(): void;
}

export function buildPhoto(root: HTMLElement, state: AppState, photo: PhotoState, hooks: PhotoHooks): Photo {
  const sheet = el('aside', 'sheet photo');
  sheet.setAttribute('aria-label', 'Photo mode');
  const header = el('header', 'sheet-head');
  const done = button('pill', 'Done', 'Back to the world (Esc)');
  done.addEventListener('click', () => hooks.onClose());
  header.append(el('h2', 'menu-title', 'Photo mode'), done);

  const sliders = [
    slider(
      {
        label: 'Depth of field',
        min: 0,
        max: 1,
        step: 0.01,
        note: { does: 'Opens the lens: the centre of the picture stays sharp and the rest softens.', tryThis: 'Orbit so something is close to the camera, then open it wide.' },
        get: () => photo.aperture,
        set: (v) => (photo.aperture = v),
      },
      hooks.onChange,
    ),
    slider({ label: 'Exposure', min: 0.3, max: 3, step: 0.01, get: () => state.exposure, set: (v) => (state.exposure = v) }, hooks.onChange),
    slider({ label: 'Bloom', min: 0, max: 2, step: 0.01, get: () => state.bloom, set: (v) => (state.bloom = v) }, hooks.onChange),
  ];
  const save = button('chip primary wide', 'Save PNG', 'Save the picture as it is now');
  save.addEventListener('click', () => hooks.onSave());

  sheet.append(header, ...sliders.map((s) => s.row), el('p', 'row-note', 'Drag to orbit and scroll to zoom. The picture sharpens while you hold still.'), save);
  root.append(sheet);
  return { refresh: () => sliders.forEach((s) => s.sync()) };
}
