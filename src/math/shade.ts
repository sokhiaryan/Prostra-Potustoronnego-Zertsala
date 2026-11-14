// Float64 mirror of src/render/shaders/scene.frag.
//
// The GPU marches in float32, which runs out of digits about a thousand times into a
// fractal. Past that point the same image is computed here, on worker threads, in
// doubles: slower, but good for roughly another six orders of magnitude. The two
// implementations must stay in step line for line (constants included) so the picture
// does not change when the renderer hands over; tests/shade.test.ts and the capture
// script compare them.
import { FRACTALS } from '../app/fractals';
import type { FractalDef } from '../app/fractals';
import { paletteAt } from '../app/palettes';

/** Everything a worker needs to draw the 3D scene. Plain arrays so it survives structured cloning. */
export interface Scene3D {
  kind: '3d';
  fractal: number;
  params: number[];
  rot: number[];
  iter: number;
  camPos: number[];
  camBasis: number[]; // column-major (right, up, forward)
  tanFov: number;
  bound: number;
  minEps: number;
  stepScale: number;
  maxSteps: number;
  shadowSteps: number;
  sunDir: number[];
  stops: number[]; // 12: four palette stops
  palShift: number;
  trapW: number[];
  skyTop: number[];
  skyHorizon: number[];
  sunCol: number[];
  glowCol: number[];
  fogDensity: number;
  glow: number;
}

