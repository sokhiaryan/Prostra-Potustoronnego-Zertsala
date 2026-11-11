// Orbit / dolly / fly camera with inertia.
//
// Every motion is relative: orbiting turns around a pivot on the surface, zooming is an
// exponential approach to the surface point under the cursor, and fly speed follows the
// distance estimate at the camera. Nothing has an absolute speed, so the controls feel
// the same at the overview and a thousand times deeper.
// Positions are kept in float64; only the uniforms handed to the GPU are float32.

export type DistFn = (x: number, y: number, z: number) => number;

const PITCH_LIMIT = 1.553; // ~89 degrees
const ORBIT_FRICTION = 4.5;
const ZOOM_RESPONSE = 12;
const FLY_RESPONSE = 8;

export class Camera {
  readonly pos = new Float64Array(3);
  readonly pivot = new Float64Array(3);
  yaw = 0;
  pitch = 0;
  tanFov = Math.tan((25 * Math.PI) / 180);

  /** Column-major basis (right, up, forward) and position, ready for uniform upload. */
  readonly basis = new Float32Array(9);
  readonly posF32 = new Float32Array(3);

  /** Closest allowed approach to the surface (float32 precision limit of the shader). */
  minDist = 4e-4;
  maxDist = 20;
  /** Largest fly speed scale, normally the fractal's bounding radius. */
  sceneSize = 2;
  /** Marching safety factor of the active fractal, used for picking. */
  stepScale = 0.8;

  dragging = false;
  /** Fly input in camera space, each in [-1, 1]. */
  flyX = 0;
  flyY = 0;
  flyZ = 0;

  private pendYaw = 0;
  private pendPitch = 0;
  private velYaw = 0;
  private velPitch = 0;
  private zoomPending = 0;
  private panned = false;
  private readonly flyVel = new Float64Array(3);
  private readonly right = new Float64Array(3);
  private readonly up = new Float64Array(3);
  private readonly fwd = new Float64Array(3);

  constructor() {
    this.lookAt(0, 0, 3, 0, 0, 0);
  }

