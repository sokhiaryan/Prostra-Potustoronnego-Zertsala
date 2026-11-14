// Mandelbrot set by perturbation, for zooms far beyond float64.
//
// One reference orbit Z_n is iterated at full precision (BigInt fixed point). Every pixel
// then only tracks its difference d_n from that orbit, which obeys
//     d_{n+1} = 2 Z_n d_n + d_n^2 + dc,        z_n = Z_n + d_n,
// where dc is the pixel's offset from the reference point. The differences are tiny, so
// doubles carry them with full relative precision at any depth. Whenever the full value
// z_n becomes smaller than d_n (or the reference orbit ends), the pixel "rebases": it
// restarts from the beginning of the reference with d = z. That keeps the subtraction
// Z + d from cancelling and makes a single reference valid for the whole image.
// Past about 1e-290 even the differences leave the double range; there the same recurrence
// runs on a mantissa with a separate exponent until the difference has grown back.
// docs/MATH.md has the derivation.
import { ZERO_EXP, fxToFloatExp, ldexp, pow2 } from './bigfixed';

export const ESCAPE_RADIUS = 256;
const R2 = ESCAPE_RADIUS * ESCAPE_RADIUS;
const LN_R = Math.log(ESCAPE_RADIUS);
/** Pixel spacings below 2^DEEP_EXP need the extended-exponent path. */
export const DEEP_EXP = -960;
/** Palette coordinate advanced per unit of sqrt(smooth iteration count). */
export const MANDEL_COLOR_RATE = 0.11;

const PLAIN_FLOOR = 1e-200; // a plain step whose result is smaller is redone in extended form
const LEAVE_EXT_EXP = -300; // extended deltas above 2^-300 * 1e-60 go back to plain doubles
const MANT_LOW = 1e-60;
const MANT_HIGH = 1e60;

export interface RefOrbit {
  /** Number of stored points Z_0 .. Z_{len-1}. */
  len: number;
  /** True if the reference left the escape radius (its last point); it then serves any iteration budget. */
  escaped: boolean;
  maxIter: number;
  /**
   * If the stored orbit ends in an exact cycle, its period and the first index from which
   * Z_{n+period} equals Z_n in every stored array; period 0 otherwise.
   */
  period: number;
  periodStart: number;
  zr: Float64Array;
  zi: Float64Array;
  /** Mantissas and shared exponent of each point for the extended path; null when not requested. */
  xr: Float64Array | null;
  xi: Float64Array | null;
  xe: Float64Array | null;
}

/** Iteration budget for a zoom of 2^zoomLog2, times a user bias. Deeper views need longer orbits. */
export function mandelMaxIter(zoomLog2: number, bias: number): number {
  return Math.max(50, Math.floor((300 + 60 * Math.pow(Math.max(0, zoomLog2), 1.25)) * bias));
}

/** Fractional iteration count at escape, continuous across iteration bands. */
export function smoothCount(n: number, mag2: number): number {
  return n + 1 - Math.log2((0.5 * Math.log(mag2)) / LN_R);
}

function grow(a: Float64Array, cap: number): Float64Array<ArrayBuffer> {
  const b = new Float64Array(cap);
  b.set(a);
  return b;
}

/**
 * Iterate Z -> Z^2 + C in fixed point with `bits` fractional bits and record the orbit
 * as doubles. `progress` is called every few thousand iterations.
 */
export function computeReference(
  re: bigint,
  im: bigint,
  bits: number,
  maxIter: number,
  extended: boolean,
  progress?: (done: number) => void,
): RefOrbit {
  const B = BigInt(bits);
  const B1 = BigInt(bits - 1);
  let cap = Math.min(maxIter + 1, 4096);
  let zr = new Float64Array(cap);
  let zi = new Float64Array(cap);
  let xr = extended ? new Float64Array(cap) : null;
  let xi = extended ? new Float64Array(cap) : null;
  let xe = extended ? new Float64Array(cap) : null;
  const a = new Float64Array(2);
  const b = new Float64Array(2);
  let x = 0n;
  let y = 0n;
  let escaped = false;
  let n = 0;
  for (; ; n++) {
    if (n === cap) {
      cap = Math.min(maxIter + 1, cap * 2);
      zr = grow(zr, cap);
      zi = grow(zi, cap);
      if (xr && xi && xe) {
        xr = grow(xr, cap);
        xi = grow(xi, cap);
        xe = grow(xe, cap);
      }
    }
    fxToFloatExp(x, bits, a);
    fxToFloatExp(y, bits, b);
    const pr = a[1] === 0 ? a[0] : ldexp(a[0], a[1]);
    const pi = b[1] === 0 ? b[0] : ldexp(b[0], b[1]);
    zr[n] = pr;
    zi[n] = pi;
    if (xr && xi && xe) {
      const e = a[1] > b[1] ? a[1] : b[1];
      xr[n] = a[0] * pow2(a[1] - e);
      xi[n] = b[0] * pow2(b[1] - e);
      xe[n] = e;
    }
    if (n === maxIter) break;
    if (pr * pr + pi * pi > R2) {
      escaped = true;
      break;
    }
    const x2 = x * x;
    const y2 = y * y;
    const xy = x * y;
    x = ((x2 - y2) >> B) + re;
    y = (xy >> B1) + im;
    if (progress && (n & 4095) === 4095) progress(n);
  }
  const len = n + 1;
  const ref: RefOrbit = {
    len,
    escaped,
    maxIter,
    period: 0,
    periodStart: 0,
    zr: zr.slice(0, len),
    zi: zi.slice(0, len),
    xr: xr ? xr.slice(0, len) : null,
    xi: xi ? xi.slice(0, len) : null,
    xe: xe ? xe.slice(0, len) : null,
  };
  if (!escaped) findTailPeriod(ref);
  return ref;
}

