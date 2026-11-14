// Heads-up display shown while in a world: what mode the player is in, how deep they
// are, where the nearest mote is, and a line of key hints. Nothing here takes input
// except the two corner buttons, which exist for touch and for a mouse that is not captured.
import { button, el } from './widgets';

export interface HudHooks {
  onMenu(): void;
  /** Switch between flying and Study. */
  onToggleMode(): void;
}

/** Where to draw the mote marker, in CSS pixels from the top-left of the viewport. */
export interface Marker {
  x: number;
  y: number;
  /** Radius of the ring: the mote's collection sphere as seen from here. */
  r: number;
  /** False when the mote is off screen or behind: then an arrow sits at the edge instead. */
  onScreen: boolean;
  /** Direction of the arrow, radians clockwise from "right". */
  angle: number;
  label: string;
}

export interface Hud {
  /** Renderer status line; `progress` in [0, 1] shows a bar, a negative value hides it. */
  setStats(text: string, progress: number): void;
  setDepth(text: string): void;
  /** Mode line, and the label of the button that switches mode ('' hides the button). */
  setMode(text: string, toggleLabel: string): void;
  setMotes(text: string): void;
  setHint(text: string): void;
  setPrompt(text: string): void;
  setMarker(m: Marker | null): void;
  /** Where the 2D view is. */
  setLocation(text: string): void;
  toast(title: string, body: string): void;
}

const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
  node.hidden = text === '';
};

export function buildHud(root: HTMLElement, hooks: HudHooks): Hud {
  const hud = el('div', 'hud');

  const status = el('div', 'hud-status');
  const mode = el('span', 'hud-mode');
  const motes = el('span', 'hud-motes');
  status.append(mode, motes);

  const corner = el('div', 'hud-corner');
  const toggleMode = button('pill', '', 'Switch between flying and Study (Tab)');
  const menu = button('pill', 'Menu', 'Pause (Esc)');
  toggleMode.addEventListener('click', () => hooks.onToggleMode());
  menu.addEventListener('click', () => hooks.onMenu());
  corner.append(toggleMode, menu);

  const gauge = el('div', 'hud-gauge');
  const depth = el('span', 'hud-depth');
  const stats = el('div', 'stats');
  const statsText = el('span', 'stats-text');
  const statsBar = el('div', 'bar stats-bar');
  const statsFill = el('div', 'bar-fill');
  statsBar.append(statsFill);
  stats.append(statsText, statsBar);
  gauge.append(depth, stats);

  const location = el('p', 'location');
  const hint = el('p', 'hud-hint');
  const prompt = el('p', 'hud-prompt');
  const reticle = el('div', 'reticle');
  reticle.setAttribute('aria-hidden', 'true');

  const marker = el('div', 'marker');
  marker.setAttribute('aria-hidden', 'true');
  const ring = el('div', 'marker-ring');
  const arrow = el('div', 'marker-arrow');
  const label = el('span', 'marker-label');
  marker.append(ring, arrow, label);
  marker.hidden = true;

  hud.append(status, corner, gauge, location, hint, prompt, reticle, marker);

  const toasts = el('div', 'toasts');
  toasts.setAttribute('aria-live', 'polite');
  root.append(hud, toasts);

  for (const node of [motes, hint, prompt, location, depth]) node.hidden = true;

  return {
    setStats: (text, progress) => {
      if (statsText.textContent !== text) statsText.textContent = text;
      statsBar.hidden = progress < 0;
      stats.classList.toggle('busy', progress >= 0);
      if (progress >= 0) statsFill.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    },
    setDepth: (text) => setText(depth, text),
    setMode: (text, toggleLabel) => {
      setText(mode, text);
      setText(toggleMode, toggleLabel);
    },
    setMotes: (text) => setText(motes, text),
    setHint: (text) => setText(hint, text),
    setPrompt: (text) => setText(prompt, text),
    setMarker: (m) => {
      marker.hidden = !m;
      if (!m) return;
      marker.classList.toggle('off', !m.onScreen);
      marker.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      const d = Math.round(m.r * 2);
      ring.style.width = ring.style.height = `${d}px`;
      arrow.style.transform = `rotate(${m.angle.toFixed(3)}rad)`;
      label.style.top = `${m.onScreen ? Math.round(m.r) + 8 : 16}px`;
      if (label.textContent !== m.label) label.textContent = m.label;
    },
    setLocation: (text) => setText(location, text),
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
