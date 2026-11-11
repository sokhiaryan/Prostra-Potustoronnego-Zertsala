#version 300 es
// Progressive accumulation: running average of jittered frames while the camera is still.
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uWeight; // 1 / (samples so far + 1)
out vec4 fragColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 cur = texelFetch(uCur, px, 0).rgb;
  vec3 prev = texelFetch(uPrev, px, 0).rgb;
  fragColor = vec4(mix(prev, cur, uWeight), 1.0);
}
