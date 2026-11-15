// Pointer, wheel, touch and keyboard bindings for the canvas, in whichever mode the shell
// is in. Fly: the mouse is captured and turns the view, W A S D move, the wheel changes
// the speed gear. Study: one finger or the mouse orbits, two fingers pinch-zoom and pan,
// the wheel zooms toward the cursor. Flat: drag to move, wheel or pinch to zoom.
// While a menu is open ("off") the canvas takes no input at all.
import type { InputMode } from '../game/shell';
import type { View2D } from '../view2d/view';
import { GEAR_MAX, GEAR_MIN } from './camera';
import type { Camera, DistFn } from './camera';

export interface InputTarget {
  cam: Camera;
  view: View2D;
  dist: DistFn;
  /** What the canvas controls right now. */
  mode(): InputMode;
  /** True on the play screen, where the single-key shortcuts apply (not in a menu or a sheet). */
  playing(): boolean;
  /** Mouse-look speed multiplier and vertical inversion, read live from the settings. */
  sensitivity(): number;
  invertY(): boolean;
}

export interface InputActions {
  /** Esc: pause, close a sheet, or go back a menu page. */
  escape(): void;
  /** The browser released the captured mouse while flying (Esc, or the window lost focus). */
  lockLost(): void;
  /** Switch between flying and Study. */
  toggleMode(): void;
  photo(): void;
  tuner(): void;
  reset(): void;
  toggleBreathing(): void;
  surprise(): void;
  mutate(): void;
}

export interface Input {
  /** Ask the browser to capture the mouse for flight. Must be called from a user gesture. */
  capture(): void;
  release(): void;
  /** The mouse is captured. */
  readonly locked: boolean;
}

const ORBIT_SPEED = 0.0052; // radians per CSS pixel
const LOOK_SPEED = 0.0022; // radians per pixel of captured mouse movement
const DRAG_LOOK_SPEED = 0.004; // radians per CSS pixel when looking by dragging (touch, or no capture)
const WHEEL_ZOOM = 0.0016; // e-folds per wheel pixel
const WHEEL_GEAR = 0.0015; // e-folds of speed per wheel pixel
const PINCH_ZOOM = 0.012; // trackpad pinch arrives as ctrl+wheel with small deltas
const WHEEL_GESTURE_GAP_MS = 220;

