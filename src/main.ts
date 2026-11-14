// Application entry: wires state, cameras, renderers, the game and its UI together and
// runs the frame loop.
//
// There are two renderers behind one picture. The GPU draws everything float32 can
// resolve, at 60 fps. Deeper than that (about a thousand times into a 3D shape, a few
// hundred times into the flat set) the same image is computed on worker threads in
// float64, or by perturbation with arbitrary precision for the flat set, and arrives
// in passes from coarse to fine.
import { FRACTALS, KIFS } from './app/fractals';
import { PALETTES } from './app/palettes';
import { PRESETS, homePreset } from './app/presets';
import { LOOK_DEFAULTS, QUALITIES, applyPreset, createState } from './app/state';
import { Camera } from './camera/camera';
import type { DistFn } from './camera/camera';
import { attachInput } from './camera/input';
import { DeepPool } from './deep/pool';
import type { Pass } from './deep/pool';
import type { Scene2D } from './deep/worker';
import { QUESTS, newlyDone } from './explore/quests';
import type { QuestContext } from './explore/quests';
import { LANDMARKS, mutateParams, pickLandmark, surpriseFractal, surpriseParams } from './explore/random';
import { MAX_BOOKMARKS, decodeView, encodeView, loadSaved, storeSaved } from './explore/store';
import type { ViewState } from './explore/store';
import { WORLDS, anyDeepMote, anyWorldComplete, totalMotes, worldsOpen } from './game/progress';
import { kifsRotation } from './math/de';
import { DEEP_EXP, mandelMaxIter } from './math/mandel';
import type { Scene3D } from './math/shade';
import { GpuError } from './render/gl';
import { MAX_MOTES, Renderer } from './render/renderer';
import type { FrameParams } from './render/renderer';
import { buildPanel } from './ui/panel';
import './ui/style.css';
import { View2D } from './view2d/view';
import type { Snapshot } from './view2d/view';

/** Frames stay in "moving" mode for this long after the last change, to avoid mode flicker. */
const SETTLE_MS = 120;
const FOG_PER_VIEW_SCALE = 0.07;
/** Loop bound of the distance estimators in de.glsl; the CPU renderer is not limited by it. */
const GPU_MAX_ITERATIONS = 24;
const CPU_MAX_ITERATIONS = 64;
/** Loop bound of mandel.frag. */
const GPU_MAX_MANDEL_ITER = 16384;

