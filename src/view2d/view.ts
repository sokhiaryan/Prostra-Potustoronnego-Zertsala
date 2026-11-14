// The 2D view: a centre in the complex plane and a zoom level.
//
// The centre is an arbitrary-precision fixed-point number, extended as the zoom grows, so
// there is no depth at which panning stops resolving. The zoom is stored as its base-2
// logarithm, which a double holds exactly enough for any depth a browser could reach.
import { fxFromDecimal, fxFromNumber, fxRescale, fxToDecimal, fxToFloatExp, ldexp } from '../math/bigfixed';
import { DEEP_EXP } from '../math/mandel';
import type { RefSpec } from '../deep/pool';

/** Half the view height at zoom 1 (log2 zoom 0). */
export const BASE_HALF_HEIGHT = 1.25;
export const MIN_ZOOM = -1.5;
/** Extra fractional bits kept beyond the zoom level. */
const GUARD_BITS = 96;
const ZOOM_RESPONSE = 12;

export interface Snapshot {
  re: bigint;
  im: bigint;
  bits: number;
  zoom: number;
}

export class View2D {
  bits = 192;
  re = 0n;
  im = 0n;
  /** log2 of the magnification. */
  zoom = 0;
  /** Upper zoom limit (log2); Infinity when the deep renderer is available. */
  maxZoom = Infinity;

  private zoomPending = 0;
  private anchorX = 0;
  private anchorY = 0;
  private changed = true;
  private readonly fe = new Float64Array(2);

  constructor() {
    this.set('-0.65', '0', 0);
  }