  /** Place the camera and aim it at a target, which also becomes the orbit pivot. Stops all motion. */
  lookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    this.pos[0] = px;
    this.pos[1] = py;
    this.pos[2] = pz;
    this.pivot[0] = tx;
    this.pivot[1] = ty;
    this.pivot[2] = tz;
    const dx = tx - px;
    const dy = ty - py;
    const dz = tz - pz;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.asin(dy / len)));
    this.yaw = Math.atan2(dx, dz);
    this.velYaw = this.velPitch = 0;
    this.pendYaw = this.pendPitch = 0;
    this.zoomPending = 0;
    this.flyVel.fill(0);
    this.updateBasis();
  }

  private updateBasis(): void {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const { right: r, up: u, fwd: f, basis: b } = this;
    f[0] = cp * sy; f[1] = sp; f[2] = cp * cy;
    r[0] = -cy; r[1] = 0; r[2] = sy;
    u[0] = -sy * sp; u[1] = cp; u[2] = -cy * sp;
    b[0] = r[0]; b[1] = r[1]; b[2] = r[2];
    b[3] = u[0]; b[4] = u[1]; b[5] = u[2];
    b[6] = f[0]; b[7] = f[1]; b[8] = f[2];
    this.posF32[0] = this.pos[0];
    this.posF32[1] = this.pos[1];
    this.posF32[2] = this.pos[2];
  }

  /** Distance from the camera to its orbit pivot: the natural length scale of the current view. */
  viewScale(): number {
    return Math.hypot(this.pos[0] - this.pivot[0], this.pos[1] - this.pivot[1], this.pos[2] - this.pivot[2]);
  }

  /** Queue an orbit rotation (radians); applied on the next update. */
  orbit(dYaw: number, dPitch: number): void {
    this.pendYaw += dYaw;
    this.pendPitch += dPitch;
  }

  /** Rotate the camera rigidly about the pivot, so the pivot keeps its place on screen. */
  private applyOrbit(dYaw: number, dPitch: number): void {
    const { pos, pivot, right: r, up: u, fwd: f } = this;
    const ox = pos[0] - pivot[0];
    const oy = pos[1] - pivot[1];
    const oz = pos[2] - pivot[2];
    // Offset expressed in the camera frame stays constant under a rigid rotation.
    const lr = ox * r[0] + oy * r[1] + oz * r[2];
    const lu = ox * u[0] + oy * u[1] + oz * u[2];
    const lf = ox * f[0] + oy * f[1] + oz * f[2];
    this.yaw += dYaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dPitch));
    this.updateBasis();
    pos[0] = pivot[0] + lr * r[0] + lu * u[0] + lf * f[0];
    pos[1] = pivot[1] + lr * r[1] + lu * u[1] + lf * f[1];
    pos[2] = pivot[2] + lr * r[2] + lu * u[2] + lf * f[2];
  }

  /** Queue a zoom of `amount` e-folds (positive = closer) toward the current pivot. */
  zoom(amount: number): void {
    this.zoomPending += amount;
  }

  /** Slide the view by a pixel delta, scaled so the pivot plane follows the cursor. */
  pan(dxPx: number, dyPx: number, viewportHeightPx: number): void {
    const k = (this.viewScale() * 2 * this.tanFov) / Math.max(1, viewportHeightPx);
    const { right: r, up: u } = this;
    for (let i = 0; i < 3; i++) {
      const s = (-dxPx * r[i] + dyPx * u[i]) * k;
      this.pos[i] += s;
      this.pivot[i] += s;
    }
    this.panned = true;
  }

  /**
   * Sphere-trace from the camera through a screen point and move the pivot to the hit.
   * ndcX is in [-aspect, aspect], ndcY in [-1, 1] (up positive). Returns false on a miss.
   */
  pickPivot(ndcX: number, ndcY: number, dist: DistFn, viewportHeightPx: number): boolean {
    const { pos, right: r, up: u, fwd: f } = this;
    const tx = ndcX * this.tanFov;
    const ty = ndcY * this.tanFov;
    let dx = f[0] + tx * r[0] + ty * u[0];
    let dy = f[1] + tx * r[1] + ty * u[1];
    let dz = f[2] + tx * r[2] + ty * u[2];
    const inv = 1 / Math.hypot(dx, dy, dz);
    dx *= inv;
    dy *= inv;
    dz *= inv;
    const pix = (2 * this.tanFov) / Math.max(1, viewportHeightPx);
    const tMax = this.maxDist * 2;
    let t = 0;
    for (let i = 0; i < 400 && t < tMax; i++) {
      const d = dist(pos[0] + dx * t, pos[1] + dy * t, pos[2] + dz * t);
      if (d < Math.max(pix * t, this.minDist * 1e-3)) {
        this.pivot[0] = pos[0] + dx * t;
        this.pivot[1] = pos[1] + dy * t;
        this.pivot[2] = pos[2] + dz * t;
        return true;
      }
      t += d * this.stepScale;
    }
    return false;
  }

  /** Advance inertia and apply queued input. Returns true if the view changed. */
  update(dt: number, dist: DistFn): boolean {
    let moved = this.panned;
    this.panned = false;
    const { pos, pivot } = this;

    // Orbit: direct while dragging, coasting on the measured velocity afterwards.
    let dYaw = 0;
    let dPitch = 0;
    if (this.dragging) {
      dYaw = this.pendYaw;
      dPitch = this.pendPitch;
      if (dt > 0) {
        this.velYaw += (dYaw / dt - this.velYaw) * 0.4;
        this.velPitch += (dPitch / dt - this.velPitch) * 0.4;
      }
    } else {
      dYaw = this.pendYaw + this.velYaw * dt;
      dPitch = this.pendPitch + this.velPitch * dt;
      const decay = Math.exp(-dt * ORBIT_FRICTION);
      this.velYaw *= decay;
      this.velPitch *= decay;
      if (Math.abs(this.velYaw) + Math.abs(this.velPitch) < 2e-3) this.velYaw = this.velPitch = 0;
    }
    this.pendYaw = this.pendPitch = 0;
    if (dYaw !== 0 || dPitch !== 0) {
      this.applyOrbit(dYaw, dPitch);
      moved = true;
    }

    // Zoom: exponential approach to the pivot, eased so wheel steps blend together.
    if (Math.abs(this.zoomPending) > 1e-4) {
      const step = this.zoomPending * (1 - Math.exp(-dt * ZOOM_RESPONSE));
      const ox = pos[0] - pivot[0];
      const oy = pos[1] - pivot[1];
      const oz = pos[2] - pivot[2];
      const len = Math.hypot(ox, oy, oz);
      let f = Math.exp(-step);
      this.zoomPending -= step;
      if (len * f < this.minDist) {
        f = len > this.minDist ? this.minDist / len : 1;
        this.zoomPending = 0;
      }
      const nx = pivot[0] + ox * f;
      const ny = pivot[1] + oy * f;
      const nz = pivot[2] + oz * f;
      const tooFar = f > 1 && Math.hypot(nx, ny, nz) > this.maxDist;
      const blocked = f < 1 && dist(nx, ny, nz) < this.minDist * 0.5;
      if (tooFar || blocked) {
        this.zoomPending = 0;
      } else if (f !== 1) {
        pos[0] = nx;
        pos[1] = ny;
        pos[2] = nz;
        moved = true;
      }
    } else {
      this.zoomPending = 0;
    }

    // Fly: speed follows the distance to the surface, so it slows down as detail approaches.
    const v = this.flyVel;
    const flying = this.flyX !== 0 || this.flyY !== 0 || this.flyZ !== 0;
    if (flying || v[0] !== 0 || v[1] !== 0 || v[2] !== 0) {
      const { right: r, up: u, fwd: f } = this;
      const speed = Math.min(this.sceneSize, Math.max(this.minDist, dist(pos[0], pos[1], pos[2]))) * 1.4;
      const a = 1 - Math.exp(-dt * FLY_RESPONSE);
      let mag = 0;
      for (let i = 0; i < 3; i++) {
        const target = (this.flyX * r[i] + this.flyY * u[i] + this.flyZ * f[i]) * speed;
        v[i] += (target - v[i]) * a;
        mag += v[i] * v[i];
      }
      if (!flying && mag < speed * speed * 1e-6) {
        v.fill(0);
      } else {
        const nx = pos[0] + v[0] * dt;
        const ny = pos[1] + v[1] * dt;
        const nz = pos[2] + v[2] * dt;
        if (Math.hypot(nx, ny, nz) < this.maxDist && dist(nx, ny, nz) > this.minDist * 0.5) {
          pos[0] = nx;
          pos[1] = ny;
          pos[2] = nz;
          moved = true;
        } else {
          v.fill(0);
        }
      }
    }

    if (moved) this.updateBasis();
    return moved;
  }
}
