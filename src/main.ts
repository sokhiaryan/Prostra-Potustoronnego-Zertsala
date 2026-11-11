// Application entry: wires state, camera, renderer and UI together and runs the frame loop.
import { FRACTALS, KIFS } from './app/fractals';
import { PALETTES } from './app/palettes';
import { PRESETS, homePreset } from './app/presets';
import { QUALITIES, applyPreset, createState } from './app/state';
import { Camera } from './camera/camera';
import type { DistFn } from './camera/camera';
import { attachInput } from './camera/input';
import { kifsRotation } from './math/de';
import { GpuError } from './render/gl';
import { Renderer } from './render/renderer';
import type { FrameParams } from './render/renderer';
import { buildPanel } from './ui/panel';
import './ui/style.css';

/** Frames stay in "moving" mode for this long after the last change, to avoid mode flicker. */
const SETTLE_MS = 120;
const FOG_PER_VIEW_SCALE = 0.07;
/** Loop bound of the distance estimators in de.glsl. */
const MAX_ITERATIONS = 24;

function showFatal(err: unknown): void {
  const box = document.getElementById('fatal');
  if (!box) return;
  const title = err instanceof GpuError ? err.title : 'Something went wrong';
  const message = err instanceof Error ? err.message : String(err);
  const detail = err instanceof GpuError ? err.detail : err instanceof Error ? (err.stack ?? '') : '';
  const card = document.createElement('div');
  card.className = 'fatal-card';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  card.append(h, p);
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail;
    card.append(pre);
  }
  box.replaceChildren(card);
  box.hidden = false;
  document.body.classList.add('ui-hidden');
  console.error(err);
}