const MAX_TAIL_PERIOD = 4096;

/** Detect a reference that has settled onto an exact cycle (an attracting or pre-periodic point). */
function findTailPeriod(ref: RefOrbit): void {
  const { zr, zi, xr, xi, xe } = ref;
  const same = (a: number, b: number): boolean =>
    zr[a] === zr[b] &&
    zi[a] === zi[b] &&
    (!xr || !xi || !xe || (xr[a] === xr[b] && xi[a] === xi[b] && xe[a] === xe[b]));
  const end = ref.len - 1;
  const limit = Math.min(MAX_TAIL_PERIOD, end >> 1);
  for (let p = 1; p <= limit; p++) {
    if (!same(end - p, end)) continue;
    let s = end - p;
    while (s > 0 && same(s - 1, s - 1 + p)) s--;
    // Only trust a cycle that has been observed for at least two full periods.
    if (end - s >= 2 * p) {
      ref.period = p;
      ref.periodStart = s;
    }
    return;
  }
}

/**
 * Iterate one pixel in plain doubles. (dcr, dci) is the pixel's offset from the reference
 * point. Returns the smooth iteration count, or -1 if the point did not escape.
 *
 * A point that never escapes usually settles onto a cycle. The loop state is (m, d), and
 * the loop is a deterministic function of it, so if the state ever repeats exactly the
 * orbit can never escape and the loop stops early with the same answer it would have
 * reached at maxIter (Brent's cycle detection). Where the reference itself is cyclic,
 * indices a whole number of periods apart read identical values and count as equal.
 * (A non-escaping reference is at least maxIter long, so its end cannot interfere.)
 */
export function iteratePlain(ref: RefOrbit, dcr: number, dci: number, maxIter: number): number {
  const zr = ref.zr;
  const zi = ref.zi;
  const last = ref.len - 1;
  const period = ref.period;
  const pstart = ref.periodStart;
  let dr = 0;
  let di = 0;
  let m = 0;
  let cm = -1;
  let cr = 0;
  let ci = 0;
  let next = 8;
  for (let k = 0; k < maxIter; k++) {
    const Zr = zr[m];
    const Zi = zi[m];
    const nr = 2 * (Zr * dr - Zi * di) + (dr * dr - di * di) + dcr;
    const ni = 2 * (Zr * di + Zi * dr) + 2 * dr * di + dci;
    dr = nr;
    di = ni;
    m++;
    const fr = zr[m] + dr;
    const fi = zi[m] + di;
    const mag = fr * fr + fi * fi;
    if (mag > R2) return smoothCount(k + 1, mag);
    if (m === last || Math.abs(fr) + Math.abs(fi) < Math.abs(dr) + Math.abs(di)) {
      dr = fr;
      di = fi;
      m = 0;
    }
    if (dr === cr && di === ci && (m === cm || (period > 0 && cm >= pstart && m > cm && (m - cm) % period === 0))) {
      return -1;
    }
    if (k === next) {
      cm = m;
      cr = dr;
      ci = di;
      next *= 2;
    }
  }
  return -1;
}

/**
 * Same iteration for pixel offsets below the double range: dc = (dcr + i dci) * 2^dce.
 * The difference is kept as a mantissa pair with the exponent `de` while it is tiny and
 * handed to the plain recurrence whenever it is safely inside the double range.
 * Requires a reference computed with `extended = true`.
 */
