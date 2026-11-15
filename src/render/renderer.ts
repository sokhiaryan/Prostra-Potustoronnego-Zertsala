// Frame pipeline:
//   scene (HDR, dynamic resolution) -> [accumulate when still | reproject when moving]
//   -> bloom chain -> composite.
// While anything moves, the scene is rendered once per frame at a resolution scale chosen
// to hold the frame budget, and (with smoothing on) blended with the reprojected previous
// frame. Once still, full-resolution jittered frames are averaged until the sample cap is
// reached, then rendering stops until the next change.
// Images computed on the CPU (the deep tiers) enter through the deep* methods and share
// the bloom and composite passes, so both kinds of picture get the same finish.
import type { Palette } from '../app/palettes';
import { Program, createContext, createProgram, createTarget, deleteTarget } from './gl';
import type { Caps, Target } from './gl';
import accumSrc from './shaders/accumulate.frag?raw';
import downSrc from './shaders/bloom_down.frag?raw';
import upSrc from './shaders/bloom_up.frag?raw';
import compositeSrc from './shaders/composite.frag?raw';
import mergeSrc from './shaders/deep_merge.frag?raw';
import mandelSrc from './shaders/mandel.frag?raw';
import deSrc from './shaders/de.glsl?raw';
import vertSrc from './shaders/fullscreen.vert?raw';
import sceneSrc from './shaders/scene.frag?raw';
import taaSrc from './shaders/taa.frag?raw';

/** Most motes the scene shader draws at once. */
export const MAX_MOTES = 8;

/** Everything the scene needs for one frame. One instance is reused; nothing is allocated per frame. */
export interface FrameParams {
  fractal: number;
  params: Float32Array; // 4
  rot: Float32Array; // 9, column-major
  iter: number;
  camPos: Float32Array; // 3
  /** The same position in doubles, for the frame-to-frame camera motion. */
  camPos64: Float64Array; // 3
  camBasis: Float32Array; // 9, column-major (right, up, forward)
  tanFov: number;
  bound: number;
  minEps: number;
  stepScale: number;
  maxSteps: number;
  shadowSteps: number;
  sunDir: Float32Array; // 3
  palette: Palette;
  palShift: number;
  trapWeights: readonly [number, number, number, number];
  fogDensity: number;
  glow: number;
  bloom: number;
  exposure: number;
  /** The 2D Mandelbrot view (used when `fractal` is FLAT_FRACTAL). */
  flat: { cx: number; cy: number; half: number; maxIter: number; density: number };
  /** Headlamp strength (0 = off) and the distance at which it has fallen to half. */
  lamp: number;
  lampRange: number;
  /** Uncollected motes, nearest first: xyz and glow radius, MAX_MOTES of them. */
  motes: Float32Array;
  moteCount: number;
  stars: number;
  /** Lens radius in world units for depth of field (still frames only; 0 = pinhole) and the focus distance. */
  aperture: number;
  focus: number;
  /** Blend moving frames over time. Ignored for the 2D view. */
  smooth: boolean;
}

/** Index of the 2D Mandelbrot set in the fractal list; it has its own scene shader. */
export const FLAT_FRACTAL = 3;

