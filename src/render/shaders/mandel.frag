#version 300 es
// 2D Mandelbrot set, GPU tier: plain float32 escape-time iteration with a smooth count.
// Valid only while a pixel is much wider than float32 rounding (the first few hundred
// times of zoom); deeper views are drawn on the CPU by src/math/mandel.ts, which uses the
// same escape radius, smooth count and colour mapping so the hand-over is invisible.
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform vec2 uJitter;
uniform vec2 uCenter;
uniform float uHalf;     // half the view height
uniform int uMaxIter;
uniform vec3 uPal0;
uniform vec3 uPal1;
uniform vec3 uPal2;
uniform vec3 uPal3;
uniform float uPalShift;
uniform float uDensity;
out vec4 fragColor;

const float ESCAPE2 = 65536.0;      // escape radius 256, squared
const float LN_ESCAPE = 5.545177444; // ln 256
const float COLOR_RATE = 0.11;

vec3 palette(float t) {
  float x = (1.0 - abs(fract(t * 0.5) * 2.0 - 1.0)) * 3.0;
  vec3 c = mix(uPal0, uPal1, smoothstep(0.0, 1.0, x));
  c = mix(c, uPal2, smoothstep(1.0, 2.0, x));
  return mix(c, uPal3, smoothstep(2.0, 3.0, x));
}

void main() {
  vec2 p = (2.0 * (gl_FragCoord.xy + uJitter) - uRes) / uRes.y;
  vec2 c = uCenter + p * uHalf;
  vec2 z = vec2(0.0);
  float nu = -1.0;
  for (int i = 0; i < 16384; i++) {
    if (i >= uMaxIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float m = dot(z, z);
    if (m > ESCAPE2) {
      nu = float(i + 1) + 1.0 - log2(0.5 * log(m) / LN_ESCAPE);
      break;
    }
  }
  vec3 col = nu < 0.0 ? vec3(0.0) : palette(sqrt(max(nu, 0.0)) * COLOR_RATE * uDensity + uPalShift);
  fragColor = vec4(col, 1.0);
}
