// Pointer, wheel and keyboard bindings for the camera and global shortcuts.
import type { Camera, DistFn } from './camera';

export interface InputActions {
  toggleUi(): void;
  screenshot(): void;
  preset(index: number): void;
  reset(): void;
  toggleBreathing(): void;
}

const ORBIT_SPEED = 0.0052; // radians per CSS pixel
const WHEEL_ZOOM = 0.0016; // e-folds per wheel pixel
const PINCH_ZOOM = 0.012; // trackpad pinch arrives as ctrl+wheel with small deltas
const WHEEL_GESTURE_GAP_MS = 220;

export function attachInput(canvas: HTMLCanvasElement, cam: Camera, dist: DistFn, actions: InputActions): void {
  let mode: 'none' | 'orbit' | 'pan' = 'none';
  let lastX = 0;
  let lastY = 0;
  let lastWheel = -1e9;
  const keys = new Set<string>();

  const pickAt = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const aspect = rect.width / rect.height;
    const nx = (((clientX - rect.left) / rect.width) * 2 - 1) * aspect;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    cam.pickPivot(nx, ny, dist, rect.height);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'none') return;
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 0 && !e.shiftKey) {
      // Orbit around whatever is under the cursor; on a miss the previous pivot is kept.
      pickAt(e.clientX, e.clientY);
      mode = 'orbit';
      cam.dragging = true;
    } else {
      mode = 'pan';
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mode === 'none') return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === 'orbit') cam.orbit(-dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    else cam.pan(dx, dy, canvas.clientHeight);
  });

  const endDrag = (e: PointerEvent): void => {
    if (mode === 'none') return;
    mode = 'none';
    cam.dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // A new wheel gesture re-anchors the zoom on the surface under the cursor.
      if (e.timeStamp - lastWheel > WHEEL_GESTURE_GAP_MS) pickAt(e.clientX, e.clientY);
      lastWheel = e.timeStamp;
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const amount = -px * (e.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM);
      cam.zoom(Math.max(-0.6, Math.min(0.6, amount)));
    },
    { passive: false },
  );

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
