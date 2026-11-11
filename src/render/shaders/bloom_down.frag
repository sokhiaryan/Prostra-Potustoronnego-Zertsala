#version 300 es
// Bloom downsample: 13-tap filter (Jimenez, "Next Generation Post Processing in
// Call of Duty: Advanced Warfare"). The first level also applies a soft-knee threshold.
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;    // one source texel in uv units
uniform vec2 uUvScale;  // used fraction of the source texture (dynamic resolution)
uniform vec2 uUvMax;    // last valid texel centre of that region
uniform float uPrefilter;
in vec2 vUv;
out vec4 fragColor;

vec3 tap(vec2 uv, float x, float y) {
  return min(texture(uSrc, min(uv + vec2(x, y) * uTexel, uUvMax)).rgb, vec3(24.0));
}

void main() {
  vec2 uv = vUv * uUvScale;
  vec3 a = tap(uv, -2.0, 2.0), b = tap(uv, 0.0, 2.0), c = tap(uv, 2.0, 2.0);
  vec3 d = tap(uv, -2.0, 0.0), e = tap(uv, 0.0, 0.0), f = tap(uv, 2.0, 0.0);
  vec3 g = tap(uv, -2.0, -2.0), h = tap(uv, 0.0, -2.0), i = tap(uv, 2.0, -2.0);
  vec3 j = tap(uv, -1.0, 1.0), k = tap(uv, 1.0, 1.0);
  vec3 l = tap(uv, -1.0, -1.0), m = tap(uv, 1.0, -1.0);
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;

  if (uPrefilter > 0.5) {
    const float threshold = 0.85;
    const float knee = 0.6;
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - threshold) / max(br, 1e-4);
  }
  fragColor = vec4(col, 1.0);
}
