#version 300 es
// Temporal smoothing for moving frames. Each frame the scene is drawn once, at reduced
// resolution and with a sub-pixel jitter; here it is blended with the previous output,
// fetched from where each surface point was on screen a frame ago. Over a few frames
// that recovers the detail and anti-aliasing a single low-resolution frame lacks.
//
// The history is clamped to the colour range of the current neighbourhood, so stale
// pixels (newly revealed surfaces, a changed shape, a jump) fade within a frame or two
// instead of ghosting.
precision highp float;
uniform sampler2D uCur;   // scene: rgb, and hit distance in alpha (negative = sky)
uniform sampler2D uHist;  // previous output, full resolution
uniform vec2 uCurSize;    // used region of uCur, in texels
uniform vec2 uTexSize;    // full size of uCur's texture
uniform vec2 uJitter;     // jitter the scene was drawn with, in scene texels
uniform mat3 uCamBasis;   // columns: right, up, forward
uniform float uTanFov;
uniform mat3 uPrevBasis;
uniform float uPrevTanFov;
uniform vec3 uCamDelta;   // camera position minus previous camera position
uniform float uBlend;     // weight of the current frame; 1 = ignore history
in vec2 vUv;
out vec4 fragColor;

vec3 fetch(ivec2 p) {
  return texelFetch(uCur, clamp(p, ivec2(0), ivec2(uCurSize) - 1), 0).rgb;
}

void main() {
  // The texel centred at c holds the scene at c + jitter, so the scene at this pixel is at px.
  vec2 px = vUv * uCurSize - uJitter;
  vec3 cur = texture(uCur, clamp(px, vec2(0.5), uCurSize - 0.5) / uTexSize).rgb;
  vec3 col = cur;

  if (uBlend < 1.0) {
    ivec2 ip = ivec2(floor(px));
    float t = texelFetch(uCur, clamp(ip, ivec2(0), ivec2(uCurSize) - 1), 0).a;

    vec3 lo = cur;
    vec3 hi = cur;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 s = fetch(ip + ivec2(x, y));
        lo = min(lo, s);
        hi = max(hi, s);
      }
    }

    // Where was this point on screen last frame? Sky has no position, only a direction.
    float aspect = uCurSize.x / uCurSize.y;
    vec2 ndc = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);
    vec3 rd = normalize(uCamBasis * vec3(ndc * uTanFov, 1.0));
    vec3 v = (t > 0.0 ? uCamDelta + rd * t : rd) * uPrevBasis; // into the previous camera's frame
    if (v.z > 0.0) {
      vec2 puv = v.xy / (v.z * uPrevTanFov) / vec2(aspect, 1.0) * 0.5 + 0.5;
      if (puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0) {
        col = mix(clamp(texture(uHist, puv).rgb, lo, hi), cur, uBlend);
      }
    }
  }
  fragColor = vec4(col, 1.0);
}
