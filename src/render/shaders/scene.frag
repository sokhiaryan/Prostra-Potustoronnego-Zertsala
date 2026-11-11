// Scene pass: sphere-trace the fractal and shade it to linear HDR.
// The renderer prepends "#version", "#define FRACTAL n", precision and de.glsl.
uniform vec2 uRes;        // size of the viewport being rendered, in pixels
uniform vec2 uJitter;     // sub-pixel offset in [-0.5, 0.5] for accumulation AA
uniform vec3 uCamPos;
uniform mat3 uCamBasis;   // columns: right, up, forward
uniform float uTanFov;    // tan(vertical fov / 2)
uniform float uBound;     // bounding-sphere radius of the fractal
uniform float uMinEps;    // float-precision floor for the hit threshold
uniform float uStepScale; // safety factor applied to each marching step
uniform int uMaxSteps;
uniform int uShadowSteps;
uniform vec3 uSunDir;
uniform vec3 uPal0; // four gradient stops, linear RGB
uniform vec3 uPal1;
uniform vec3 uPal2;
uniform vec3 uPal3;
uniform float uPalShift;
uniform vec4 uTrapW;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunCol;
uniform vec3 uGlowCol;
uniform float uFogDensity;
uniform float uGlow;

out vec4 fragColor;

const float PI = 3.14159265;
const float SUN_INTENSITY = 4.6;
const float RIM_INTENSITY = 0.85;
const float ROUGHNESS = 0.24;
const float METALNESS = 0.2;
const float HIT_PIXELS = 0.6; // hit threshold as a fraction of the pixel footprint

// Smooth four-stop gradient that runs 0 -> 3 -> 0 over a period of 2, so it never jumps.
vec3 palette(float t) {
  float x = (1.0 - abs(fract(t * 0.5) * 2.0 - 1.0)) * 3.0;
  vec3 c = mix(uPal0, uPal1, smoothstep(0.0, 1.0, x));
  c = mix(c, uPal2, smoothstep(1.0, 2.0, x));
  return mix(c, uPal3, smoothstep(2.0, 3.0, x));
}

// Collapse the orbit trap to one palette coordinate. The weights (per axis, then radius)
// differ per fractal only because their orbits live at different scales.
float trapCoord(vec4 trap) {
  return dot(uTrapW, vec4(trap.xyz, sqrt(trap.w)));
}

// Sky without the sun disc: used for fog, ambient reflections and as the base of sky().
vec3 skyBase(vec3 rd) {
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, smoothstep(0.45, 1.0, h));
  c = mix(c, uSkyHorizon * 0.22, smoothstep(0.5, 0.05, h));
  float s = max(dot(rd, uSunDir), 0.0);
  c += uSunCol * (0.07 * pow(s, 5.0) + 0.3 * pow(s, 40.0));
  return c;
}

vec3 sky(vec3 rd) {
  float s = max(dot(rd, uSunDir), 0.0);
  return skyBase(rd) + uSunCol * 5.0 * pow(s, 1200.0);
}

vec2 sphereHit(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Tetrahedral central differences, sampled at the pixel footprint so the normal
// is band-limited to what the pixel can resolve.
vec3 calcNormal(vec3 p, float h) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapd(p + k.xyy * h) +
    k.yyx * mapd(p + k.yyx * h) +
    k.yxy * mapd(p + k.yxy * h) +
    k.xxx * mapd(p + k.xxx * h));
}