const BLOOM_LEVELS = 6;
const GPU_BUDGET_MS = 11; // leaves headroom inside a 16.7 ms frame
const MIN_SCALE = 0.35;
/** Share of each moving frame in the smoothed image; the rest is reprojected history. */
const TAA_BLEND = 0.1;
const TAA_JITTER_CYCLE = 16;
const FRACTAL_NAMES = ['Mandelbulb', 'Mandelbox', 'Kaleido Menger', 'Mandelbrot 2D'];

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

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly caps: Caps;
  width = 0;
  height = 0;
  /** Accumulated samples of the current still image. */
  samples = 0;
  sampleCap = 48;
  /** Current dynamic resolution scale used while moving. */
  scale = 0.75;
  /** Smoothed GPU time of a moving frame in ms (0 when no timer is available). */
  gpuMs = 0;

  private dprCap = 1.5;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly scenePrograms: (Program | null)[] = [null, null, null, null];
  private readonly accumProg: Program;
  private readonly downProg: Program;
  private readonly upProg: Program;
  private readonly compositeProg: Program;
  private readonly mergeProg: Program;
  private readonly taaProg: Program;
  // Camera of the frame held in accum[accumIdx], for reprojection.
  private histValid = false;
  private histFractal = -1;
  private readonly prevPos = new Float64Array(3);
  private readonly prevBasis = new Float32Array(9);
  private prevTanFov = 1;
  private jitterIdx = 0;
  private scene: Target | null = null;
  private accum: Target[] = [];
  private accumIdx = 0;
  private bloom: Target[] = [];

  private readonly query: WebGLQuery | null;
  private queryPending = false;
  private queryScale = 1;
  private slowFrames = 0;
  private fastFrames = 0;

  // State of the last presented image, so it can be re-composited for screenshots.
  private lastSrc: WebGLTexture | null = null;
  private lastUvX = 1;
  private lastUvY = 1;
  private lastBloom = 0;
  private lastExposure = 1;

  /** Incremented whenever the render targets are reallocated; CPU-rendered images are lost then. */
  epoch = 0;
  // CPU-rendered images: deep[front] is the last finished pass, the other one fills up.
  private deep: Target[] = [];
  private front = 0;
  private frontW = 0;
  private frontH = 0;
  private backW = 0;
  private backH = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const { gl, caps } = createContext(canvas);
    this.gl = gl;
    this.caps = caps;
    this.vao = gl.createVertexArray();
    this.accumProg = createProgram(gl, vertSrc, accumSrc, 'accumulate');
    this.downProg = createProgram(gl, vertSrc, downSrc, 'bloom downsample');
    this.upProg = createProgram(gl, vertSrc, upSrc, 'bloom upsample');
    this.compositeProg = createProgram(gl, vertSrc, compositeSrc, 'composite');
    this.mergeProg = createProgram(gl, vertSrc, mergeSrc, 'deep merge');
    this.taaProg = createProgram(gl, vertSrc, taaSrc, 'temporal smoothing');
    this.query = caps.timer ? gl.createQuery() : null;
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  setQuality(dprCap: number, sampleCap: number): void {
    this.dprCap = dprCap;
    this.sampleCap = sampleCap;
    this.samples = 0;
  }

  get converged(): boolean {
    return this.samples >= this.sampleCap;
  }

  /** Forget the previous frame, e.g. after the view jumps somewhere unrelated. */
  resetHistory(): void {
    this.histValid = false;
  }

  /** Compile the scene shader for a fractal on first use; throws GpuError on failure. */
  private sceneProgram(fractal: number): Program {
    let p = this.scenePrograms[fractal];
    if (!p) {
      const header = `#version 300 es\n#define FRACTAL ${fractal}\nprecision highp float;\nprecision highp int;\n`;
      p =
        fractal === FLAT_FRACTAL
          ? createProgram(this.gl, vertSrc, mandelSrc, FRACTAL_NAMES[fractal])
          : createProgram(this.gl, vertSrc, header + deSrc + sceneSrc, FRACTAL_NAMES[fractal] ?? 'scene');
      this.scenePrograms[fractal] = p;
    }
    return p;
  }

  /** Match the drawing buffer to the canvas' CSS size. Reallocates targets only when the size changes. */
  private resize(): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this.width && h === this.height && this.scene) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;

    if (this.scene) deleteTarget(gl, this.scene);
    for (const t of this.accum) deleteTarget(gl, t);
    for (const t of this.bloom) deleteTarget(gl, t);
    for (const t of this.deep) deleteTarget(gl, t);
    this.deep = [createTarget(gl, w, h, false, gl.LINEAR), createTarget(gl, w, h, false, gl.LINEAR)];
    this.frontW = this.frontH = this.backW = this.backH = 0;
    this.epoch++;
    this.scene = createTarget(gl, w, h, false, gl.LINEAR);
    this.accum = [
      createTarget(gl, w, h, this.caps.float32, gl.LINEAR),
      createTarget(gl, w, h, this.caps.float32, gl.LINEAR),
    ];
    this.bloom = [];
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.bloom.push(createTarget(gl, Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)), false, gl.LINEAR));
    }
    this.samples = 0;
    this.lastSrc = null;
    this.histValid = false;
  }

  /**
   * Render one frame. `moving` means the image changed since the last frame
   * (camera, parameters, animation). Returns false if nothing needed drawing.
   */
  render(fp: FrameParams, moving: boolean, dtMs: number): boolean {
    const gl = this.gl;
    this.pollTimer();
    this.resize();
    if (moving) this.samples = 0;
    else if (this.samples >= this.sampleCap) return false;
    const scene = this.scene;
    if (!scene) return false;

    const W = this.width;
    const H = this.height;
    if (moving) this.adaptFromFrameTime(dtMs);
    const sw = moving ? Math.max(16, Math.round(W * this.scale)) : W;
    const sh = moving ? Math.max(16, Math.round(H * this.scale)) : H;
    const timed = moving && this.beginTimer();

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // --- scene ---
    const sp = this.sceneProgram(fp.fractal);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, sw, sh);
    sp.use();
    const n = this.samples + 1;
    const smooth = moving && fp.smooth && fp.fractal !== FLAT_FRACTAL;
    if (fp.fractal !== this.histFractal) this.histValid = false;
    this.histFractal = fp.fractal;
    let jx = 0;
    let jy = 0;
    if (!moving) {
      jx = halton(n, 2) - 0.5;
      jy = halton(n, 3) - 0.5;
    } else if (smooth) {
      this.jitterIdx = (this.jitterIdx % TAA_JITTER_CYCLE) + 1;
      jx = halton(this.jitterIdx, 2) - 0.5;
      jy = halton(this.jitterIdx, 3) - 0.5;
    }
    gl.uniform2f(sp.loc('uRes'), sw, sh);
    gl.uniform2f(sp.loc('uJitter'), jx, jy);
    gl.uniform3fv(sp.loc('uCamPos'), fp.camPos);
    gl.uniformMatrix3fv(sp.loc('uCamBasis'), false, fp.camBasis);
    gl.uniform1f(sp.loc('uTanFov'), fp.tanFov);
    gl.uniform1f(sp.loc('uBound'), fp.bound);
    gl.uniform1f(sp.loc('uMinEps'), fp.minEps);
    gl.uniform1f(sp.loc('uStepScale'), fp.stepScale);
    gl.uniform1i(sp.loc('uMaxSteps'), fp.maxSteps);
    // Shadows get a shorter march while moving; the still image uses the full budget.
    gl.uniform1i(sp.loc('uShadowSteps'), moving ? Math.max(12, fp.shadowSteps >> 1) : fp.shadowSteps);
    gl.uniform3fv(sp.loc('uSunDir'), fp.sunDir);
    gl.uniform4fv(sp.loc('uP'), fp.params);
    gl.uniform1i(sp.loc('uIter'), fp.iter);
    gl.uniformMatrix3fv(sp.loc('uRot'), false, fp.rot);
    const pal = fp.palette;
    const st = pal.stops;
    gl.uniform3f(sp.loc('uPal0'), st[0][0], st[0][1], st[0][2]);
    gl.uniform3f(sp.loc('uPal1'), st[1][0], st[1][1], st[1][2]);
    gl.uniform3f(sp.loc('uPal2'), st[2][0], st[2][1], st[2][2]);
    gl.uniform3f(sp.loc('uPal3'), st[3][0], st[3][1], st[3][2]);
    gl.uniform1f(sp.loc('uPalShift'), fp.palShift);
    const tw = fp.trapWeights;
    gl.uniform4f(sp.loc('uTrapW'), tw[0], tw[1], tw[2], tw[3]);
    gl.uniform3f(sp.loc('uSkyTop'), pal.skyTop[0], pal.skyTop[1], pal.skyTop[2]);
    gl.uniform3f(sp.loc('uSkyHorizon'), pal.skyHorizon[0], pal.skyHorizon[1], pal.skyHorizon[2]);
    gl.uniform3f(sp.loc('uSunCol'), pal.sun[0], pal.sun[1], pal.sun[2]);
    gl.uniform3f(sp.loc('uGlowCol'), pal.glow[0], pal.glow[1], pal.glow[2]);
    gl.uniform1f(sp.loc('uFogDensity'), fp.fogDensity);
    gl.uniform1f(sp.loc('uGlow'), fp.glow);
    gl.uniform1f(sp.loc('uLamp'), fp.lamp);
    gl.uniform1f(sp.loc('uLampRange'), fp.lampRange);
    gl.uniform4fv(sp.loc('uMotes'), fp.motes);
    gl.uniform1i(sp.loc('uMoteCount'), Math.min(MAX_MOTES, fp.moteCount));
    gl.uniform1f(sp.loc('uStars'), fp.stars);
    // Depth of field needs many samples to resolve, so it is drawn only once the view is still.
    const lens = !moving && fp.aperture > 0;
    if (lens) {
      const lr = Math.sqrt(halton(n, 5));
      const la = halton(n, 7) * Math.PI * 2;
      gl.uniform2f(sp.loc('uLens'), lr * Math.cos(la), lr * Math.sin(la));
    }
    gl.uniform1f(sp.loc('uAperture'), lens ? fp.aperture : 0);
    gl.uniform1f(sp.loc('uFocus'), fp.focus);
    // 2D view; these locations are null (and the calls no-ops) in the 3D programs, and vice versa.
    gl.uniform2f(sp.loc('uCenter'), fp.flat.cx, fp.flat.cy);
    gl.uniform1f(sp.loc('uHalf'), fp.flat.half);
    gl.uniform1i(sp.loc('uMaxIter'), fp.flat.maxIter);
    gl.uniform1f(sp.loc('uDensity'), fp.flat.density);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- accumulate (still frames only) ---
    let src = scene.tex;
    if (!moving) {
      const prev = this.accum[this.accumIdx];
      const next = this.accum[1 - this.accumIdx];
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.viewport(0, 0, W, H);
      const ap = this.accumProg;
      ap.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(ap.loc('uCur'), 0);
      gl.uniform1i(ap.loc('uPrev'), 1);
      gl.uniform1f(ap.loc('uWeight'), 1 / n);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.accumIdx = 1 - this.accumIdx;
      this.samples = n;
      src = next.tex;
    } else if (smooth) {
      // --- reproject and blend (moving frames) ---
      const prev = this.accum[this.accumIdx];
      const next = this.accum[1 - this.accumIdx];
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.viewport(0, 0, W, H);
      const tp = this.taaProg;
      tp.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(tp.loc('uCur'), 0);
      gl.uniform1i(tp.loc('uHist'), 1);
      gl.uniform2f(tp.loc('uCurSize'), sw, sh);
      gl.uniform2f(tp.loc('uTexSize'), W, H);
      gl.uniform2f(tp.loc('uJitter'), jx, jy);
      gl.uniformMatrix3fv(tp.loc('uCamBasis'), false, fp.camBasis);
      gl.uniform1f(tp.loc('uTanFov'), fp.tanFov);
      gl.uniformMatrix3fv(tp.loc('uPrevBasis'), false, this.prevBasis);
      gl.uniform1f(tp.loc('uPrevTanFov'), this.prevTanFov);
      // The difference is taken in doubles: deep in a fractal it is far below float32's resolution of the positions.
      gl.uniform3f(
        tp.loc('uCamDelta'),
        fp.camPos64[0] - this.prevPos[0],
        fp.camPos64[1] - this.prevPos[1],
        fp.camPos64[2] - this.prevPos[2],
      );
      gl.uniform1f(tp.loc('uBlend'), this.histValid ? TAA_BLEND : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      this.accumIdx = 1 - this.accumIdx;
      src = next.tex;
    }
    // accum[accumIdx] now holds this frame (averaged or blended) unless smoothing is off.
    const full = !moving || smooth;
    this.histValid = full;
    this.prevPos.set(fp.camPos64);
    this.prevBasis.set(fp.camBasis);
    this.prevTanFov = fp.tanFov;

    this.lastSrc = src;
    this.lastUvX = full ? 1 : sw / W;
    this.lastUvY = full ? 1 : sh / H;
    this.lastBloom = fp.bloom;
    this.lastExposure = fp.exposure;

    this.bloomChain(src, full ? W : sw, full ? H : sh);
    this.composite();
    if (timed) this.endTimer();
    return true;
  }

  // --- CPU-rendered (deep) images ---

  /** True once a finished CPU pass is available to present. */
  get hasDeepImage(): boolean {
    return this.frontW > 0;
  }

  /** Drop the CPU images, e.g. when switching fractal. */
  deepReset(): void {
    this.frontW = this.frontH = this.backW = this.backH = 0;
  }

  /** Start receiving a pass of w x h pixels. */
  deepBegin(w: number, h: number): void {
    const gl = this.gl;
    const back = this.deep[1 - this.front];
    if (!back || w > back.w || h > back.h) {
      this.backW = this.backH = 0;
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, back.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.backW = w;
    this.backH = h;
  }

  /** Upload rows [y0, y0 + rows) of the pass in progress (linear RGBA floats, bottom row first). */
  deepBand(y0: number, rows: number, w: number, data: Float32Array): void {
    const gl = this.gl;
    const back = this.deep[1 - this.front];
    if (!back || w !== this.backW || y0 + rows > this.backH) return; // from before a resize
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, back.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, w, rows, gl.RGBA, gl.FLOAT, data);
  }

  /** The pass in progress is complete: it becomes the image that is shown. */
  deepSwap(): void {
    if (this.backW === 0) return;
    this.front = 1 - this.front;
    this.frontW = this.backW;
    this.frontH = this.backH;
    this.backW = this.backH = 0;
  }

  /**
   * Draw the CPU image through bloom and the composite. `xform` (uv scale xy, offset zw)
   * places the finished image when the view has moved since it was rendered; `showBack`
   * overlays the bands of the pass in progress.
   */
  presentDeep(xform: Float32Array | null, showBack: boolean, bloom: number, exposure: number): void {
    const gl = this.gl;
    this.resize();
    const scene = this.scene;
    if (!scene) return;
    const W = this.width;
    const H = this.height;
    this.samples = 0; // the GPU path starts a fresh accumulation when it takes over again
    this.histValid = false;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, W, H);
    const mp = this.mergeProg;
    mp.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.deep[this.front].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.deep[1 - this.front].tex);
    gl.uniform1i(mp.loc('uFront'), 0);
    gl.uniform1i(mp.loc('uBack'), 1);
    gl.uniform2f(mp.loc('uFrontScale'), this.frontW / W, this.frontH / H);
    gl.uniform2f(mp.loc('uFrontMax'), (this.frontW - 0.5) / W, (this.frontH - 0.5) / H);
    gl.uniform2f(mp.loc('uBackSize'), showBack ? this.backW : 0, showBack ? this.backH : 0);
    if (xform) gl.uniform4fv(mp.loc('uXform'), xform);
    else gl.uniform4f(mp.loc('uXform'), 1, 1, 0, 0);
    gl.uniform3f(mp.loc('uVoid'), 0.004, 0.005, 0.01);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);

    this.lastSrc = scene.tex;
    this.lastUvX = 1;
    this.lastUvY = 1;
    this.lastBloom = bloom;
    this.lastExposure = exposure;
    this.bloomChain(scene.tex, W, H);
    this.composite();
  }

  private bloomChain(src: WebGLTexture, usedW: number, usedH: number): void {
    const gl = this.gl;
    const W = this.width;
    const H = this.height;
    const dp = this.downProg;
    dp.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(dp.loc('uSrc'), 0);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const dst = this.bloom[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      if (i === 0) {
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.uniform2f(dp.loc('uTexel'), 1 / W, 1 / H);
        gl.uniform2f(dp.loc('uUvScale'), usedW / W, usedH / H);
        gl.uniform2f(dp.loc('uUvMax'), (usedW - 0.5) / W, (usedH - 0.5) / H);
        gl.uniform1f(dp.loc('uPrefilter'), 1);
      } else {
        const s = this.bloom[i - 1];
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform2f(dp.loc('uTexel'), 1 / s.w, 1 / s.h);
        gl.uniform2f(dp.loc('uUvScale'), 1, 1);
        gl.uniform2f(dp.loc('uUvMax'), 1, 1);
        gl.uniform1f(dp.loc('uPrefilter'), 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // Upsample back up the chain, adding each level onto the next larger one.
    const up = this.upProg;
    up.use();
    gl.uniform1i(up.loc('uSrc'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
      const s = this.bloom[i];
      const dst = this.bloom[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.uniform2f(up.loc('uTexel'), 1 / s.w, 1 / s.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  private composite(): void {
    const gl = this.gl;
    if (!this.lastSrc) return;
    const W = this.width;
    const H = this.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const cp = this.compositeProg;
    cp.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lastSrc);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloom[0].tex);
    gl.uniform1i(cp.loc('uScene'), 0);
    gl.uniform1i(cp.loc('uBloom'), 1);
    gl.uniform2f(cp.loc('uUvScale'), this.lastUvX, this.lastUvY);
    gl.uniform2f(cp.loc('uUvMax'), this.lastUvX - 0.5 / W, this.lastUvY - 0.5 / H);
    gl.uniform1f(cp.loc('uExposure'), this.lastExposure);
    gl.uniform1f(cp.loc('uBloomStrength'), this.lastBloom);
    gl.uniform1f(cp.loc('uBloomNorm'), 1 / BLOOM_LEVELS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Encode the image currently on screen as a PNG. */
  capture(done: (blob: Blob | null) => void): void {
    // The drawing buffer is not preserved between frames, so redraw the final pass
    // and read it back within the same task.
    this.gl.bindVertexArray(this.vao);
    this.gl.disable(this.gl.BLEND);
    this.composite();
    this.canvas.toBlob(done, 'image/png');
  }

  // --- dynamic resolution ---

  private beginTimer(): boolean {
    const t = this.caps.timer;
    if (!t || !this.query || this.queryPending) return false;
    this.gl.beginQuery(t.TIME_ELAPSED_EXT, this.query);
    this.queryScale = this.scale;
    return true;
  }

  private endTimer(): void {
    const t = this.caps.timer;
    if (!t) return;
    this.gl.endQuery(t.TIME_ELAPSED_EXT);
    this.queryPending = true;
  }

  /** Primary controller: measured GPU time of a moving frame drives the scale. */
  private pollTimer(): void {
    const gl = this.gl;
    const t = this.caps.timer;
    if (!t || !this.query || !this.queryPending) return;
    if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
    this.queryPending = false;
    const disjoint = gl.getParameter(t.GPU_DISJOINT_EXT) as boolean;
    const ms = (gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number) / 1e6;
    if (disjoint || !(ms > 0.02)) return;
    this.gpuMs = this.gpuMs > 0 ? this.gpuMs + (ms - this.gpuMs) * 0.3 : ms;
    // Cost is roughly proportional to pixel count, i.e. to scale squared.
    const desired = Math.min(1, Math.max(MIN_SCALE, this.queryScale * Math.sqrt(GPU_BUDGET_MS / ms)));
    if (Math.abs(desired - this.scale) > 0.04 * this.scale) this.scale += (desired - this.scale) * 0.5;
  }

  /** Fallback and safety net: react to frame intervals when GPU timing is missing or misleading. */
  private adaptFromFrameTime(dtMs: number): void {
    if (dtMs > 24) {
      this.fastFrames = 0;
      if (++this.slowFrames >= 6) {
        this.scale = Math.max(MIN_SCALE, this.scale * 0.9);
        this.slowFrames = 0;
      }
      return;
    }
    this.slowFrames = 0;
    if (this.caps.timer && this.gpuMs > 0) return; // the timer handles upscaling
    if (dtMs < 17.5 && ++this.fastFrames >= 40) {
      this.scale = Math.min(1, this.scale * 1.05);
      this.fastFrames = 0;
    }
  }
}