export function attachInput(canvas: HTMLCanvasElement, target: InputTarget, actions: InputActions): Input {
  const { cam, view } = target;
  let mode: 'none' | 'orbit' | 'pan' | 'pinch' | 'look' = 'none';
  let lastX = 0;
  let lastY = 0;
  let lastSpan = 1;
  let lastWheel = -1e9;
  const keys = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();

  const locked = (): boolean => document.pointerLockElement === canvas;
  const capture = (): void => {
    if (locked() || !canvas.requestPointerLock) return;
    try {
      // Chrome refuses for about a second after the player presses Esc; a click then captures.
      const p = canvas.requestPointerLock() as unknown;
      if (p instanceof Promise) p.catch(() => {});
    } catch {
      // not available: dragging still turns the view
    }
  };
  const release = (): void => {
    if (locked()) document.exitPointerLock();
  };

  const look = (dx: number, dy: number, speed: number): void => {
    const k = speed * target.sensitivity();
    cam.look(-dx * k, (target.invertY() ? dy : -dy) * k);
  };

  /** Cursor position in view units: x in [-aspect, aspect], y in [-1, 1], y up. Returns false off-canvas. */
  const ndc = { x: 0, y: 0 };
  const toNdc = (clientX: number, clientY: number): boolean => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    ndc.x = (((clientX - rect.left) / rect.width) * 2 - 1) * (rect.width / rect.height);
    ndc.y = 1 - ((clientY - rect.top) / rect.height) * 2;
    return true;
  };

  const pickAt = (clientX: number, clientY: number): void => {
    if (toNdc(clientX, clientY)) cam.pickPivot(ndc.x, ndc.y, target.dist, canvas.clientHeight);
  };

  /** Midpoint and separation of the first two active pointers. */
  const pinch = { x: 0, y: 0, span: 1 };
  const readPinch = (): void => {
    const it = pointers.values();
    const a = it.next().value as { x: number; y: number };
    const b = it.next().value as { x: number; y: number };
    pinch.x = (a.x + b.x) / 2;
    pinch.y = (a.y + b.y) / 2;
    pinch.span = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  };

  canvas.addEventListener('pointerdown', (e) => {
    const m = target.mode();
    if (m === 'off') return;
    e.preventDefault();
    if (m === 'fly') {
      if (locked()) return;
      // Keys go to the game, not to whichever button was clicked last.
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (e.pointerType === 'mouse') capture();
      // Until (or without) capture, dragging turns the view.
      canvas.setPointerCapture(e.pointerId);
      pointers.clear();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastX = e.clientX;
      lastY = e.clientY;
      mode = 'look';
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      readPinch();
      lastX = pinch.x;
      lastY = pinch.y;
      lastSpan = pinch.span;
      mode = 'pinch';
      cam.dragging = false;
      if (m !== 'flat') pickAt(pinch.x, pinch.y);
    } else if (pointers.size === 1) {
      lastX = e.clientX;
      lastY = e.clientY;
      if (m === 'flat') {
        mode = 'pan';
      } else if (e.button === 0 && !e.shiftKey) {
        // Orbit around whatever is under the cursor; on a miss the previous pivot is kept.
        pickAt(e.clientX, e.clientY);
        mode = 'orbit';
        cam.dragging = true;
      } else {
        mode = 'pan';
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || mode === 'none') return;
    const m = target.mode();
    if (m === 'off') return;
    p.x = e.clientX;
    p.y = e.clientY;
    const h = canvas.clientHeight;
    if (mode === 'look') {
      if (m === 'fly' && !locked()) look(e.clientX - lastX, e.clientY - lastY, DRAG_LOOK_SPEED);
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    if (mode === 'pinch') {
      if (pointers.size < 2) return;
      readPinch();
      const dx = pinch.x - lastX;
      const dy = pinch.y - lastY;
      const spread = Math.log(pinch.span / lastSpan); // e-folds, positive = fingers apart = closer
      lastX = pinch.x;
      lastY = pinch.y;
      lastSpan = pinch.span;
      if (m === 'flat') {
        view.panPixels(dx, dy, h);
        if (toNdc(pinch.x, pinch.y)) view.zoomNow(spread / Math.LN2, ndc.x, ndc.y);
      } else {
        cam.pan(dx, dy, h);
        cam.zoom(spread);
      }
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (m === 'flat') view.panPixels(dx, dy, h);
    else if (mode === 'orbit') cam.orbit(-dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    else cam.pan(dx, dy, h);
  });

  const endPointer = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    cam.dragging = false;
    if (pointers.size === 0 || mode === 'look') {
      mode = 'none';
    } else if (pointers.size === 1) {
      // One finger left after a pinch: carry on as a drag from where it is, without a jump.
      const rest = pointers.values().next().value as { x: number; y: number };
      lastX = rest.x;
      lastY = rest.y;
      mode = 'pan';
    } else {
      readPinch();
      lastX = pinch.x;
      lastY = pinch.y;
      lastSpan = pinch.span;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('mousemove', (e) => {
    if (locked() && target.mode() === 'fly') look(e.movementX, e.movementY, LOOK_SPEED);
  });
  document.addEventListener('pointerlockchange', () => {
    if (!locked() && target.mode() === 'fly') actions.lockLost();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      const m = target.mode();
      if (m === 'off') return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (m === 'fly') {
        cam.gear = Math.min(GEAR_MAX, Math.max(GEAR_MIN, cam.gear * Math.exp(-px * WHEEL_GEAR)));
        return;
      }
      const amount = Math.max(-0.6, Math.min(0.6, -px * (e.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM)));
      if (m === 'flat') {
        if (toNdc(e.clientX, e.clientY)) view.zoomAt(amount / Math.LN2, ndc.x, ndc.y);
        return;
      }
      // A new wheel gesture re-anchors the zoom on the surface under the cursor.
      if (e.timeStamp - lastWheel > WHEEL_GESTURE_GAP_MS) pickAt(e.clientX, e.clientY);
      lastWheel = e.timeStamp;
      cam.zoom(amount);
    },
    { passive: false },
  );

  // Movement keys are read by the frame loop from the camera (3D) or applied to the 2D view there.
  const syncFly = (): void => {
    const on = (code: string): number => (keys.has(code) ? 1 : 0);
    cam.flyZ = on('KeyW') - on('KeyS');
    cam.flyX = on('KeyD') - on('KeyA');
    cam.flyY = Math.min(1, on('KeyE') + on('Space')) - on('KeyQ');
    cam.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  };
  const clearKeys = (): void => {
    keys.clear();
    syncFly();
  };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Escape') {
      if (!e.repeat) actions.escape();
      return;
    }
    if (target.mode() === 'off') return; // the menu handles its own keys
    const el = e.target as HTMLElement | null;
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    // Sliders keep their arrow keys; the letter keys still work from them.
    if (typing && e.code.startsWith('Arrow')) return;
    switch (e.code) {
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'KeyQ': case 'KeyE':
      case 'ShiftLeft': case 'ShiftRight':
        keys.add(e.code);
        syncFly();
        return;
      case 'KeyB':
        if (!e.repeat) actions.toggleBreathing();
        return;
    }
    if (!target.playing()) return;
    switch (e.code) {
      case 'Space':
        // Rise, rather than pressing whichever button has the focus.
        e.preventDefault();
        keys.add(e.code);
        syncFly();
        break;
      case 'Tab':
        e.preventDefault();
        if (!e.repeat) actions.toggleMode();
        break;
      case 'KeyP':
        if (!e.repeat) actions.photo();
        break;
      case 'KeyT':
        if (!e.repeat) actions.tuner();
        break;
      case 'KeyR':
        if (!e.repeat) actions.reset();
        break;
      case 'KeyX':
        if (!e.repeat) actions.surprise();
        break;
      case 'KeyM':
        if (!e.repeat) actions.mutate();
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (keys.delete(e.code)) syncFly();
  });
  window.addEventListener('blur', clearKeys);

  return {
    capture,
    release,
    get locked() {
      return locked();
    },
  };
}