function start(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;

  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    showFatal(err);
    return;
  }

  const state = createState();
  const cam = new Camera();

  // Reused every frame: effective (possibly animated) parameters and the uniform block.
  const eff = new Float32Array(4);
  const breathed = new Float32Array(4);
  const fp: FrameParams = {
    fractal: 0,
    params: eff,
    rot: new Float32Array(9),
    iter: 10,
    camPos: cam.posF32,
    camBasis: cam.basis,
    tanFov: cam.tanFov,
    bound: 2,
    minEps: 5e-7,
    stepScale: 0.8,
    maxSteps: 200,
    shadowSteps: 40,
    sunDir: new Float32Array(3),
    palette: PALETTES[0],
    palShift: 0,
    trapWeights: FRACTALS[0].trapWeights,
    fogDensity: 0,
    glow: 1,
    bloom: 0.6,
    exposure: 1,
  };

  let dirty = true;
  let running = true;
  let clock = 0;
  let breatheAmp = 0;
  let fogScale = 1;
  let trapOverride: [number, number, number, number] | null = null; // console/automation only

  /** Distance estimate for the fractal exactly as it is being drawn (used by the camera). */
  const dist: DistFn = (x, y, z) => FRACTALS[state.fractal].dist(eff, fp.rot, fp.iter, x, y, z);

  /** Derive per-frame values from the state. Returns true while the breathing blend is in motion. */
  const syncFrameParams = (dt: number): boolean => {
    const def = FRACTALS[state.fractal];
    const base = state.params[state.fractal];
    const ampTarget = state.breathing ? 1 : 0;
    let animating = state.breathing;
    if (breatheAmp !== ampTarget) {
      breatheAmp += (ampTarget - breatheAmp) * (1 - Math.exp(-dt * 3));
      if (Math.abs(ampTarget - breatheAmp) < 1e-3) breatheAmp = ampTarget;
      animating = true;
    }
    if (breatheAmp > 0) {
      clock += dt;
      def.breathe(base, clock, breathed);
      for (let i = 0; i < 4; i++) eff[i] = base[i] + (breathed[i] - base[i]) * breatheAmp;
    } else {
      for (let i = 0; i < 4; i++) eff[i] = base[i];
    }
    if (state.fractal === KIFS) kifsRotation(eff[1], eff[2], fp.rot);

    const q = QUALITIES[state.quality];
    const coord = def.coordScale(eff);
    fp.fractal = state.fractal;
    fp.bound = def.bound(eff);
    // Detail follows zoom: each time the view shrinks by the fractal's detail factor,
    // one more iteration is added, so deep dives keep resolving new structure.
    const depth = Math.log(Math.max(1, fp.bound / Math.max(fogScale, 1e-9))) / Math.log(def.detailBase(eff));
    fp.iter = Math.min(MAX_ITERATIONS, state.iters[state.fractal] + Math.floor(depth));
    fp.minEps = 6e-7 * coord;
    fp.stepScale = def.stepScale;
    fp.maxSteps = q.maxSteps;
    fp.shadowSteps = q.shadowSteps;
    fp.palette = PALETTES[state.palette];
    fp.palShift = state.palShift;
    fp.trapWeights = trapOverride ?? def.trapWeights;
    fp.glow = state.glow;
    fp.bloom = state.bloom;
    fp.exposure = state.exposure;
    const ce = Math.cos(state.sunEl);
    fp.sunDir[0] = ce * Math.sin(state.sunAz);
    fp.sunDir[1] = Math.sin(state.sunEl);
    fp.sunDir[2] = ce * Math.cos(state.sunAz);

    cam.minDist = 1e-3 * coord;
    cam.maxDist = fp.bound * 5;
    cam.sceneSize = fp.bound;
    cam.stepScale = def.stepScale;
    return animating;
  };

  const loadPreset = (index: number): void => {
    const preset = PRESETS[index];
    if (!preset) return;
    applyPreset(state, index, preset);
    cam.lookAt(preset.cam[0], preset.cam[1], preset.cam[2], preset.target[0], preset.target[1], preset.target[2]);
    fogScale = cam.viewScale();
    syncFrameParams(0);
    panel.refresh();
    dirty = true;
  };

  const screenshot = (): void => {
    renderer.capture((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const name = FRACTALS[state.fractal].name.toLowerCase().replace(/\s+/g, '-');
      a.href = URL.createObjectURL(blob);
      a.download = `zertsalo-${name}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };

  const setQuality = (index: number): void => {
    const q = QUALITIES[index];
    if (!q) return;
    state.quality = index;
    renderer.setQuality(q.dprCap, q.samples);
    panel.refresh();
    dirty = true;
  };

  const panel = buildPanel(uiRoot, state, {
    onChange: () => {
      dirty = true;
    },
    onPreset: loadPreset,
    onFractal: (i) => loadPreset(homePreset(i)),
    onQuality: setQuality,
    onScreenshot: screenshot,
  });

  attachInput(canvas, cam, dist, {
    toggleUi: () => panel.toggleHidden(),
    screenshot,
    preset: loadPreset,
    reset: () => loadPreset(state.preset),
    toggleBreathing: () => {
      state.breathing = !state.breathing;
      panel.refresh();
      dirty = true;
    },
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    showFatal(new GpuError('The GPU context was lost', 'The graphics driver reset the page. Reload to continue exploring.'));
  });

  setQuality(state.quality);
  loadPreset(0);

  let last = performance.now();
  let lastMove = last;
  let lastStats = 0;
  let fps = 60;

  const frame = (now: number): void => {
    if (!running) return;
    requestAnimationFrame(frame);
    const dtMs = Math.min(100, Math.max(0.1, now - last));
    last = now;
    const dt = dtMs / 1000;
    fps += (1000 / dtMs - fps) * 0.08;

    let moved = syncFrameParams(dt);
    if (cam.update(dt, dist)) moved = true;
    if (dirty) {
      moved = true;
      dirty = false;
    }
    // Fog follows the view scale so depth reads the same at every zoom; eased to hide pivot changes.
    const scaleTarget = cam.viewScale();
    if (Math.abs(scaleTarget - fogScale) > scaleTarget * 0.003) {
      fogScale += (scaleTarget - fogScale) * (1 - Math.exp(-dt * 6));
      moved = true;
    } else {
      fogScale = scaleTarget;
    }
    fp.fogDensity = (state.fog * FOG_PER_VIEW_SCALE) / Math.max(fogScale, 1e-9);

    if (moved) lastMove = now;
    const moving = now - lastMove < SETTLE_MS;

    try {
      renderer.render(fp, moving, dtMs);
    } catch (err) {
      running = false;
      showFatal(err);
      return;
    }

    if (now - lastStats > 300) {
      lastStats = now;
      const depth = fp.bound / Math.max(scaleTarget, 1e-9);
      const zoom = depth >= 100 ? depth.toFixed(0) : depth.toFixed(1);
      panel.setStats(
        moving
          ? `${fps.toFixed(0)} fps · ${(renderer.scale * 100).toFixed(0)}% resolution · zoom ${zoom}×`
          : renderer.converged
            ? `converged · ${renderer.sampleCap} samples · zoom ${zoom}×`
            : `refining ${renderer.samples}/${renderer.sampleCap} · zoom ${zoom}×`,
      );
    }
  };
  requestAnimationFrame(frame);

  // Small automation surface used by scripts/capture.mjs (and handy in the console).
  Object.assign(window, {
    __pz: {
      preset: loadPreset,
      quality: setQuality,
      hideUi: (hidden: boolean) => panel.setHidden(hidden),
      converged: () => renderer.converged,
      set: (patch: Record<string, number | boolean>) => {
        Object.assign(state, patch);
        panel.refresh();
        dirty = true;
      },
      look: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
        cam.lookAt(px, py, pz, tx, ty, tz);
        fogScale = cam.viewScale();
        dirty = true;
      },
      trap: (w: [number, number, number, number] | null) => {
        trapOverride = w;
        dirty = true;
      },
      param: (i: number, v: number) => {
        state.params[state.fractal][i] = v;
        panel.refresh();
        dirty = true;
      },
      info: () => ({
        gpu: renderer.caps.renderer,
        float32: renderer.caps.float32,
        timer: !!renderer.caps.timer,
        size: [renderer.width, renderer.height],
        scale: renderer.scale,
        gpuMs: renderer.gpuMs,
        fps,
        samples: renderer.samples,
        viewScale: cam.viewScale(),
        pos: Array.from(cam.pos),
        pivot: Array.from(cam.pivot),
      }),
    },
  });
}

start();
