// The main menu and the pause menu: one overlay with a stack of pages, drawn over the
// live canvas. Real buttons throughout; arrow keys move the focus, Tab stays inside the
// menu, and Esc (routed here by main.ts through back()) returns to the previous page.
import { FRACTALS } from '../app/fractals';
import { PRESETS } from '../app/presets';
import { LANDMARKS } from '../explore/random';
import type { Saved } from '../explore/store';
import { MOTES_PER_WORLD } from '../game/motes';
import { TOTAL_MOTES, WORLDS, isOpen, totalMotes, worldMotes } from '../game/progress';
import { buildCodex } from './codex';
import { buildSettingsPage } from './settings';
import { button, el } from './widgets';

export type MenuRoot = 'home' | 'pause';
type Page = MenuRoot | 'worlds' | 'deep' | 'codex' | 'gallery' | 'settings';

export interface MenuHooks {
  onContinue(): void;
  /** Index into WORLDS. */
  onWorld(index: number): void;
  /** Index into PRESETS (a flat one). */
  onFlatPreset(index: number): void;
  /** Index into LANDMARKS. */
  onLandmark(index: number): void;
  onOpenBookmark(index: number): void;
  onDeleteBookmark(index: number): void;
  onResume(): void;
  onTuner(): void;
  onPhoto(): void;
  onBookmark(): void;
  onShare(): void;
  onExit(): void;
  /** A setting was edited (the record is already updated). */
  onSettings(): void;
  /** The fractal on screen, which the Codex opens at. */
  fractal(): number;
}

export interface Menu {
  show(root: MenuRoot): void;
  hide(): void;
  /** Go back one page. Returns false at the root. */
  back(): boolean;
  /** Redraw the current page from the saved record, if the menu is showing. */
  refresh(): void;
}

const TITLES: Record<Page, string> = {
  home: '',
  pause: 'Paused',
  worlds: 'Free Fly',
  deep: 'Deep Zoom',
  codex: 'Codex',
  gallery: 'Gallery',
  settings: 'Settings',
};

