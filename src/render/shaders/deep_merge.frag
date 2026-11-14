#version 300 es
// Presents CPU-rendered images. "Front" is the last finished pass, possibly at a lower
// resolution and, for the 2D view, possibly of an older view (then uXform moves and
// scales it into place). "Back" is the pass in progress: bands that have arrived carry
// alpha 1 and are drawn over the front image.
precision highp float;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform vec2 uFrontScale; // front image size / texture size
uniform vec2 uFrontMax;   // last valid texel centre of the front image, in uv
uniform vec2 uBackSize;   // back image size in texels; x = 0 when there is none
uniform vec4 uXform;      // uv' = uv * xy + zw: this view's screen -> the front image's screen
uniform vec3 uVoid;       // colour where the front image has no data
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 uv = vUv * uXform.xy + uXform.zw;
  vec3 col = uVoid;
  if (uFrontScale.x > 0.0 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    col = texture(uFront, min(uv * uFrontScale, uFrontMax)).rgb;
  }
  if (uBackSize.x > 0.0) {
    vec4 b = texelFetch(uBack, ivec2(min(vUv * uBackSize, uBackSize - 1.0)), 0);
    col = mix(col, b.rgb, b.a);
  }
  fragColor = vec4(col, 1.0);
}