// Precision floors, as fractions of the fractal's coordinate scale.
const F32_MIN_EPS = 6e-7; // smallest surface threshold float32 can resolve
const F32_MIN_DIST = 1e-3; // closest view distance at which a pixel is still wider than that
const F64_MIN_EPS = 2e-13;
const F64_MIN_DIST = 4e-10;
/** The CPU takes over below F32_MIN_DIST and hands back above this (hysteresis). */
const F32_RETURN_DIST = 1.3e-3;
/** Smallest pixel spacing the float32 Mandelbrot shader draws cleanly, and where it takes back over. */
const F32_MIN_PIXEL = 4e-6;
const F32_RETURN_PIXEL = 5.2e-6;
/** Beyond the GPU's range by more than this factor its picture is noise, so nothing is shown instead. */
const GPU_PREVIEW_RANGE = 30;
/** The first CPU pass is sized to take about this long. */
const FIRST_PASS_MS = 110;

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** "12.5×", "3,400×", "2.1 × 10⁹×" from a base-10 logarithm. */
function formatZoom(log10: number): string {
  if (log10 < 2) return `${Math.pow(10, log10).toFixed(1)}×`;
  if (log10 < 6) return `${Math.round(Math.pow(10, log10)).toLocaleString('en-US')}×`;
  const exp = Math.floor(log10);
  const mant = Math.pow(10, log10 - exp);
  const sup = String(exp).replace(/\d/g, (d) => SUPERSCRIPT[Number(d)]);
  return `${mant.toFixed(1)} × 10${sup}×`;
}

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
  const view = new View2D();
  const saved = loadSaved();
  const isFlat = (): boolean => !!FRACTALS[state.fractal].flat;

  // Reused every frame: effective (possibly animated) parameters and the uniform block.
  const eff = new Float32Array(4);
  const breathed = new Float32Array(4);
  const fp: FrameParams = {
    fractal: 0,
    params: eff,
    rot: new Float32Array(9),
    iter: 10,
    camPos: cam.posF32,
    camPos64: cam.pos,
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
    flat: { cx: 0, cy: 0, half: 1.25, maxIter: 300, density: 1 },
    // Game-only terms; off until the free-fly mode drives them.
    lamp: 0,
    lampRange: 1,
    motes: new Float32Array(MAX_MOTES * 4),
    moteCount: 0,
    stars: 0,
    aperture: 0,
    focus: 1,
    smooth: saved.settings.smoothing,
  };

  let dirty = true;
  let running = true;
  let clock = 0;
  let breatheAmp = 0;
  let fogScale = 1;
  let trapOverride: [number, number, number, number] | null = null; // console/automation only
  /** Iteration count before the GPU's loop bound is applied; the CPU renderer uses this. */
  let iterWanted = 10;
  let flatMaxIter = 300;

  // --- deep (CPU) tier state ---
  let deep = false; // the CPU is responsible for the picture
  let forcedTier: 'gpu' | 'cpu' | null = null; // automation only
  let runningSig = ''; // what the pool is rendering, or last rendered
  let runSnap: Snapshot | null = null;
  let frontSnap: Snapshot | null = null; // 2D view of the finished image on screen
  let deepDone = false; // the final pass of runningSig has been delivered
  let deepPresent = true; // something changed that needs a re-composite
  let lookSig = '';
  let deepNotice = '';
  const xform = new Float32Array(4);
  const scratch = new Float64Array(3);

  let pool: DeepPool | null = null;
  try {
    pool = new DeepPool({
      begin: (_pass, w, h) => {
        renderer.deepBegin(w, h);
      },
      band: (y0, rows, w, data) => {
        renderer.deepBand(y0, rows, w, data);
        deepPresent = true;
      },
      passDone: (_pass, final) => {
        renderer.deepSwap();
        frontSnap = runSnap;
        deepDone = final;
        deepPresent = true;
      },
      failed: (message) => {
        pool = null;
        deepNotice = 'Deep zoom stopped: the render workers failed.';
        console.error(message);
      },
    });
  } catch {
    deepNotice = 'Deep zoom is unavailable: this browser cannot start render workers.';
  }

  /** Distance estimate for the fractal exactly as it is being drawn (used by the camera). */
  const dist: DistFn = (x, y, z) => FRACTALS[state.fractal].dist(eff, fp.rot, iterWanted, x, y, z);

  /** Derive per-frame values from the state. Returns true while an animation is in motion. */
  const syncFrameParams = (dt: number): boolean => {
    const def = FRACTALS[state.fractal];
    const base = state.params[state.fractal];
    // Breathing animates on the GPU only; a CPU image would never finish.
    const ampTarget = state.breathing && !deep ? 1 : 0;
    let animating = ampTarget === 1;
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

    const q = QUALITIES[state.quality];
    fp.fractal = state.fractal;
    fp.palette = PALETTES[state.palette];
    fp.palShift = state.palShift;
    fp.bloom = state.bloom;
    fp.exposure = state.exposure;

    if (def.flat) {
      // In the flat set "breathing" is a slow colour cycle.
      fp.palShift += Math.sin(clock * 0.35) * 0.35 * breatheAmp;
      flatMaxIter = mandelMaxIter(view.zoom, eff[0]);
      view.centreNumber(scratch);
      view.half(xformHalf);
      fp.flat.cx = scratch[0];
      fp.flat.cy = scratch[1];
      fp.flat.half = xformHalf[0] * Math.pow(2, Math.max(-126, xformHalf[1]));
      fp.flat.maxIter = Math.min(GPU_MAX_MANDEL_ITER, flatMaxIter);
      fp.flat.density = eff[1];
      return animating;
    }

    if (state.fractal === KIFS) kifsRotation(eff[1], eff[2], fp.rot);
    const coord = def.coordScale(eff);
    fp.bound = def.bound(eff);
    // Detail follows zoom: each time the view shrinks by the fractal's detail factor,
    // one more iteration is added, so deep dives keep resolving new structure.
    const depth = Math.log(Math.max(1, fp.bound / Math.max(fogScale, 1e-300))) / Math.log(def.detailBase(eff));
    iterWanted = Math.min(CPU_MAX_ITERATIONS, state.iters[state.fractal] + Math.floor(depth));
    fp.iter = Math.min(GPU_MAX_ITERATIONS, iterWanted);
    fp.minEps = F32_MIN_EPS * coord;
    fp.stepScale = def.stepScale;
    fp.maxSteps = q.maxSteps;
    fp.shadowSteps = q.shadowSteps;
    fp.trapWeights = trapOverride ?? def.trapWeights;
    fp.glow = state.glow;
    const ce = Math.cos(state.sunEl);
    fp.sunDir[0] = ce * Math.sin(state.sunAz);
    fp.sunDir[1] = Math.sin(state.sunEl);
    fp.sunDir[2] = ce * Math.cos(state.sunAz);

    // With workers the camera may go on down to the float64 floor; without, it stops where float32 does.
    cam.minDist = (pool ? F64_MIN_DIST : F32_MIN_DIST) * coord;
    cam.maxDist = fp.bound * 5;
    cam.sceneSize = fp.bound;
    cam.stepScale = def.stepScale;
    return animating;
  };
  const xformHalf = new Float64Array(2);

  /** Which renderer owns the picture this frame. */
  const chooseTier = (): boolean => {
    if (!pool) return false;
    if (forcedTier) return forcedTier === 'cpu';
    if (isFlat()) {
      const px = view.pixelExp(Math.max(1, renderer.height));
      return px < Math.log2(deep ? F32_RETURN_PIXEL : F32_MIN_PIXEL);
    }
    const coord = FRACTALS[state.fractal].coordScale(eff);
    const s = Math.min(cam.viewScale(), 3 * dist(cam.pos[0], cam.pos[1], cam.pos[2]));
    return s < (deep ? F32_RETURN_DIST : F32_MIN_DIST) * coord;
  };

  /** How far past the GPU's range the view is (1 = at its limit). */
  const beyondGpu = (): number => {
    if (isFlat()) return Math.pow(2, Math.min(1000, Math.log2(F32_MIN_PIXEL) - view.pixelExp(Math.max(1, renderer.height))));
    const coord = FRACTALS[state.fractal].coordScale(eff);
    return (F32_MIN_DIST * coord) / Math.max(cam.viewScale(), 1e-300);
  };

  const flatStops = (): number[] => PALETTES[state.palette].stops.flatMap((s) => [s[0], s[1], s[2]]);

  /** Everything that determines the CPU image (not bloom and exposure, which are applied afterwards). */
  const deepSignature = (): string => {
    const head = `${renderer.epoch}|${renderer.width}x${renderer.height}|${state.fractal}|${state.palette}|${fp.palShift}|${state.quality}`;
    if (isFlat()) return `${head}|${view.signature()}|${flatMaxIter}|${eff[1]}`;
    return (
      `${head}|${eff[0]},${eff[1]},${eff[2]},${eff[3]}|${iterWanted}|${cam.pos[0]},${cam.pos[1]},${cam.pos[2]}|` +
      `${cam.yaw},${cam.pitch}|${fp.sunDir[0]},${fp.sunDir[1]}|${fp.glow}|${fp.fogDensity}|${trapOverride ?? ''}`
    );
  };

  const buildPasses = (): Pass[] => {
    const q = QUALITIES[state.quality];
    const est = pool && pool.msPerSample > 0 ? pool.msPerSample : isFlat() ? 3e-4 : 4e-3;
    const want = Math.sqrt((renderer.width * renderer.height * est) / FIRST_PASS_MS);
    let step = 1;
    while (step < want && step < 16) step *= 2;
    const passes: Pass[] = [];
    for (let s = step; s >= 1; s /= 2) passes.push({ step: s, spp: 1 });
    if (q.deepSpp > 1) passes.push({ step: 1, spp: q.deepSpp });
    return passes;
  };

  const startDeep = (sig: string): void => {
    if (!pool || renderer.width < 2) return;
    const W = renderer.width;
    const H = renderer.height;
    const pal = PALETTES[state.palette];
    runningSig = sig;
    deepDone = false;
    if (isFlat()) {
      const spec = view.chooseReference(flatMaxIter, H, pool.references());
      view.offsetFrom(spec.re, spec.im, spec.bits, scratch);
      view.half(xformHalf);
      const scene: Scene2D = {
        kind: '2d',
        refId: 0,
        ref: null,
        offR: scratch[0],
        offI: scratch[1],
        offE: scratch[2],
        halfM: xformHalf[0],
        halfE: xformHalf[1],
        maxIter: flatMaxIter,
        deep: view.pixelExp(H) < DEEP_EXP,
        stops: flatStops(),
        palShift: fp.palShift,
        density: eff[1],
      };
      runSnap = view.snapshot();
      pool.start({ width: W, height: H, passes: buildPasses(), scene, refSpec: spec });
      return;
    }
    const q = QUALITIES[state.quality];
    const coord = FRACTALS[state.fractal].coordScale(eff);
    const scene: Scene3D = {
      kind: '3d',
      fractal: state.fractal,
      params: Array.from(eff),
      rot: Array.from(fp.rot),
      iter: iterWanted,
      camPos: Array.from(cam.pos),
      camBasis: Array.from(cam.basis),
      tanFov: cam.tanFov,
      bound: fp.bound,
      minEps: F64_MIN_EPS * coord,
      stepScale: fp.stepScale,
      // Workers are not bound by a frame budget, so they march further than the GPU does.
      maxSteps: q.maxSteps * 2,
      shadowSteps: q.shadowSteps,
      sunDir: Array.from(fp.sunDir),
      stops: flatStops(),
      palShift: fp.palShift,
      trapW: Array.from(fp.trapWeights),
      skyTop: Array.from(pal.skyTop),
      skyHorizon: Array.from(pal.skyHorizon),
      sunCol: Array.from(pal.sun),
      glowCol: Array.from(pal.glow),
      fogDensity: fp.fogDensity,
      glow: fp.glow,
    };
    runSnap = null;
    pool.start({ width: W, height: H, passes: buildPasses(), scene });
  };

  // --- views: presets, bookmarks, share links ---

  /** Forget CPU images that belong to another scene. */
  const resetDeep = (): void => {
    pool?.cancel();
    renderer.deepReset();
    runningSig = '';
    frontSnap = runSnap = null;
    deepDone = false;
    deep = false;
  };

  const loadPreset = (index: number): void => {
    const preset = PRESETS[index];
    if (!preset) return;
    resetDeep();
    applyPreset(state, index, preset);
    if (preset.view) view.set(preset.view.re, preset.view.im, preset.view.zoom);
    else cam.lookAt(preset.cam[0], preset.cam[1], preset.cam[2], preset.target[0], preset.target[1], preset.target[2]);
    fogScale = cam.viewScale();
    syncFrameParams(0);
    panel.refresh();
    dirty = true;
  };

  const currentView = (): ViewState => {
    const v: ViewState = {
      fractal: state.fractal,
      params: Array.from(state.params[state.fractal]),
      iter: state.iters[state.fractal],
      palette: state.palette,
      palShift: state.palShift,
      glow: state.glow,
      fog: state.fog,
      bloom: state.bloom,
      exposure: state.exposure,
      sunAz: state.sunAz,
      sunEl: state.sunEl,
    };
    if (isFlat()) {
      const c = view.centre();
      v.flat = { re: c.re, im: c.im, zoom: view.zoom };
    } else {
      // Aim point straight ahead at the pivot's distance, so the direction of view is kept exactly.
      const s = cam.viewScale();
      const b = cam.basis;
      v.cam = [cam.pos[0], cam.pos[1], cam.pos[2], cam.pos[0] + b[6] * s, cam.pos[1] + b[7] * s, cam.pos[2] + b[8] * s];
    }
    return v;
  };

  const applyView = (v: ViewState): boolean => {
    const def = FRACTALS[v.fractal];
    if (!def || (def.flat ? !v.flat : !v.cam)) return false;
    resetDeep();
    state.preset = -1;
    state.fractal = v.fractal;
    const p = state.params[v.fractal];
    for (let i = 0; i < 4; i++) {
      const d = def.params[i];
      p[i] = d ? Math.min(d.max, Math.max(d.min, v.params[i])) : 0;
    }
    state.iters[v.fractal] = Math.min(def.iter.max, Math.max(def.iter.min, v.iter));
    state.palette = v.palette;
    state.palShift = v.palShift;
    state.glow = v.glow;
    state.fog = v.fog;
    state.bloom = v.bloom;
    state.exposure = v.exposure;
    state.sunAz = v.sunAz;
    state.sunEl = v.sunEl;
    if (v.flat) view.set(v.flat.re, v.flat.im, v.flat.zoom);
    else if (v.cam) cam.lookAt(v.cam[0], v.cam[1], v.cam[2], v.cam[3], v.cam[4], v.cam[5]);
    fogScale = cam.viewScale();
    syncFrameParams(0);
    panel.refresh();
    dirty = true;
    return true;
  };

  const openCode = (code: string): boolean => {
    const v = decodeView(code, FRACTALS.length, PALETTES.length);
    return v ? applyView(v) : false;
  };

  // --- exploration: quests, bookmarks, surprise ---

  const events = new Set<string>();
  const fractalsSeen = new Set<number>();
  const palettesSeen = new Set<number>();
  const questsDone = new Set(saved.quests);
  let lastLandmark = -1;

  /** log10 of the magnification relative to the overview. */
  const depthLog10 = (): number =>
    isFlat() ? view.zoom * Math.LOG10E * Math.LN2 : Math.log10(fp.bound / Math.max(cam.viewScale(), 1e-300));

  const checkQuests = (): void => {
    fractalsSeen.add(state.fractal);
    palettesSeen.add(state.palette);
    view.centreNumber(scratch);
    const ctx: QuestContext = {
      fractal: state.fractal,
      params: state.params[state.fractal],
      depth: depthLog10(),
      cpu: deep,
      cx: scratch[0],
      cy: scratch[1],
      breathing: state.breathing,
      fractalsSeen: fractalsSeen.size,
      palettesSeen: palettesSeen.size,
      paletteCount: PALETTES.length,
      events,
      motes: totalMotes(saved.motes),
      worldComplete: anyWorldComplete(saved.motes),
      deepMote: anyDeepMote(saved.motes),
      worldsOpen: worldsOpen(saved.motes),
      worldCount: WORLDS.length,
    };
    const fresh = newlyDone(ctx, questsDone);
    if (fresh.length === 0) return;
    for (const q of fresh) {
      questsDone.add(q.id);
      saved.quests.push(q.id);
      panel.toast(`Discovered: ${q.title}`, q.reward);
    }
    storeSaved(saved);
    panel.refreshExplore();
    if (questsDone.size === QUESTS.length) panel.toast('Every discovery made', 'There is no end to the places, though.');
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
    events.add('png');
  };

  const setQuality = (index: number): void => {
    const q = QUALITIES[index];
    if (!q) return;
    state.quality = index;
    renderer.setQuality(q.dprCap, q.samples);
    panel.refresh();
    dirty = true;
  };

  const surprise = (): void => {
    events.add('surprise');
    if (isFlat()) {
      lastLandmark = pickLandmark(Math.random, lastLandmark);
      const lm = LANDMARKS[lastLandmark];
      resetDeep();
      state.preset = -1;
      view.set(lm.re, lm.im, lm.zoom);
      panel.toast(lm.name, 'Zoom in anywhere along the boundary.');
    } else {
      const f = surpriseFractal(state.fractal, Math.random);
      const home = PRESETS[homePreset(f)];
      resetDeep();
      state.preset = -1;
      state.fractal = f;
      surpriseParams(f, Math.random, state.params[f]);
      state.iters[f] = home.iter;
      state.palette = Math.floor(Math.random() * PALETTES.length) % PALETTES.length;
      state.palShift = Math.round((Math.random() - 0.5) * 100) / 100;
      Object.assign(state, LOOK_DEFAULTS);
      cam.lookAt(home.cam[0], home.cam[1], home.cam[2], home.target[0], home.target[1], home.target[2]);
      // Frame whatever came out: back off to just outside its bounding sphere.
      syncFrameParams(0);
      const r = Math.hypot(home.cam[0], home.cam[1], home.cam[2]);
      const k = (fp.bound * 2.1) / r;
      cam.lookAt(home.cam[0] * k, home.cam[1] * k, home.cam[2] * k, 0, 0, 0);
      fogScale = cam.viewScale();
    }
    syncFrameParams(0);
    panel.refresh();
    dirty = true;
  };

  const mutate = (): void => {
    if (isFlat()) return;
    events.add('mutate');
    state.preset = -1;
    mutateParams(state.fractal, Math.random, state.params[state.fractal]);
    panel.refresh();
    dirty = true;
  };

  // The panel's shown/hidden state and tab are no longer persisted; the menu replaces it.
  const savePrefs = (): void => {};

  const panel = buildPanel(uiRoot, state, saved, {
    onChange: () => {
      state.preset = state.preset; // parameters edited by hand keep the preset highlighted
      dirty = true;
    },
    onPreset: loadPreset,
    onFractal: (i) => loadPreset(homePreset(i)),
    onQuality: setQuality,
    onScreenshot: screenshot,
    onSurprise: surprise,
    onMutate: mutate,
    onBookmark: () => {
      if (saved.bookmarks.length >= MAX_BOOKMARKS) {
        panel.toast('Bookmarks are full', `Delete one first (${MAX_BOOKMARKS} at most).`);
        return;
      }
      const name = `${FRACTALS[state.fractal].name} · ${formatZoom(depthLog10())}`;
      saved.bookmarks.unshift({ name, code: encodeView(currentView()) });
      storeSaved(saved);
      events.add('bookmark');
      panel.refreshExplore();
      panel.toast('Bookmarked', name);
    },
    onOpenBookmark: (i) => {
      const b = saved.bookmarks[i];
      if (b && !openCode(b.code)) panel.toast('This bookmark cannot be opened', 'It may come from another version.');
    },
    onDeleteBookmark: (i) => {
      saved.bookmarks.splice(i, 1);
      storeSaved(saved);
      panel.refreshExplore();
    },
    onShare: () => {
      const code = encodeView(currentView());
      history.replaceState(null, '', `#${code}`);
      events.add('share');
      const done = (ok: boolean): void =>
        panel.toast(ok ? 'Link copied' : 'Link is in the address bar', 'It reopens this exact view.');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(location.href).then(() => done(true), () => done(false));
      else done(false);
    },
    onPrefs: savePrefs,
  });

  attachInput(canvas, { cam, view, dist, flat: isFlat }, {
    toggleUi: () => panel.toggleHidden(),
    screenshot,
    preset: loadPreset,
    reset: () => loadPreset(state.preset >= 0 ? state.preset : homePreset(state.fractal)),
    toggleBreathing: () => {
      state.breathing = !state.breathing;
      panel.refresh();
      dirty = true;
    },
    surprise,
    mutate,
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    pool?.cancel();
    showFatal(new GpuError('The GPU context was lost', 'The graphics driver reset the page. Reload to continue exploring.'));
  });
  window.addEventListener('hashchange', () => {
    if (location.hash.length > 1) openCode(location.hash);
  });

  setQuality(state.quality);
  if (!(location.hash.length > 1 && openCode(location.hash))) loadPreset(0);

  let last = performance.now();
  let lastMove = last;
  let lastStats = 0;
  let fps = 60;
  let noticeShown = '';

  const frame = (now: number): void => {
    if (!running) return;
    requestAnimationFrame(frame);
    const dtMs = Math.min(100, Math.max(0.1, now - last));
    last = now;
    const dt = dtMs / 1000;
    fps += (1000 / dtMs - fps) * 0.08;

    const flat = isFlat();
    let moved = syncFrameParams(dt);
    if (flat) {
      // Without workers the view stops where float32 does.
      view.maxZoom = pool ? Infinity : Math.log2((2 * 1.25) / (Math.max(1, renderer.height) * F32_MIN_PIXEL));
      if (cam.flyX !== 0 || cam.flyZ !== 0) view.panPixels(-cam.flyX * 700 * dt, cam.flyZ * 700 * dt, canvas.clientHeight);
      if (cam.flyY !== 0) view.zoomNow(cam.flyY * 2 * dt, 0, 0);
      if (view.update(dt)) moved = true;
      if (moved) syncFrameParams(0);
    } else {
      if (cam.update(dt, dist)) moved = true;
      // Fog follows the view scale so depth reads the same at every zoom; eased to hide pivot changes.
      const scaleTarget = cam.viewScale();
      if (Math.abs(scaleTarget - fogScale) > scaleTarget * 0.003) {
        fogScale += (scaleTarget - fogScale) * (1 - Math.exp(-dt * 6));
        moved = true;
      } else {
        fogScale = scaleTarget;
      }
      fp.fogDensity = (state.fog * FOG_PER_VIEW_SCALE) / Math.max(fogScale, 1e-300);
    }
    if (dirty) {
      moved = true;
      dirty = false;
    }
    if (moved) lastMove = now;
    const moving = now - lastMove < SETTLE_MS;

    const wasDeep = deep;
    deep = chooseTier();
    if (wasDeep && !deep) {
      pool?.cancel();
      runningSig = '';
    }
    if (deep && !wasDeep) deepPresent = true;

    try {
      if (!deep) {
        renderer.render(fp, moving, dtMs);
      } else if (pool) {
        const sig = deepSignature();
        if (sig !== runningSig) {
          // Latest wins, but a first pass that is already running is quick: let it land, then restart.
          const firstPass = pool.phase === 'render' && pool.pass === 0;
          if (!firstPass) startDeep(sig);
        }
        const look = `${state.bloom}|${state.exposure}`;
        if (look !== lookSig) {
          lookSig = look;
          deepPresent = true;
        }
        if (!renderer.hasDeepImage && beyondGpu() < GPU_PREVIEW_RANGE) {
          // Nothing from the CPU yet and the GPU is only just out of its depth: show its picture meanwhile.
          renderer.render(fp, true, dtMs);
        } else if (deepPresent || moved) {
          deepPresent = false;
          if (flat && frontSnap) view.relativeTo(frontSnap, renderer.width / Math.max(1, renderer.height), xform);
          renderer.presentDeep(flat && frontSnap ? xform : null, sig === runningSig, state.bloom, state.exposure);
        }
      }
    } catch (err) {
      running = false;
      pool?.cancel();
      showFatal(err);
      return;
    }

    if (deepNotice && deepNotice !== noticeShown) {
      noticeShown = deepNotice;
      panel.toast('Deep zoom', deepNotice);
    }

    if (now - lastStats > 250) {
      lastStats = now;
      const zoom = `zoom ${formatZoom(depthLog10())}`;
      if (deep && pool) {
        if (pool.phase === 'reference') {
          const k = pool.refProgress.toLocaleString('en-US');
          panel.setStats(`CPU · reference orbit, ${k} iterations · ${zoom}`, pool.refProgress / Math.max(1, pool.refTarget));
        } else if (pool.phase === 'render') {
          const pct = Math.round(pool.progress * 100);
          panel.setStats(
            `CPU ×${pool.size} · pass ${pool.pass + 1} of ${pool.passCount} · ${pct}% · ${zoom}`,
            (pool.pass + pool.progress) / Math.max(1, pool.passCount),
          );
        } else {
          panel.setStats(`CPU ×${pool.size} · finished · ${zoom}`, -1);
        }
      } else {
        panel.setStats(
          moving
            ? `${fps.toFixed(0)} fps · ${(renderer.scale * 100).toFixed(0)}% resolution · ${zoom}`
            : renderer.converged
              ? `converged · ${renderer.sampleCap} samples · ${zoom}`
              : `refining ${renderer.samples}/${renderer.sampleCap} · ${zoom}`,
          -1,
        );
      }
      if (flat) {
        const c = view.centre();
        const cut = (s: string): string => (s.length > 44 ? `${s.slice(0, 44)}… (${s.length - 2} digits)` : s);
        panel.setLocation(`re ${cut(c.re)}\nim ${cut(c.im)}`);
      }
      checkQuests();
    }
  };
  requestAnimationFrame(frame);

  // Small automation surface used by scripts/capture.mjs (and handy in the console).
  Object.assign(window, {
    __pz: {
      preset: loadPreset,
      quality: setQuality,
      hideUi: (hidden: boolean) => panel.setHidden(hidden),
      /** Hide every overlay, for clean screenshots. */
      clean: (on: boolean) => document.body.classList.toggle('capture', on),
      /** The image on screen is final: accumulated on the GPU, or the last CPU pass has landed. */
      converged: () => (deep ? deepDone && deepSignature() === runningSig && !deepPresent : renderer.converged),
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
      flat: (re: string, im: string, zoom: number) => {
        view.set(re, im, zoom);
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
      /** Force one renderer regardless of depth (null = automatic); used to compare the two. */
      tier: (t: 'gpu' | 'cpu' | null) => {
        forcedTier = t;
        dirty = true;
      },
      open: openCode,
      code: () => encodeView(currentView()),
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
        tier: deep ? 'cpu' : 'gpu',
        workers: pool ? pool.size : 0,
        phase: pool ? pool.phase : 'none',
        depth: depthLog10(),
        iter: iterWanted,
        flatIter: flatMaxIter,
        quests: saved.quests.length,
        bookmarks: saved.bookmarks.length,
      }),
    },
  });
}

start();
