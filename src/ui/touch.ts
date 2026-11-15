// Touch flight controls: a movement stick under the left thumb and up / down / boost
// buttons under the right. Looking around is a drag anywhere else on the picture
// (handled by camera/input.ts). Shown only on touch screens, and only while flying.
import type { Camera } from '../camera/camera';
import { button, el } from './widgets';

const STICK_RADIUS = 46; // CSS pixels of travel from the centre to full speed

export function buildTouch(root: HTMLElement, cam: Camera): void {
  const wrap = el('div', 'touch');

  const stick = el('div', 'stick');
  stick.setAttribute('aria-label', 'Move');
  const knob = el('div', 'stick-knob');
  stick.append(knob);
  let active = -1;
  const move = (e: PointerEvent): void => {
    const rect = stick.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    cam.flyX = dx / STICK_RADIUS;
    cam.flyZ = -dy / STICK_RADIUS;
  };
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    active = -1;
    knob.style.transform = '';
    cam.flyX = cam.flyZ = 0;
  };
  stick.addEventListener('pointerdown', (e) => {
    if (active >= 0) return;
    active = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    move(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === active) move(e);
  });
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);

  /** A button that acts for as long as it is held. */
  const hold = (label: string, title: string, set: (on: boolean) => void): HTMLButtonElement => {
    const b = button('touch-btn', label, title);
    b.addEventListener('pointerdown', (e) => {
      b.setPointerCapture(e.pointerId);
      set(true);
      e.preventDefault();
    });
    const off = (): void => set(false);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };
  const buttons = el('div', 'touch-buttons');
  buttons.append(
    hold('Up', 'Rise', (on) => (cam.flyY = on ? 1 : 0)),
    hold('Boost', 'Fly faster', (on) => (cam.boost = on)),
    hold('Down', 'Sink', (on) => (cam.flyY = on ? -1 : 0)),
  );

  wrap.append(stick, buttons);
  root.append(wrap);
}
