// Pointer, wheel, touch and keyboard bindings for both views and the global shortcuts.
// One finger or the mouse orbits (3D) or drags (2D); two fingers pinch-zoom and pan;
// the wheel zooms toward the cursor.
import type { View2D } from '../view2d/view';
import type { Camera, DistFn } from './camera';

export interface InputTarget {
  cam: Camera;
  view: View2D;
  dist: DistFn;
  /** True while the 2D view is active. */
  flat(): boolean;
}

export interface InputActions {
  toggleUi(): void;
  screenshot(): void;
  preset(index: number): void;
  reset(): void;
  toggleBreathing(): void;
  surprise(): void;
  mutate(): void;
}

const ORBIT_SPEED = 0.0052; // radians per CSS pixel
const WHEEL_ZOOM = 0.0016; // e-folds per wheel pixel
const PINCH_ZOOM = 0.012; // trackpad pinch arrives as ctrl+wheel with small deltas
const WHEEL_GESTURE_GAP_MS = 220;

export function attachInput(canvas: HTMLCanvasElement, target: InputTarget, actions: InputActions): void {
  const { cam, view } = target;
  let mode: 'none' | 'orbit' | 'pan' | 'pinch' = 'none';
  let lastX = 0;
  let lastY = 0;
  let lastSpan = 1;
  let lastWheel = -1e9;
  const keys = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();

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
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      readPinch();
      lastX = pinch.x;
      lastY = pinch.y;
      lastSpan = pinch.span;
      mode = 'pinch';
      cam.dragging = false;
      if (!target.flat()) pickAt(pinch.x, pinch.y);
    } else if (pointers.size === 1) {
      lastX = e.clientX;
      lastY = e.clientY;
      if (target.flat()) {
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
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || mode === 'none') return;
    p.x = e.clientX;
    p.y = e.clientY;
    const h = canvas.clientHeight;
    if (mode === 'pinch') {
      if (pointers.size < 2) return;
      readPinch();
      const dx = pinch.x - lastX;
      const dy = pinch.y - lastY;
      const spread = Math.log(pinch.span / lastSpan); // e-folds, positive = fingers apart = closer
      lastX = pinch.x;
      lastY = pinch.y;
      lastSpan = pinch.span;
      if (target.flat()) {
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
    if (target.flat()) view.panPixels(dx, dy, h);
    else if (mode === 'orbit') cam.orbit(-dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    else cam.pan(dx, dy, h);
  });

  const endPointer = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    cam.dragging = false;
    if (pointers.size === 0) {
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

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const amount = Math.max(-0.6, Math.min(0.6, -px * (e.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM)));
      if (target.flat()) {
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

  // Fly keys are read by the frame loop from the camera (3D) or applied to the 2D view there.
  const syncFly = (): void => {
    cam.flyZ = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    cam.flyX = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    cam.flyY = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
  };

  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
      // Let sliders keep their arrow keys, but single-letter shortcuts still work from them.
      if (e.code.startsWith('Arrow')) return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.code) {
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'KeyQ': case 'KeyE':
        keys.add(e.code);
        syncFly();
        break;
      case 'KeyH':
        if (!e.repeat) actions.toggleUi();
        break;
      case 'KeyP':
        if (!e.repeat) actions.screenshot();
        break;
      case 'KeyR':
        if (!e.repeat) actions.reset();
        break;
      case 'KeyB':
        if (!e.repeat) actions.toggleBreathing();
        break;
      case 'KeyX':
        if (!e.repeat) actions.surprise();
        break;
      case 'KeyM':
        if (!e.repeat) actions.mutate();
        break;
      default:
        if (!e.repeat && /^Digit[1-9]$/.test(e.code)) actions.preset(Number(e.code.slice(5)) - 1);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (keys.delete(e.code)) syncFly();
  });
  window.addEventListener('blur', () => {
    keys.clear();
    syncFly();
  });
}