  /** Jump to a centre given as decimal strings. Stops any zoom in progress. */
  set(re: string, im: string, zoom: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(MIN_ZOOM, zoom));
    this.bits = Math.max(192, this.neededBits());
    this.re = fxFromDecimal(re, this.bits);
    this.im = fxFromDecimal(im, this.bits);
    this.zoomPending = 0;
    this.changed = true;
  }

  /** Fractional bits the centre needs at the current zoom. */
  neededBits(): number {
    return Math.ceil(Math.max(0, this.zoom)) + GUARD_BITS;
  }

  private ensureBits(zoom: number): void {
    const need = Math.ceil(Math.max(0, zoom)) + GUARD_BITS;
    if (need <= this.bits) return;
    const to = Math.ceil((need + 64) / 64) * 64;
    this.re = fxRescale(this.re, this.bits, to);
    this.im = fxRescale(this.im, this.bits, to);
    this.bits = to;
  }

  /** Half the view height as mantissa * 2^exponent: out[0] in (0.625, 1.25], out[1] an integer. */
  half(out: Float64Array): void {
    const whole = Math.floor(this.zoom);
    out[0] = BASE_HALF_HEIGHT * Math.pow(2, whole - this.zoom);
    out[1] = -whole;
  }

  /** Base-2 logarithm of the spacing between pixel centres for a viewport `heightPx` tall. */
  pixelExp(heightPx: number): number {
    return Math.log2((2 * BASE_HALF_HEIGHT) / heightPx) - this.zoom;
  }

  /** Move the centre by (ux, uy) half-heights. */
  private shift(ux: number, uy: number): void {
    this.half(this.fe);
    const m = this.fe[0];
    const e = this.fe[1];
    this.re += fxFromNumber(ux * m, this.bits, e);
    this.im += fxFromNumber(uy * m, this.bits, e);
    this.changed = true;
  }

  /** Drag the picture by a pixel delta (x right, y down), for a viewport `heightPx` tall. */
  panPixels(dx: number, dy: number, heightPx: number): void {
    const k = 2 / Math.max(1, heightPx);
    this.shift(-dx * k, dy * k);
  }

  /**
   * Queue a zoom of `amount` (in powers of two, positive = closer) that keeps the point at
   * (ax, ay) fixed on screen; ax is in [-aspect, aspect], ay in [-1, 1], y up.
   */
  zoomAt(amount: number, ax: number, ay: number): void {
    this.zoomPending += amount;
    this.anchorX = ax;
    this.anchorY = ay;
  }

  /** Apply a zoom step at once (pinch gestures, which are already continuous). */
  zoomNow(amount: number, ax: number, ay: number): void {
    const target = Math.min(this.maxZoom, Math.max(MIN_ZOOM, this.zoom + amount));
    const dz = target - this.zoom;
    if (dz === 0) return;
    this.ensureBits(target);
    const k = 1 - Math.pow(2, -dz);
    this.shift(ax * k, ay * k);
    this.zoom = target;
    this.changed = true;
  }

  /** True while an eased zoom is still running. */
  get zooming(): boolean {
    return this.zoomPending !== 0;
  }

  /** Advance the eased zoom. Returns true if the view changed since the last call. */
  update(dt: number): boolean {
    if (Math.abs(this.zoomPending) > 1e-4) {
      const step = this.zoomPending * (1 - Math.exp(-dt * ZOOM_RESPONSE));
      this.zoomPending -= step;
      const before = this.zoom;
      this.zoomNow(step, this.anchorX, this.anchorY);
      if (this.zoom === before) this.zoomPending = 0; // hit a limit
    } else {
      this.zoomPending = 0;
    }
    const c = this.changed;
    this.changed = false;
    return c;
  }

  /** The centre as decimal strings with just enough digits for the current zoom. */
  centre(): { re: string; im: string } {
    const digits = Math.ceil(Math.max(0, this.zoom) * 0.30103) + 6;
    return { re: fxToDecimal(this.re, this.bits, digits), im: fxToDecimal(this.im, this.bits, digits) };
  }

  /** The centre as doubles (for the GPU tier and for landmark tests). */
  centreNumber(out: Float64Array): void {
    fxToFloatExp(this.re, this.bits, this.fe);
    out[0] = ldexp(this.fe[0], this.fe[1]);
    fxToFloatExp(this.im, this.bits, this.fe);
    out[1] = ldexp(this.fe[0], this.fe[1]);
  }

  snapshot(): Snapshot {
    return { re: this.re, im: this.im, bits: this.bits, zoom: this.zoom };
  }

  /** A string that changes whenever the view does. */
  signature(): string {
    return `${this.bits}:${this.re}:${this.im}:${this.zoom}`;
  }

  /**
   * Centre minus a point, as (mantissa re, mantissa im, shared exponent) in out[0..2].
   * Exact up to the 53 bits of the result.
   */
  offsetFrom(re: bigint, im: bigint, bits: number, out: Float64Array): void {
    const b = Math.max(bits, this.bits);
    const dr = fxRescale(this.re, this.bits, b) - fxRescale(re, bits, b);
    const di = fxRescale(this.im, this.bits, b) - fxRescale(im, bits, b);
    fxToFloatExp(dr, b, this.fe);
    const mr = this.fe[0];
    const er = this.fe[1];
    fxToFloatExp(di, b, this.fe);
    const e = Math.max(er, this.fe[1]);
    out[0] = ldexp(mr, er - e);
    out[1] = ldexp(this.fe[0], this.fe[1] - e);
    out[2] = e;
  }

  /**
   * Affine map from this view's screen (uv in [0,1]^2) to the screen of an earlier view:
   * uv' = uv * out[0..1] + out[2..3]. Used to keep showing the last finished image, moved
   * and scaled, while a new one renders.
   */
  relativeTo(snap: Snapshot, aspect: number, out: Float32Array): void {
    const r = Math.pow(2, Math.max(-60, Math.min(60, snap.zoom - this.zoom)));
    const off = new Float64Array(3);
    this.offsetFrom(snap.re, snap.im, snap.bits, off);
    // Offset in units of the snapshot's half height.
    const whole = Math.floor(snap.zoom);
    const halfM = BASE_HALF_HEIGHT * Math.pow(2, whole - snap.zoom);
    const k = ldexp(1, Math.max(-200, Math.min(200, off[2] + whole))) / halfM;
    const clamp = (v: number): number => Math.max(-1e6, Math.min(1e6, v));
    out[0] = r;
    out[1] = r;
    out[2] = 0.5 - 0.5 * r + clamp((off[0] * k) / (2 * aspect));
    out[3] = 0.5 - 0.5 * r + clamp((off[1] * k) / 2);
  }

  /**
   * Choose the reference orbit for rendering this view: reuse a candidate when it is
   * precise enough, long enough and close enough, otherwise describe a new one at the
   * centre, with headroom so that further zooming and panning can reuse it.
   */
  chooseReference(
    maxIter: number,
    heightPx: number,
    candidates: Array<{ spec: RefSpec; escaped: boolean | null }>,
  ): RefSpec {
    const need = this.neededBits();
    const extended = this.pixelExp(heightPx) < DEEP_EXP;
    const off = new Float64Array(3);
    for (const c of candidates) {
      const s = c.spec;
      if (s.bits < need - 32) continue;
      if (extended && !s.extended) continue;
      if (c.escaped !== true && s.maxIter < maxIter) continue;
      this.offsetFrom(s.re, s.im, s.bits, off);
      // Within 256 half-heights of the reference point (exponents compared, mantissas are below 2).
      const dist = off[0] === 0 && off[1] === 0 ? -Infinity : off[2] + Math.log2(Math.abs(off[0]) + Math.abs(off[1]));
      if (dist > 8 - this.zoom) continue;
      return s;
    }
    const bits = Math.ceil((need + 64) / 64) * 64;
    const re = fxRescale(this.re, this.bits, bits);
    const im = fxRescale(this.im, this.bits, bits);
    const budget = Math.ceil(maxIter * 1.5);
    // Deep references always carry the extended arrays once the view is near that depth.
    const ext = this.pixelExp(heightPx) < DEEP_EXP + 80;
    return { key: `${bits}:${re}:${im}:${budget}:${ext ? 1 : 0}`, re, im, bits, maxIter: budget, extended: ext };
  }
}
