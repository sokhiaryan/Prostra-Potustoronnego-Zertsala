import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera/camera';

// A unit sphere stands in for the fractal.
const sphere = (x: number, y: number, z: number): number => Math.hypot(x, y, z) - 1;

function dot3(a: ArrayLike<number>, i: number, j: number): number {
  return a[i] * a[j] + a[i + 1] * a[j + 1] + a[i + 2] * a[j + 2];
}

describe('Camera', () => {
  it('keeps an orthonormal basis that looks at the target', () => {
    const cam = new Camera();
    cam.lookAt(1.3, 0.8, 2.1, 0.1, -0.2, 0.3);
    const b = cam.basis;
    for (const i of [0, 3, 6]) expect(dot3(b, i, i)).toBeCloseTo(1, 5);
    expect(dot3(b, 0, 3)).toBeCloseTo(0, 5);
    expect(dot3(b, 0, 6)).toBeCloseTo(0, 5);
    expect(dot3(b, 3, 6)).toBeCloseTo(0, 5);
    const len = Math.hypot(0.1 - 1.3, -0.2 - 0.8, 0.3 - 2.1);
    expect(b[6]).toBeCloseTo((0.1 - 1.3) / len, 5);
    expect(b[7]).toBeCloseTo((-0.2 - 0.8) / len, 5);
    expect(b[8]).toBeCloseTo((0.3 - 2.1) / len, 5);
  });

  it('orbits rigidly: the distance to the pivot is preserved', () => {
    const cam = new Camera();
    cam.lookAt(0, 0.5, 3, 0, 0, 0);
    cam.pivot.set([0.4, 0.1, 0.9]); // off-centre pivot
    const before = cam.viewScale();
    cam.dragging = true;
    for (let i = 0; i < 50; i++) {
      cam.orbit(0.03, -0.011);
      cam.update(1 / 60, sphere);
    }
    expect(cam.viewScale()).toBeCloseTo(before, 9);
  });

  it('coasts after release and comes to rest', () => {
    const cam = new Camera();
    cam.lookAt(0, 0, 3, 0, 0, 0);
    cam.dragging = true;
    for (let i = 0; i < 10; i++) {
      cam.orbit(0.02, 0);
      cam.update(1 / 60, sphere);
    }
    cam.dragging = false;
    expect(cam.update(1 / 60, sphere)).toBe(true); // inertia
    let moved = true;
    for (let i = 0; i < 600 && moved; i++) moved = cam.update(1 / 60, sphere);
    expect(moved).toBe(false);
  });

  it('zoom steps scale with distance and stop at the precision limit', () => {
    const cam = new Camera();
    cam.lookAt(0, 0, 3, 0, 0, 0);
    expect(cam.pickPivot(0, 0, sphere, 900)).toBe(true);
    expect(cam.pivot[2]).toBeCloseTo(1, 2);

    // One e-fold of zoom shrinks the distance to the pivot by about e, wherever we start.
    const d0 = cam.viewScale();
    cam.zoom(1);
    for (let i = 0; i < 240; i++) cam.update(1 / 60, sphere);
    const d1 = cam.viewScale();
    expect(d0 / d1).toBeGreaterThan(2.6);
    expect(d0 / d1).toBeLessThan(2.8);
    cam.zoom(1);
    for (let i = 0; i < 240; i++) cam.update(1 / 60, sphere);
    expect(d1 / cam.viewScale()).toBeCloseTo(d0 / d1, 1);

    // Zooming far beyond the limit never passes minDist or tunnels through the surface.
    for (let k = 0; k < 40; k++) {
      cam.zoom(0.6);
      for (let i = 0; i < 30; i++) cam.update(1 / 60, sphere);
    }
    expect(cam.viewScale()).toBeGreaterThanOrEqual(cam.minDist * 0.999);
    expect(sphere(cam.pos[0], cam.pos[1], cam.pos[2])).toBeGreaterThan(0);
  });

  it('fly speed follows the distance to the surface', () => {
    const cam = new Camera();
    const stepFrom = (z: number): number => {
      cam.lookAt(0, 0, z, 0, 0, 0);
      cam.flyZ = 1;
      for (let i = 0; i < 30; i++) cam.update(1 / 60, sphere);
      cam.flyZ = 0;
      return z - cam.pos[2];
    };
    const farStep = stepFrom(3);
    const nearStep = stepFrom(1.05);
    expect(farStep).toBeGreaterThan(nearStep * 5);
    expect(cam.pos[2]).toBeGreaterThan(1); // never flies through the surface
  });
});
