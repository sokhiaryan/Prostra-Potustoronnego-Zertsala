// Worker pool for the deep (CPU, float64) renderers.
//
// An image is drawn as a series of passes, coarse to fine, each split into horizontal
// bands that idle workers pull from a queue. A new request cancels the old one: workers
// in the middle of a band are terminated and replaced, because a single band can take
// seconds at extreme depth and a stale image is worth nothing.
// For the 2D set the pool also owns the perturbation reference orbit, which is computed
// once on a worker and then handed to every worker that needs it.
import type { RefOrbit } from '../math/mandel';
import type { Scene3D } from '../math/shade';
import type { FromWorker, Scene, Scene2D, ToWorker } from './worker';

/** Identifies a reference orbit: the point, its precision and how far it was iterated. */
export interface RefSpec {
  key: string;
  re: bigint;
  im: bigint;
  bits: number;
  maxIter: number;
  extended: boolean;
}

export interface Pass {
  /** The pass renders at 1/step of the full resolution. */
  step: number;
  /** Samples per pixel. */
  spp: number;
}

export interface DeepRequest {
  width: number;
  height: number;
  passes: Pass[];
  scene: Scene3D | Scene2D;
  /** Required for 2D scenes: the reference orbit the scene's offsets are relative to. */
  refSpec?: RefSpec;
}

export interface DeepSink {
  begin(pass: number, w: number, h: number): void;
  band(y0: number, rows: number, w: number, data: Float32Array): void;
  passDone(pass: number, final: boolean): void;
  failed(message: string): void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  sceneGen: number;
  refId: number;
}

export type Phase = 'idle' | 'reference' | 'render';

export class DeepPool {
  readonly size: number;
  phase: Phase = 'idle';
  /** Index of the pass being rendered and the number of passes in the request. */
  pass = 0;
  passCount = 0;
  /** Iterations done so far while a reference orbit is being computed. */
  refProgress = 0;
  /** Measured cost of the last finished pass, in milliseconds per pixel sample; 0 until known. */
  msPerSample = 0;

  private readonly slots: Slot[] = [];
  private gen = 0;
  private req: DeepRequest | null = null;
  private queue: number[] = [];
  private rowsPer = 1;
  private total = 0;
  private pending = 0;
  private passW = 0;
  private passH = 0;
  private passStart = 0;
  private held: { spec: RefSpec; orbit: RefOrbit; id: number } | null = null;
  private refPending: RefSpec | null = null;
  private refSeq = 0;
  private broken = false;

  constructor(private readonly sink: DeepSink) {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.size = Math.max(1, Math.min(12, cores - 1));
    for (let i = 0; i < this.size; i++) this.slots.push(this.spawn(i));
  }

