// Distance estimators. FRACTAL is #defined by the renderer (0 bulb, 1 box, 2 KIFS).
// Each map() returns a distance bound and an orbit trap:
//   trap.xyz = min |z| per axis over the orbit, trap.w = min |z|^2.
// These are mirrored line for line in src/math/de.ts (used by tests and CPU picking);
// docs/MATH.md explains why each estimate is valid.
uniform vec4 uP;    // per-fractal parameters
uniform int uIter;  // iteration count
uniform mat3 uRot;  // KIFS fold rotation

#if FRACTAL == 0
// Mandelbulb. uP = (power, theta phase, phi phase, -)
const float BAILOUT = 8.0;
float map(vec3 p, out vec4 trap) {
  vec3 z = p;
  float dr = 1.0;
  float r = length(z);
  trap = vec4(abs(z), r * r);
  for (int i = 0; i < 24; i++) {
    if (i >= uIter || r > BAILOUT) break;
    float rs = max(r, 1e-9);
    float theta = acos(clamp(z.z / rs, -1.0, 1.0)) * uP.x + uP.y;
    float phi = atan(z.y, z.x) * uP.x + uP.z;
    dr = uP.x * pow(rs, uP.x - 1.0) * dr + 1.0;
    float zr = pow(rs, uP.x);
    float st = sin(theta);
    z = zr * vec3(st * cos(phi), st * sin(phi), cos(theta)) + p;
    r = length(z);
    trap = min(trap, vec4(abs(z), r * r));
  }
  return 0.5 * log(max(r, 1e-9)) * r / dr;
}

#elif FRACTAL == 1
// Mandelbox. uP = (scale, min radius, fold limit, -)
float map(vec3 p, out vec4 trap) {
  float s = uP.x;
  float minR2 = uP.y * uP.y;
  float fold = uP.z;
  vec3 z = p;
  float dr = 1.0;
  trap = vec4(abs(z), dot(z, z));
  for (int i = 0; i < 24; i++) {
    if (i >= uIter) break;
    z = clamp(z, -fold, fold) * 2.0 - z;      // box fold
    float k = 1.0 / clamp(dot(z, z), minR2, 1.0); // sphere fold
    z *= k;
    dr *= k;
    z = z * s + p;
    dr = dr * abs(s) + 1.0;
    float m2 = dot(z, z);
    trap = min(trap, vec4(abs(z), m2));
    if (m2 > 1e6) break;
  }
  return length(z) / abs(dr);
}

#else
// Kaleidoscopic Menger (KIFS). uP = (scale, rot A, rot B, z offset); uRot built from A, B.
float map(vec3 p, out vec4 trap) {
  float s = uP.x;
  float c = uP.w * (s - 1.0);
  vec3 z = p;
  float w = 1.0;
  trap = vec4(abs(z), dot(z, z));
  for (int i = 0; i < 24; i++) {
    if (i >= uIter) break;
    z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;
    z = uRot * z;
    z.xy = z.xy * s - (s - 1.0);
    z.z = 0.5 * c - abs(z.z * s - 0.5 * c);
    w *= s;
    trap = min(trap, vec4(abs(z), dot(z, z)));
  }
  vec3 q = abs(z) - 1.0;
  return (length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0)) / w;
}
#endif

float mapd(vec3 p) {
  vec4 trap;
  return map(p, trap);
}