// Penumbra-estimating shadow march (closest-approach formulation).
float softShadow(vec3 ro, vec3 rd, float eps) {
  float tmax = sphereHit(ro, rd, uBound).y;
  if (tmax <= 0.0) return 1.0;
  float res = 1.0;
  float t = eps * 2.0;
  float ph = 1e20;
  for (int i = 0; i < 96; i++) {
    if (i >= uShadowSteps) break;
    float h = mapd(ro + rd * t);
    if (h < eps * 0.5) return 0.0;
    float y = h * h / (2.0 * ph);
    float d = sqrt(max(h * h - y * y, 0.0));
    res = min(res, 14.0 * d / max(t - y, 1e-9));
    ph = h;
    // The minimum step grows with distance so a fixed step budget still covers the scene.
    t += max(h * uStepScale, t * 0.02 + eps);
    if (t > tmax) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

// Five-tap ambient occlusion along the normal; the radius follows view distance,
// so it reads the same at every zoom level.
float calcAO(vec3 p, vec3 n, float t, float eps) {
  float occ = 0.0;
  float wsum = 0.0;
  float w = 1.0;
  float hmax = max(0.09 * t, eps * 10.0);
  for (int i = 1; i <= 5; i++) {
    float h = hmax * float(i * i) / 25.0 + eps;
    float d = mapd(p + n * h);
    occ += clamp(1.0 - d / h, 0.0, 1.0) * w;
    wsum += w;
    w *= 0.8;
  }
  float ao = clamp(1.0 - 1.35 * occ / wsum, 0.0, 1.0);
  return ao * sqrt(ao);
}

// Cook-Torrance (GGX distribution, Smith-Schlick visibility, Schlick Fresnel) plus
// Lambert diffuse, already multiplied by n.l.
vec3 brdf(vec3 n, vec3 v, vec3 l, vec3 albedo, vec3 F0) {
  float nl = max(dot(n, l), 0.0);
  if (nl <= 0.0) return vec3(0.0);
  vec3 hv = normalize(l + v);
  float nv = max(dot(n, v), 1e-3);
  float nh = max(dot(n, hv), 0.0);
  float vh = max(dot(v, hv), 0.0);
  float a = ROUGHNESS * ROUGHNESS;
  float a2 = a * a;
  float dn = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dn * dn);
  float kk = (ROUGHNESS + 1.0) * (ROUGHNESS + 1.0) / 8.0;
  float G = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
  vec3 spec = D * G * F / (4.0 * nl * nv + 1e-4);
  vec3 kd = (1.0 - F) * (1.0 - METALNESS);
  return (kd * albedo / PI + spec) * nl;
}

vec3 shade(vec3 p, vec3 n, vec3 rd, float t, float eps, vec4 trap) {
  float ao = calcAO(p, n, t, eps);
  float cav = 1.0 - ao;
  // Orbit trap picks the hue; cavities slide a little further along the gradient,
  // so ridges and crevices separate in colour as well as in brightness.
  float tc = trapCoord(trap) + uPalShift + cav * 0.45;
  vec3 albedo = palette(tc);
  vec3 F0 = mix(vec3(0.05), albedo, METALNESS);
  vec3 v = -rd;
  float nv = max(dot(n, v), 1e-3);

  float sh = dot(n, uSunDir) > 0.0 ? softShadow(p + n * eps * 2.0, uSunDir, eps) : 0.0;

  // Key light with soft shadows.
  vec3 col = brdf(n, v, uSunDir, albedo, F0) * uSunCol * SUN_INTENSITY * sh;

  // Cool rim light from behind the subject, opposite the sun; unshadowed, so AO stands in.
  vec3 rimDir = normalize(vec3(-uSunDir.x, 0.3, -uSunDir.z));
  col += brdf(n, v, rimDir, albedo, F0) * uGlowCol * RIM_INTENSITY * ao;

  // Hemispheric sky light plus a faint bounce from below.
  vec3 amb = mix(uSkyHorizon * 0.7, uSkyTop * 2.5 + uSkyHorizon * 0.5, n.y * 0.5 + 0.5);
  col += albedo * amb * ao * 0.55;

  // Environment reflection with a roughness-aware Fresnel, occluded by AO.
  float fres = pow(1.0 - nv, 5.0);
  vec3 Fr = F0 + (max(vec3(1.0 - ROUGHNESS), F0) - F0) * fres;
  col += skyBase(reflect(rd, n)) * Fr * ao * 1.2;

  // Inner light: the deepest crevices glow faintly instead of going dead black,
  // and grazing angles pick up a thin sheen. Both scale with the Glow control.
  col += palette(tc + 0.5) * uGlowCol * cav * cav * cav * 0.3 * uGlow;
  col += uGlowCol * fres * ao * 0.10 * uGlow;
  return col;
}

void main() {
  vec2 ndc = (2.0 * (gl_FragCoord.xy + uJitter) - uRes) / uRes.y;
  vec3 rd = normalize(uCamBasis * vec3(ndc * uTanFov, 1.0));
  vec3 ro = uCamPos;
  float pix = 2.0 * uTanFov / uRes.y; // world-space pixel size at unit distance

  vec2 bnd = sphereHit(ro, rd, uBound);
  float t = max(bnd.x, 0.0);
  float d = 1e9;
  float eps = uMinEps;
  float minAng = 1e9;
  bool hit = false;
  vec4 trap = vec4(0.0);

  if (bnd.y > 0.0) {
    for (int i = 0; i < 512; i++) {
      if (i >= uMaxSteps) break;
      d = map(ro + rd * t, trap);
      eps = max(pix * t * HIT_PIXELS, uMinEps); // hit threshold follows the pixel footprint at this depth
      if (d < eps) { hit = true; break; }
      minAng = min(minAng, d / max(t, 1e-9));
      t += d * uStepScale;
      if (t > bnd.y) break;
    }
    // Out of steps while skimming a surface: shade it rather than punching a hole.
    if (!hit && t <= bnd.y && d < eps * 8.0) hit = true;
  }

  vec3 col;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, max(eps, uMinEps * 5.0));
    col = shade(p, n, rd, t, eps, trap);
    float fog = 1.0 - exp(-t * uFogDensity);
    col = mix(col, skyBase(rd), fog);
  } else {
    col = sky(rd);
    // Near-miss glow: rays that graze the surface pick up a soft halo.
    // It fades out toward the bounding sphere so that boundary never shows.
    float edge = sqrt(max(dot(ro, ro) - dot(ro, rd) * dot(ro, rd), 0.0)) / uBound;
    float halo = 0.055 * exp(-minAng * 90.0) + 0.02 * exp(-minAng * 24.0);
    col += uGlowCol * uGlow * halo * (1.0 - smoothstep(0.5, 0.98, edge));
  }

  if (!(col.r >= 0.0 && col.g >= 0.0 && col.b >= 0.0)) col = vec3(0.0); // NaN guard
  fragColor = vec4(min(col, vec3(48.0)), 1.0);
}
