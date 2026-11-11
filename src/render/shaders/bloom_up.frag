#version 300 es
// Bloom upsample: 3x3 tent filter, blended additively onto the next larger level.
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 o = uTexel;
  vec3 col = texture(uSrc, vUv).rgb * 4.0;
  col += (texture(uSrc, vUv + vec2(o.x, 0.0)).rgb + texture(uSrc, vUv - vec2(o.x, 0.0)).rgb +
          texture(uSrc, vUv + vec2(0.0, o.y)).rgb + texture(uSrc, vUv - vec2(0.0, o.y)).rgb) * 2.0;
  col += texture(uSrc, vUv + o).rgb + texture(uSrc, vUv - o).rgb +
         texture(uSrc, vUv + vec2(o.x, -o.y)).rgb + texture(uSrc, vUv + vec2(-o.x, o.y)).rgb;
  fragColor = vec4(col / 16.0, 1.0);
}
