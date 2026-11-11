// CPU mirrors of the GLSL distance estimators in src/render/shaders/de.glsl.
// They exist for two reasons: the unit tests check the maths here, and the camera
// uses them to pick the surface point under the cursor and to scale its speed.
// Keep the two implementations line for line in sync. All functions are allocation-free.

export const BULB_BAILOUT = 8;

/** Mandelbulb: |z| ln|z| / (2 |dz|), with the running derivative dr. */
export function deBulb(
  px: number,
  py: number,
  pz: number,
  power: number,
  phaseTheta: number,
  phasePhi: number,
  iter: number,
): number {
  let x = px;
  let y = py;
  let z = pz;
  let dr = 1;
  let r = Math.hypot(x, y, z);
  for (let i = 0; i < iter && r <= BULB_BAILOUT; i++) {
    const rs = Math.max(r, 1e-9);
    const theta = Math.acos(Math.min(1, Math.max(-1, z / rs))) * power + phaseTheta;
    const phi = Math.atan2(y, x) * power + phasePhi;
    dr = power * Math.pow(rs, power - 1) * dr + 1;
    const zr = Math.pow(rs, power);
    const st = Math.sin(theta);
    x = zr * st * Math.cos(phi) + px;
    y = zr * st * Math.sin(phi) + py;
    z = zr * Math.cos(theta) + pz;
    r = Math.hypot(x, y, z);
  }
  return (0.5 * Math.log(Math.max(r, 1e-9)) * r) / dr;
}

function boxFold(v: number, fold: number): number {
  return Math.min(fold, Math.max(-fold, v)) * 2 - v;
}

/** Mandelbox: |z| / |dz| with a scalar running derivative. */
export function deBox(
  px: number,
  py: number,
  pz: number,
  scale: number,
  minRadius: number,
  fold: number,
  iter: number,
): number {
  const minR2 = minRadius * minRadius;
  const as = Math.abs(scale);
  let x = px;
  let y = py;
  let z = pz;
  let dr = 1;
  for (let i = 0; i < iter; i++) {
    x = boxFold(x, fold);
    y = boxFold(y, fold);
    z = boxFold(z, fold);
    const k = 1 / Math.min(1, Math.max(minR2, x * x + y * y + z * z));
    x = x * k * scale + px;
    y = y * k * scale + py;
    z = z * k * scale + pz;
    dr = dr * k * as + 1;
    if (x * x + y * y + z * z > 1e6) break;
  }
  return Math.hypot(x, y, z) / Math.abs(dr);
}

/** Column-major 3x3 rotation Rx(b) * Rz(a) used as the KIFS fold rotation. */
export function kifsRotation(a: number, b: number, out: Float32Array | Float64Array | number[]): void {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  out[0] = ca;
  out[1] = cb * sa;
  out[2] = sb * sa;
  out[3] = -sa;
  out[4] = cb * ca;
  out[5] = sb * ca;
  out[6] = 0;
  out[7] = -sb;
  out[8] = cb;
}

/** Kaleidoscopic Menger: folds and rotations are isometries, so box distance / scale^n is exact-Lipschitz. */
export function deKifs(
  px: number,
  py: number,
  pz: number,
  scale: number,
  rot: ArrayLike<number>,
  offZ: number,
  iter: number,
): number {
  const c = offZ * (scale - 1);
  let x = px;
  let y = py;
  let z = pz;
  let w = 1;
  let t: number;
  for (let i = 0; i < iter; i++) {
    x = Math.abs(x);
    y = Math.abs(y);
    z = Math.abs(z);
    if (x < y) { t = x; x = y; y = t; }
    if (x < z) { t = x; x = z; z = t; }
    if (y < z) { t = y; y = z; z = t; }
    const rx = rot[0] * x + rot[3] * y + rot[6] * z;
    const ry = rot[1] * x + rot[4] * y + rot[7] * z;
    const rz = rot[2] * x + rot[5] * y + rot[8] * z;
    x = rx * scale - (scale - 1);
    y = ry * scale - (scale - 1);
    z = 0.5 * c - Math.abs(rz * scale - 0.5 * c);
    w *= scale;
  }
  const qx = Math.abs(x) - 1;
  const qy = Math.abs(y) - 1;
  const qz = Math.abs(z) - 1;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return (outside + inside) / w;
}
