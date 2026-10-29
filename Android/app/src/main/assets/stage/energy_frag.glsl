
precision highp float;
uniform sampler2D uPrev;
uniform float uAspect;
uniform float uDecay;
uniform float uWarp;      // ≤ 0.003 uv
uniform float uFlow;
uniform vec2 uKey;        // stage uv, y down
uniform vec4 uRings[3];   // x, y (stage uv, y down), radius (H), light
uniform vec3 uTint;       // ring tint, --art-highlight (never saturated red)
uniform float uFlare;     // key flare, 0..0.15
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 key = vec2(uKey.x, 1.0 - uKey.y);
  vec2 back = key + (vUv - key) * (1.0 - 0.003); // drift outward like a reflection
  back += uWarp * vec2(sin(vUv.y * 9.0 + uFlow * 6.0), cos(vUv.x * 9.0 - uFlow * 6.0));
  vec3 e = texture(uPrev, back).rgb * uDecay;
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  for (int i = 0; i < 3; i++) {
    vec4 r = uRings[i];
    if (r.w <= 0.0) continue;
    vec2 c = vec2(r.x * uAspect, 1.0 - r.y);
    float d = abs(length(p - c) - r.z);
    e += uTint * r.w * exp(-(d * d) / (0.01 * 0.01)); // a soft band 0.02 H wide
  }
  vec2 k = vec2(key.x * uAspect, key.y);
  e += uTint * uFlare * exp(-dot(p - k, p - k) / (0.12 * 0.12));
  outColor = vec4(e, 1.0);
}