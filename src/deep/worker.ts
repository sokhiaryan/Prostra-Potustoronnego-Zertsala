// Render worker: draws horizontal bands of the image on the CPU in float64.
// It serves both deep tiers, the 3D scene (src/math/shade.ts) and the 2D Mandelbrot set
// by perturbation (src/math/mandel.ts), and computes reference orbits. The pool in
// pool.ts owns the protocol; a worker holds no state beyond the current scene.
import { paletteAt } from '../app/palettes';
import { ldexp, pow2 } from '../math/bigfixed';
import { MANDEL_COLOR_RATE, computeReference, iterateDeep, iteratePlain } from '../math/mandel';
import type { RefOrbit } from '../math/mandel';
import { SceneShader } from '../math/shade';
import type { Scene3D } from '../math/shade';

export interface Scene2D {
  kind: '2d';
  refId: number;
  /** Attached only when the receiving worker does not hold reference `refId` yet. */
  ref: RefOrbit | null;
  /** View centre minus the reference point: (offR + i offI) * 2^offE. */
  offR: number;
  offI: number;
  offE: number;
  /** Half the view height: halfM * 2^halfE. */
  halfM: number;
  halfE: number;
  maxIter: number;
  /** Pixel offsets are below the double range; use the extended-exponent iteration. */
  deep: boolean;
  stops: number[];
  palShift: number;
  density: number;
}

export type Scene = Scene3D | Scene2D;

export type ToWorker =
  | { type: 'scene'; gen: number; scene: Scene }
  | { type: 'band'; gen: number; y0: number; rows: number; w: number; h: number; spp: number }
  | { type: 'ref'; gen: number; re: bigint; im: bigint; bits: number; maxIter: number; extended: boolean };

export type FromWorker =
  | { type: 'band'; gen: number; y0: number; rows: number; w: number; data: Float32Array }
  | { type: 'ref'; gen: number; ref: RefOrbit }
  | { type: 'progress'; gen: number; done: number };

const ctx = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const shader = new SceneShader();
let scene: Scene | null = null;
let ref: RefOrbit | null = null;
let refId = -1;
const rgb = new Float32Array(3);
const col = new Float64Array(3);

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** Sub-pixel sample positions in [0, 1): the centre for one sample, a Halton set otherwise. */
function sampleOffsets(spp: number): Float64Array {
  const o = new Float64Array(spp * 2);
  if (spp === 1) {
    o[0] = o[1] = 0.5;
  } else {
    for (let i = 0; i < spp; i++) {
      o[i * 2] = halton(i + 1, 2);
      o[i * 2 + 1] = halton(i + 1, 3);
    }
  }
  return o;
}

function band3d(y0: number, rows: number, w: number, h: number, spp: number, data: Float32Array): void {
  const offs = sampleOffsets(spp);
  let o = 0;
  for (let y = y0; y < y0 + rows; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < spp; s++) {
        shader.pixel(x + offs[s * 2], y + offs[s * 2 + 1], w, h, rgb, 0);
        r += rgb[0];
        g += rgb[1];
        b += rgb[2];
      }
      data[o] = r / spp;
      data[o + 1] = g / spp;
      data[o + 2] = b / spp;
      data[o + 3] = 1;
      o += 4;
    }
  }
}

function band2d(sc: Scene2D, orbit: RefOrbit, y0: number, rows: number, w: number, h: number, spp: number, data: Float32Array): void {
  const offs = sampleOffsets(spp);
  // Pixel pitch in units of the half height, then everything on one exponent.
  const pitch = (2 / h) * sc.halfM;
  const e = Math.max(sc.offE, sc.halfE);
  const so = pow2(sc.offE - e);
  const sp = pow2(sc.halfE - e);
  const baseR = sc.offR * so;
  const baseI = sc.offI * so;
  const scale = sc.deep ? 1 : ldexp(1, e);
  const rate = MANDEL_COLOR_RATE * sc.density;
  let o = 0;
  for (let y = y0; y < y0 + rows; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < spp; s++) {
        const dcr = baseR + (x + offs[s * 2] - w / 2) * pitch * sp;
        const dci = baseI + (y + offs[s * 2 + 1] - h / 2) * pitch * sp;
        const nu = sc.deep
          ? iterateDeep(orbit, dcr, dci, e, sc.maxIter)
          : iteratePlain(orbit, dcr * scale, dci * scale, sc.maxIter);
        if (nu >= 0) {
          paletteAt(sc.stops, Math.sqrt(nu) * rate + sc.palShift, col);
          r += col[0];
          g += col[1];
          b += col[2];
        }
      }
      data[o] = r / spp;
      data[o + 1] = g / spp;
      data[o + 2] = b / spp;
      data[o + 3] = 1;
      o += 4;
    }
  }
}

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'scene') {
    scene = msg.scene;
    if (scene.kind === '3d') {
      shader.setScene(scene);
    } else if (scene.ref) {
      ref = scene.ref;
      refId = scene.refId;
      scene.ref = null;
    }
    return;
  }
  if (msg.type === 'ref') {
    const gen = msg.gen;
    const orbit = computeReference(msg.re, msg.im, msg.bits, msg.maxIter, msg.extended, (done) =>
      ctx.postMessage({ type: 'progress', gen, done }),
    );
    // Structured clone copies the arrays; the reference is small next to the image work.
    ctx.postMessage({ type: 'ref', gen, ref: orbit });
    return;
  }
  const data = new Float32Array(msg.rows * msg.w * 4);
  if (scene) {
    if (scene.kind === '3d') band3d(msg.y0, msg.rows, msg.w, msg.h, msg.spp, data);
    else if (ref && refId === scene.refId) band2d(scene, ref, msg.y0, msg.rows, msg.w, msg.h, msg.spp, data);
  }
  ctx.postMessage({ type: 'band', gen: msg.gen, y0: msg.y0, rows: msg.rows, w: msg.w, data }, [data.buffer]);
};