const SUN_INTENSITY = 4.6;
const RIM_INTENSITY = 0.85;
const ROUGHNESS = 0.24;
const METALNESS = 0.2;
const HIT_PIXELS = 0.6;
const MAX_RADIANCE = 48;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export class SceneShader {
  private s!: Scene3D;
  private def!: FractalDef;
  private readonly trap = new Float64Array(4);
  private readonly sky = new Float64Array(3);
  private readonly lit = new Float64Array(3);
  private readonly albedo = new Float64Array(3);
  private readonly inner = new Float64Array(3);
  private readonly f0 = new Float64Array(3);
  private readonly n = new Float64Array(3);
  private readonly rim = new Float64Array(3);

  setScene(scene: Scene3D): void {
    this.s = scene;
    this.def = FRACTALS[scene.fractal];
    const sd = scene.sunDir;
    const len = Math.hypot(sd[0], 0.3, sd[2]);
    this.rim[0] = -sd[0] / len;
    this.rim[1] = 0.3 / len;
    this.rim[2] = -sd[2] / len;
  }

  private dist(x: number, y: number, z: number): number {
    const s = this.s;
    return this.def.dist(s.params, s.rot, s.iter, x, y, z);
  }

  /** Sky without the sun disc, into this.sky. */
  private skyBase(dx: number, dy: number, dz: number): void {
    const s = this.s;
    const h = clamp01(dy * 0.5 + 0.5);
    const a = smoothstep(0.45, 1, h);
    const b = smoothstep(0.5, 0.05, h);
    const sun = Math.max(dx * s.sunDir[0] + dy * s.sunDir[1] + dz * s.sunDir[2], 0);
    const g = 0.07 * Math.pow(sun, 5) + 0.3 * Math.pow(sun, 40);
    for (let i = 0; i < 3; i++) {
      let c = s.skyHorizon[i] + (s.skyTop[i] - s.skyHorizon[i]) * a;
      c += (s.skyHorizon[i] * 0.22 - c) * b;
      this.sky[i] = c + s.sunCol[i] * g;
    }
  }

  /** Far intersection of a ray with the bounding sphere, or -1. `near` receives the entry distance. */
  private sphereFar(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const r = this.s.bound;
    const b = ox * dx + oy * dy + oz * dz;
    const c = ox * ox + oy * oy + oz * oz - r * r;
    const h = b * b - c;
    if (h < 0) {
      this.near = 1;
      return -1;
    }
    const q = Math.sqrt(h);
    this.near = -b - q;
    return -b + q;
  }
  private near = 0;

  private softShadow(ox: number, oy: number, oz: number, eps: number): number {
    const s = this.s;
    const dx = s.sunDir[0];
    const dy = s.sunDir[1];
    const dz = s.sunDir[2];
    const tmax = this.sphereFar(ox, oy, oz, dx, dy, dz);
    if (tmax <= 0) return 1;
    let res = 1;
    let t = eps * 2;
    let ph = 1e20;
    for (let i = 0; i < s.shadowSteps; i++) {
      const h = this.dist(ox + dx * t, oy + dy * t, oz + dz * t);
      if (h < eps * 0.5) return 0;
      const y = (h * h) / (2 * ph);
      const d = Math.sqrt(Math.max(h * h - y * y, 0));
      res = Math.min(res, (14 * d) / Math.max(t - y, 1e-300));
      ph = h;
      t += Math.max(h * s.stepScale, t * 0.02 + eps);
      if (t > tmax) break;
    }
    res = clamp01(res);
    return res * res * (3 - 2 * res);
  }

  private ao(px: number, py: number, pz: number, t: number, eps: number): number {
    const n = this.n;
    let occ = 0;
    let wsum = 0;
    let w = 1;
    const hmax = Math.max(0.09 * t, eps * 10);
    for (let i = 1; i <= 5; i++) {
      const h = (hmax * (i * i)) / 25 + eps;
      const d = this.dist(px + n[0] * h, py + n[1] * h, pz + n[2] * h);
      occ += clamp01(1 - d / h) * w;
      wsum += w;
      w *= 0.8;
    }
    const a = clamp01(1 - (1.35 * occ) / wsum);
    return a * Math.sqrt(a);
  }

  /** Cook-Torrance + Lambert times n.l, scaled by (light colour * k), added to this.lit. */
  private addBrdf(vx: number, vy: number, vz: number, lx: number, ly: number, lz: number, light: ArrayLike<number>, k: number): void {
    const n = this.n;
    const nl = Math.max(n[0] * lx + n[1] * ly + n[2] * lz, 0);
    if (nl <= 0 || k === 0) return;
    let hx = lx + vx;
    let hy = ly + vy;
    let hz = lz + vz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    hx /= hl;
    hy /= hl;
    hz /= hl;
    const nv = Math.max(n[0] * vx + n[1] * vy + n[2] * vz, 1e-3);
    const nh = Math.max(n[0] * hx + n[1] * hy + n[2] * hz, 0);
    const vh = Math.max(vx * hx + vy * hy + vz * hz, 0);
    const a = ROUGHNESS * ROUGHNESS;
    const a2 = a * a;
    const dn = nh * nh * (a2 - 1) + 1;
    const D = a2 / (Math.PI * dn * dn);
    const kk = ((ROUGHNESS + 1) * (ROUGHNESS + 1)) / 8;
    const G = (nl / (nl * (1 - kk) + kk)) * (nv / (nv * (1 - kk) + kk));
    const fw = Math.pow(1 - vh, 5);
    const sp = (D * G) / (4 * nl * nv + 1e-4);
    for (let i = 0; i < 3; i++) {
      const F = this.f0[i] + (1 - this.f0[i]) * fw;
      const kd = (1 - F) * (1 - METALNESS);
      this.lit[i] += ((kd * this.albedo[i]) / Math.PI + sp * F) * nl * light[i] * k;
    }
  }

  /**
   * Radiance of the pixel whose centre is at fragment coordinates (fx, fy) in a w x h image
   * (same convention as gl_FragCoord plus jitter). Writes linear RGB to out[o .. o+2].
   */
  pixel(fx: number, fy: number, w: number, h: number, out: Float32Array, o: number): void {
    const s = this.s;
    const b = s.camBasis;
    const ax = ((2 * fx - w) / h) * s.tanFov;
    const ay = ((2 * fy - h) / h) * s.tanFov;
    let dx = b[0] * ax + b[3] * ay + b[6];
    let dy = b[1] * ax + b[4] * ay + b[7];
    let dz = b[2] * ax + b[5] * ay + b[8];
    const inv = 1 / Math.hypot(dx, dy, dz);
    dx *= inv;
    dy *= inv;
    dz *= inv;
    const ox = s.camPos[0];
    const oy = s.camPos[1];
    const oz = s.camPos[2];
    const pix = (2 * s.tanFov) / h;

    const far = this.sphereFar(ox, oy, oz, dx, dy, dz);
    let t = Math.max(this.near, 0);
    let d = 1e9;
    let eps = s.minEps;
    let minAng = 1e9;
    let hit = false;
    const trap = this.trap;
    if (far > 0) {
      for (let i = 0; i < s.maxSteps; i++) {
        d = this.def.trap(s.params, s.rot, s.iter, ox + dx * t, oy + dy * t, oz + dz * t, trap);
        eps = Math.max(pix * t * HIT_PIXELS, s.minEps);
        if (d < eps) {
          hit = true;
          break;
        }
        minAng = Math.min(minAng, d / Math.max(t, 1e-300));
        t += d * s.stepScale;
        if (t > far) break;
      }
      if (!hit && t <= far && d < eps * 8) hit = true;
    }

    let r: number;
    let g: number;
    let bl: number;
    if (hit) {
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      // Tetrahedral normal at the pixel footprint.
      const nh = Math.max(eps, s.minEps * 5);
      const d1 = this.dist(px + nh, py - nh, pz - nh);
      const d2 = this.dist(px - nh, py - nh, pz + nh);
      const d3 = this.dist(px - nh, py + nh, pz - nh);
      const d4 = this.dist(px + nh, py + nh, pz + nh);
      const n = this.n;
      n[0] = d1 - d2 - d3 + d4;
      n[1] = -d1 - d2 + d3 + d4;
      n[2] = -d1 + d2 - d3 + d4;
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      n[0] /= nl;
      n[1] /= nl;
      n[2] /= nl;

      const tr0 = trap[0];
      const tr1 = trap[1];
      const tr2 = trap[2];
      const tr3 = trap[3];
      const ao = this.ao(px, py, pz, t, eps);
      const cav = 1 - ao;
      const tw = s.trapW;
      const tc = tw[0] * tr0 + tw[1] * tr1 + tw[2] * tr2 + tw[3] * Math.sqrt(tr3) + s.palShift + cav * 0.45;
      paletteAt(s.stops, tc, this.albedo);
      paletteAt(s.stops, tc + 0.5, this.inner);
      for (let i = 0; i < 3; i++) this.f0[i] = 0.05 + (this.albedo[i] - 0.05) * METALNESS;
      const vx = -dx;
      const vy = -dy;
      const vz = -dz;
      const nv = Math.max(n[0] * vx + n[1] * vy + n[2] * vz, 1e-3);
      const sd = s.sunDir;
      const facing = n[0] * sd[0] + n[1] * sd[1] + n[2] * sd[2] > 0;
      const sh = facing ? this.softShadow(px + n[0] * eps * 2, py + n[1] * eps * 2, pz + n[2] * eps * 2, eps) : 0;

      const lit = this.lit;
      lit[0] = lit[1] = lit[2] = 0;
      this.addBrdf(vx, vy, vz, sd[0], sd[1], sd[2], s.sunCol, SUN_INTENSITY * sh);
      this.addBrdf(vx, vy, vz, this.rim[0], this.rim[1], this.rim[2], s.glowCol, RIM_INTENSITY * ao);

      const up = n[1] * 0.5 + 0.5;
      const fres = Math.pow(1 - nv, 5);
      // Reflection direction: rd - 2 (n . rd) n.
      const ndr = n[0] * dx + n[1] * dy + n[2] * dz;
      this.skyBase(dx - 2 * ndr * n[0], dy - 2 * ndr * n[1], dz - 2 * ndr * n[2]);
      const cav3 = cav * cav * cav;
      for (let i = 0; i < 3; i++) {
        const lo = s.skyHorizon[i] * 0.7;
        const hi = s.skyTop[i] * 2.5 + s.skyHorizon[i] * 0.5;
        const amb = lo + (hi - lo) * up;
        const f0 = this.f0[i];
        const Fr = f0 + (Math.max(1 - ROUGHNESS, f0) - f0) * fres;
        lit[i] +=
          this.albedo[i] * amb * ao * 0.55 +
          this.sky[i] * Fr * ao * 1.2 +
          this.inner[i] * s.glowCol[i] * cav3 * 0.3 * s.glow +
          s.glowCol[i] * fres * ao * 0.1 * s.glow;
      }
      const fog = 1 - Math.exp(-t * s.fogDensity);
      this.skyBase(dx, dy, dz);
      r = lit[0] + (this.sky[0] - lit[0]) * fog;
      g = lit[1] + (this.sky[1] - lit[1]) * fog;
      bl = lit[2] + (this.sky[2] - lit[2]) * fog;
    } else {
      this.skyBase(dx, dy, dz);
      const sun = Math.max(dx * s.sunDir[0] + dy * s.sunDir[1] + dz * s.sunDir[2], 0);
      const disc = 5 * Math.pow(sun, 1200);
      const od = ox * dx + oy * dy + oz * dz;
      const edge = Math.sqrt(Math.max(ox * ox + oy * oy + oz * oz - od * od, 0)) / s.bound;
      const halo =
        (0.055 * Math.exp(-minAng * 90) + 0.02 * Math.exp(-minAng * 24)) * s.glow * (1 - smoothstep(0.5, 0.98, edge));
      r = this.sky[0] + s.sunCol[0] * disc + s.glowCol[0] * halo;
      g = this.sky[1] + s.sunCol[1] * disc + s.glowCol[1] * halo;
      bl = this.sky[2] + s.sunCol[2] * disc + s.glowCol[2] * halo;
    }
    if (!(r >= 0 && g >= 0 && bl >= 0)) r = g = bl = 0;
    out[o] = Math.min(r, MAX_RADIANCE);
    out[o + 1] = Math.min(g, MAX_RADIANCE);
    out[o + 2] = Math.min(bl, MAX_RADIANCE);
  }
}
