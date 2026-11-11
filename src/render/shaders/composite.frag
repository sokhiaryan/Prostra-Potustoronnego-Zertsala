#version 300 es
// Final pass: bloom, exposure, ACES filmic tone map, vignette, sRGB encode, dither.
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uUvScale;
uniform vec2 uUvMax;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uBloomNorm; // 1 / number of bloom levels
in vec2 vUv;
out vec4 fragColor;

// ACES fit by Stephen Hill (RRT + ODT), operating on linear sRGB.
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);

vec3 aces(vec3 c) {
  c = ACES_IN * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(ACES_OUT * (a / b), 0.0, 1.0);
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = texture(uScene, min(vUv * uUvScale, uUvMax)).rgb;
  col += texture(uBloom, vUv).rgb * uBloomStrength * uBloomNorm;
  col *= uExposure;

  // Light vignette, applied in linear light before the tone curve.
  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.38 * smoothstep(0.35, 1.0, length(q) * 1.35);

  col = toSrgb(aces(col));
  // Triangular-ish dither hides 8-bit banding in the smooth sky gradients.
  float n = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.13) - 1.0;
  fragColor = vec4(col + n / 255.0, 1.0);
}