  private spawn(index: number): Slot {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const slot: Slot = { worker, busy: false, sceneGen: -1, refId: -1 };
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(index, slot, e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      if (this.broken) return;
      this.broken = true;
      this.cancel();
      this.sink.failed(e.message || 'A render worker stopped unexpectedly.');
    };
    return slot;
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** Fraction of the current pass that has been delivered. */
  get progress(): number {
    return this.total > 0 ? 1 - this.pending / this.total : 0;
  }

  /** Reference orbits a new request could reuse: the one held and the one being computed. */
  references(): Array<{ spec: RefSpec; escaped: boolean | null }> {
    const out: Array<{ spec: RefSpec; escaped: boolean | null }> = [];
    if (this.refPending) out.push({ spec: this.refPending, escaped: null });
    if (this.held) out.push({ spec: this.held.spec, escaped: this.held.orbit.escaped });
    return out;
  }

  /** Iteration budget of the reference being computed (for progress display). */
  get refTarget(): number {
    return this.refPending ? this.refPending.maxIter : 0;
  }

  /** Begin rendering a request, replacing whatever was in progress. */
  start(req: DeepRequest): void {
    if (this.broken) return;
    const spec = req.refSpec;
    if (this.phase === 'reference' && spec && this.refPending && this.refPending.key === spec.key) {
      // Same reference still in flight: keep computing, render the newer view afterwards.
      this.req = req;
      this.passCount = req.passes.length;
      return;
    }
    this.cancel();
    this.gen++;
    this.req = req;
    this.pass = 0;
    this.passCount = req.passes.length;
    if (spec && (!this.held || this.held.spec.key !== spec.key)) {
      this.phase = 'reference';
      this.refPending = spec;
      this.refProgress = 0;
      const slot = this.slots[0];
      slot.busy = true;
      this.post(slot, {
        type: 'ref',
        gen: this.gen,
        re: spec.re,
        im: spec.im,
        bits: spec.bits,
        maxIter: spec.maxIter,
        extended: spec.extended,
      });
    } else {
      this.beginPass(0);
    }
  }

  /** Stop all work. Workers that are mid-task are replaced. */
  cancel(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.busy) continue;
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
      if (!this.broken) this.slots[i] = this.spawn(i);
    }
    this.queue = [];
    this.pending = 0;
    this.total = 0;
    this.phase = 'idle';
    this.refPending = null;
    this.req = null;
  }

  private post(slot: Slot, msg: ToWorker): void {
    slot.worker.postMessage(msg);
  }

  private beginPass(index: number): void {
    const req = this.req;
    if (!req) return;
    const p = req.passes[index];
    this.phase = 'render';
    this.pass = index;
    const w = Math.max(1, Math.ceil(req.width / p.step));
    const h = Math.max(1, Math.ceil(req.height / p.step));
    this.passW = w;
    this.passH = h;
    this.rowsPer = Math.max(1, Math.min(48, Math.ceil(h / (this.size * 8))));
    const bands: number[] = [];
    for (let y = 0; y < h; y += this.rowsPer) bands.push(y);
    // Centre first: the middle of the picture is where the eye is.
    const mid = h / 2;
    bands.sort((a, b) => Math.abs(b + this.rowsPer / 2 - mid) - Math.abs(a + this.rowsPer / 2 - mid));
    this.queue = bands; // served from the end
    this.total = this.pending = bands.length;
    this.passStart = performance.now();
    this.sink.begin(index, w, h);
    for (const slot of this.slots) this.feed(slot);
  }

  private feed(slot: Slot): void {
    const req = this.req;
    if (!req || slot.busy || this.queue.length === 0) return;
    if (slot.sceneGen !== this.gen) {
      let scene: Scene = req.scene;
      if (scene.kind === '2d') {
        const held = this.held;
        if (!held) return;
        scene = { ...scene, refId: held.id, ref: slot.refId === held.id ? null : held.orbit };
        slot.refId = held.id;
      }
      this.post(slot, { type: 'scene', gen: this.gen, scene });
      slot.sceneGen = this.gen;
    }
    const y0 = this.queue.pop() as number;
    const p = req.passes[this.pass];
    slot.busy = true;
    this.post(slot, {
      type: 'band',
      gen: this.gen,
      y0,
      rows: Math.min(this.rowsPer, this.passH - y0),
      w: this.passW,
      h: this.passH,
      spp: p.spp,
    });
  }

  private receive(index: number, slot: Slot, msg: FromWorker): void {
    if (this.slots[index] !== slot || msg.gen !== this.gen) return;
    if (msg.type === 'progress') {
      this.refProgress = msg.done;
      return;
    }
    slot.busy = false;
    if (msg.type === 'ref') {
      if (!this.refPending) return;
      this.held = { spec: this.refPending, orbit: msg.ref, id: ++this.refSeq };
      this.refPending = null;
      // Scenes are per generation, and this generation's scene may have been replaced while waiting.
      this.gen++;
      this.beginPass(0);
      return;
    }
    const req = this.req;
    if (!req || this.phase !== 'render') return;
    this.sink.band(msg.y0, msg.rows, msg.w, msg.data);
    this.pending--;
    if (this.pending > 0) {
      this.feed(slot);
      return;
    }
    const p = req.passes[this.pass];
    const ms = performance.now() - this.passStart;
    this.msPerSample = ms / (this.passW * this.passH * p.spp);
    const final = this.pass === req.passes.length - 1;
    const done = this.pass;
    if (final) {
      this.phase = 'idle';
      this.total = this.pending = 0;
    }
    this.sink.passDone(done, final);
    // The sink may have started a new request from passDone; only continue our own.
    if (!final && this.req === req && this.phase === 'render' && this.pass === done) this.beginPass(done + 1);
  }
}