export function buildMenu(root: HTMLElement, saved: Saved, hooks: MenuHooks): Menu {
  const overlay = el('div', 'menu');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.hidden = true;
  const card = el('div', 'menu-card');
  overlay.append(card);
  root.append(overlay);

  let stack: Page[] = [];

  const item = (label: string, detail: string, run: () => void): HTMLButtonElement => {
    const b = button('menu-item', '');
    b.append(el('strong', 'menu-item-label', label), el('span', 'menu-item-detail', detail));
    b.addEventListener('click', run);
    return b;
  };
  const go = (page: Page): void => {
    stack.push(page);
    render();
  };

  const home = (): HTMLElement[] => {
    const titles = el('header', 'menu-titles');
    const found = totalMotes(saved.motes);
    titles.append(
      el('h1', 'title', 'Prostra Potustoronnego Zertsala'),
      el('p', 'subtitle', 'Space of the Otherworldly Mirror'),
      el('p', 'menu-progress', `${found} of ${TOTAL_MOTES} motes found`),
    );
    const items = el('nav', 'menu-items');
    if (saved.resume) items.append(item('Continue', 'Back to where you were', hooks.onContinue));
    items.append(
      item('Free Fly', 'Fly through a world and find its motes', () => go('worlds')),
      item('Deep Zoom', 'The flat Mandelbrot set, as far down as you like', () => go('deep')),
      item('Codex', 'Discoveries, and what is known about each fractal', () => go('codex')),
      item('Gallery', saved.bookmarks.length === 1 ? '1 bookmark' : `${saved.bookmarks.length} bookmarks`, () => go('gallery')),
      item('Settings', 'Picture, flight and interface', () => go('settings')),
    );
    return [titles, items];
  };

  const pause = (): HTMLElement[] => {
    const items = el('nav', 'menu-items');
    items.append(
      item('Resume', 'Esc', hooks.onResume),
      item('Tuner', 'Change the shape, the colours and the light', hooks.onTuner),
      item('Photo mode', 'Depth of field, then save a PNG', hooks.onPhoto),
      item('Bookmark this view', 'Keep it in the Gallery', hooks.onBookmark),
      item('Copy link', 'A link that reopens this exact view', hooks.onShare),
      item('Codex', 'Discoveries, and what is known about each fractal', () => go('codex')),
      item('Settings', 'Picture, flight and interface', () => go('settings')),
      item('Exit to menu', 'Your place is kept for Continue', hooks.onExit),
    );
    return [items];
  };

  const worlds = (): HTMLElement[] => {
    const found = totalMotes(saved.motes);
    const grid = el('div', 'world-grid');
    WORLDS.forEach((w, i) => {
      const p = PRESETS[w.preset];
      const open = isOpen(w, saved.motes);
      const b = button(open ? 'world-card' : 'world-card locked', '');
      const have = worldMotes(saved.motes, w.id);
      const need = w.unlockAt - found;
      b.append(
        el('strong', 'world-name', p.name),
        el('span', 'world-kind', FRACTALS[p.fractal].name),
        el('span', 'world-blurb', p.blurb),
        el(
          'span',
          'world-state',
          open ? `${have} of ${MOTES_PER_WORLD} motes` : `Opens at ${w.unlockAt} motes: ${need} more to find`,
        ),
      );
      b.disabled = !open;
      b.addEventListener('click', () => hooks.onWorld(i));
      grid.append(b);
    });
    return [grid];
  };

  const deep = (): HTMLElement[] => {
    const starts = el('nav', 'menu-items');
    PRESETS.forEach((p, i) => {
      if (FRACTALS[p.fractal].flat) starts.append(item(p.name, p.blurb, () => hooks.onFlatPreset(i)));
    });
    const places = el('div', 'grid grid-2');
    LANDMARKS.forEach((lm, i) => {
      const b = button('chip', lm.name);
      b.addEventListener('click', () => hooks.onLandmark(i));
      places.append(b);
    });
    return [starts, el('h3', 'guide-head', 'Places worth a visit'), places];
  };

  const gallery = (): HTMLElement[] => {
    if (saved.bookmarks.length === 0) {
      return [el('p', 'guide-text', 'Nothing bookmarked yet. Pause in any view and choose "Bookmark this view" to keep it here.')];
    }
    const list = el('div', 'bookmarks');
    saved.bookmarks.forEach((b, i) => {
      const row = el('div', 'bookmark');
      const open = button('chip bookmark-open', b.name, 'Return to this view');
      open.addEventListener('click', () => hooks.onOpenBookmark(i));
      const del = button('icon-btn small', '×', 'Delete this bookmark');
      del.setAttribute('aria-label', `Delete bookmark ${b.name}`);
      del.addEventListener('click', () => hooks.onDeleteBookmark(i));
      row.append(open, del);
      list.append(row);
    });
    return [list];
  };

  function render(): void {
    const page = stack[stack.length - 1];
    if (!page) return;
    const nodes: HTMLElement[] = [];
    if (page !== 'home') {
      const head = el('header', 'menu-head');
      if (stack.length > 1) {
        const back = button('pill', 'Back', 'Back (Esc)');
        back.addEventListener('click', () => api.back());
        head.append(back);
      }
      head.append(el('h2', 'menu-title', TITLES[page]));
      nodes.push(head);
    }
    switch (page) {
      case 'home': nodes.push(...home()); break;
      case 'pause': nodes.push(...pause()); break;
      case 'worlds': nodes.push(...worlds()); break;
      case 'deep': nodes.push(...deep()); break;
      case 'codex': nodes.push(buildCodex(saved, hooks.fractal())); break;
      case 'gallery': nodes.push(...gallery()); break;
      case 'settings': nodes.push(buildSettingsPage(saved.settings, hooks.onSettings)); break;
    }
    card.dataset.page = page;
    card.replaceChildren(...nodes);
    card.scrollTop = 0;
    overlay.setAttribute('aria-label', TITLES[page] || 'Main menu');
    // Focus the first real choice, skipping the Back button when there is anything else.
    const all = focusables();
    (all.find((n) => !n.classList.contains('pill')) ?? all[0])?.focus();
  }

  const focusables = (): HTMLElement[] =>
    Array.from(card.querySelectorAll<HTMLElement>('button:not(:disabled), input')).filter((n) => n.offsetParent !== null);

  overlay.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const all = focusables();
    const at = all.indexOf(target);
    let step = 0;
    if (e.code === 'Tab') step = e.shiftKey ? -1 : 1;
    else if (target.tagName !== 'INPUT' && (e.code === 'ArrowDown' || e.code === 'ArrowRight')) step = 1;
    else if (target.tagName !== 'INPUT' && (e.code === 'ArrowUp' || e.code === 'ArrowLeft')) step = -1;
    if (step === 0 || all.length === 0) return;
    e.preventDefault();
    all[(at + step + all.length) % all.length].focus();
  });

  const api: Menu = {
    show: (rootPage) => {
      stack = [rootPage];
      overlay.hidden = false;
      render();
    },
    hide: () => {
      overlay.hidden = true;
      stack = [];
    },
    back: () => {
      if (stack.length <= 1) return false;
      stack.pop();
      render();
      return true;
    },
    refresh: () => {
      if (!overlay.hidden) render();
    },
  };
  return api;
}
