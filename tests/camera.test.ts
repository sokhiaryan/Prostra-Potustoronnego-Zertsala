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

  it('looks around in place while flying', () => {
    const cam = new Camera();
    cam.lookAt(0, 0.4, 3, 0, 0, 0);
    cam.setMode('fly', sphere);
    const before = Array.from(cam.pos);
    cam.look(0.7, -0.3);
    cam.look(0, -5); // far past straight down: pitch is clamped, the view never flips
    expect(cam.update(1 / 60, sphere)).toBe(true);
    expect(Array.from(cam.pos)).toEqual(before);
    expect(Math.abs(cam.pitch)).toBeLessThan(Math.PI / 2);
    const b = cam.basis;
    for (const i of [0, 3, 6]) expect(dot3(b, i, i)).toBeCloseTo(1, 5);
  });

  it('slides along a wall instead of stopping or passing through', () => {
    const cam = new Camera();
    cam.minDist = 1e-3;
    // Aimed straight down -z from off-axis, so the sphere is met at a glancing angle.
    cam.lookAt(0, 0.45, 1.6, 0, 0.45, 0);
    cam.setMode('fly', sphere);
    cam.flyZ = 1;
    cam.gear = 4;
    let closest = Infinity;
    let slid = false;
    let yAt600 = 0;
    for (let i = 0; i < 900; i++) {
      cam.update(1 / 60, sphere);
      slid ||= cam.sliding;
      closest = Math.min(closest, sphere(cam.pos[0], cam.pos[1], cam.pos[2]));
      if (i === 599) yAt600 = cam.pos[1];
    }
    expect(closest).toBeGreaterThan(0); // never inside
    expect(slid).toBe(true);
    // Speed follows the distance to the surface, so the slide is slow, but it never stops:
    // the camera is still creeping outward along the sphere at the end.
    expect(cam.sliding).toBe(true);
    expect(cam.pos[1]).toBeGreaterThan(yAt600);
    expect(cam.pos[1]).toBeGreaterThan(0.45);
    expect(sphere(cam.pos[0], cam.pos[1], cam.pos[2])).toBeLessThan(0.01);
  });

  it('stops when flown straight into a wall', () => {
    const cam = new Camera();
    cam.minDist = 1e-3;
    cam.lookAt(0, 0, 1.2, 0, 0, 0);
    cam.setMode('fly', sphere);
    cam.flyZ = 1;
    cam.gear = 4;
    for (let i = 0; i < 2000; i++) cam.update(1 / 60, sphere);
    const d = sphere(cam.pos[0], cam.pos[1], cam.pos[2]);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.01);
    expect(Math.hypot(cam.pos[0], cam.pos[1])).toBeLessThan(1e-6);
  });

  it('can always back away from a wall it is touching', () => {
    const cam = new Camera();
    cam.minDist = 1e-3;
    cam.lookAt(0, 0, 1.0005, 0, 0, 0); // closer than the flight clearance
    cam.setMode('fly', sphere);
    cam.flyZ = -1;
    for (let i = 0; i < 60; i++) cam.update(1 / 60, sphere);
    expect(cam.pos[2]).toBeGreaterThan(1.001);
  });

  it('keeps the orbit pivot on what is being looked at when leaving flight', () => {
    const cam = new Camera();
    cam.lookAt(0, 0, 3, 0, 0, 0);
    cam.setMode('fly', sphere);
    cam.flyZ = 1;
    for (let i = 0; i < 30; i++) cam.update(1 / 60, sphere);
    cam.flyZ = 0;
    cam.setMode('orbit', sphere);
    expect(Math.abs(sphere(cam.pivot[0], cam.pivot[1], cam.pivot[2]))).toBeLessThan(0.01);
    expect(cam.viewScale()).toBeCloseTo(cam.pos[2] - 1, 2);
  });

  it('reports the distance to the surface while flying', () => {
    const cam = new Camera();
    cam.lookAt(0, 0, 2.5, 0, 0, 0);
    cam.setMode('fly', sphere);
    cam.update(1 / 60, sphere);
    expect(cam.proximity).toBeCloseTo(1.5, 6);
  });
});