export function iterateDeep(ref: RefOrbit, dcr: number, dci: number, dce: number, maxIter: number): number {
  const zr = ref.zr;
  const zi = ref.zi;
  const xr = ref.xr as Float64Array;
  const xi = ref.xi as Float64Array;
  const xe = ref.xe as Float64Array;
  const last = ref.len - 1;
  const period = ref.period;
  const pstart = ref.periodStart;
  // Plain copy of dc: it underflows to zero at these depths, which is harmless because the
  // plain step is only kept when its result is at least PLAIN_FLOOR, far above dc.
  const pcr = dcr * pow2(dce);
  const pci = dci * pow2(dce);
  let dr = 0;
  let di = 0;
  let de = ZERO_EXP;
  let m = 0;
  let ext = true;
  let cm = -1;
  let cr = 0;
  let ci = 0;
  let next = 8;
  for (let k = 0; k < maxIter; k++) {
    if (!ext) {
      const Zr = zr[m];
      const Zi = zi[m];
      const nr = 2 * (Zr * dr - Zi * di) + (dr * dr - di * di) + pcr;
      const ni = 2 * (Zr * di + Zi * dr) + 2 * dr * di + pci;
      if (Math.abs(nr) + Math.abs(ni) >= PLAIN_FLOOR) {
        dr = nr;
        di = ni;
        m++;
        const fr = zr[m] + dr;
        const fi = zi[m] + di;
        const mag = fr * fr + fi * fi;
        if (mag > R2) return smoothCount(k + 1, mag);
        if (m === last || Math.abs(fr) + Math.abs(fi) < Math.abs(dr) + Math.abs(di)) {
          dr = fr;
          di = fi;
          m = 0;
        }
        if (dr === cr && di === ci && (m === cm || (period > 0 && cm >= pstart && m > cm && (m - cm) % period === 0))) {
          return -1;
        }
        if (k >= next) {
          cm = m;
          cr = dr;
          ci = di;
          next *= 2;
        }
        continue;
      }
      // The result would leave the double range: redo this step with an explicit exponent.
      ext = true;
      de = 0;
      const a0 = Math.max(Math.abs(dr), Math.abs(di));
      if (a0 === 0) {
        de = ZERO_EXP;
      } else if (a0 < MANT_LOW) {
        const sh = Math.floor(Math.log2(a0));
        dr = ldexp(dr, -sh);
        di = ldexp(di, -sh);
        de = sh;
      }
    }

    // Extended step: align the three terms of 2 Z d + d^2 + dc to the largest exponent.
    const e1 = xe[m] + de + 1;
    const e2 = de + de;
    let e = e1 > e2 ? e1 : e2;
    if (dce > e) e = dce;
    const s1 = pow2(e1 - e);
    const s2 = pow2(e2 - e);
    const s3 = pow2(dce - e);
    const Xr = xr[m];
    const Xi = xi[m];
    let nr = (Xr * dr - Xi * di) * s1 + (dr * dr - di * di) * s2 + dcr * s3;
    let ni = (Xr * di + Xi * dr) * s1 + 2 * dr * di * s2 + dci * s3;
    let ne = e;
    let a1 = Math.max(Math.abs(nr), Math.abs(ni));
    if (a1 === 0) {
      ne = ZERO_EXP;
    } else if (a1 < MANT_LOW || a1 > MANT_HIGH) {
      const sh = Math.floor(Math.log2(a1));
      nr = ldexp(nr, -sh);
      ni = ldexp(ni, -sh);
      ne += sh;
    }
    dr = nr;
    di = ni;
    de = ne;
    m++;

    // Full value z = Z_m + d, again with an explicit exponent.
    const ze = xe[m];
    const fe = ze > de ? ze : de;
    const sz = pow2(ze - fe);
    const sd = pow2(de - fe);
    let fr = xr[m] * sz + dr * sd;
    let fi = xi[m] * sz + di * sd;
    if (fe > -220) {
      const s = pow2(fe);
      const ar = fr * s;
      const ai = fi * s;
      const mag = ar * ar + ai * ai;
      if (mag > R2) return smoothCount(k + 1, mag);
    }
    const gap = fe - de;
    const smaller = gap <= 1000 && (Math.abs(fr) + Math.abs(fi)) * pow2(gap) < Math.abs(dr) + Math.abs(di);
    if (m === last || smaller) {
      let re = fe;
      a1 = Math.max(Math.abs(fr), Math.abs(fi));
      if (a1 === 0) {
        re = ZERO_EXP;
      } else if (a1 < MANT_LOW || a1 > MANT_HIGH) {
        const sh = Math.floor(Math.log2(a1));
        fr = ldexp(fr, -sh);
        fi = ldexp(fi, -sh);
        re += sh;
      }
      dr = fr;
      di = fi;
      de = re;
      m = 0;
    }
    if (de > LEAVE_EXT_EXP) {
      const s = pow2(de);
      dr *= s;
      di *= s;
      ext = false;
    }
  }
  return -1;
}
