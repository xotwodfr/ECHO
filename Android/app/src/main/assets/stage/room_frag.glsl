
precision highp float;
uniform float uAspect;   // stage width / height
uniform float uFlow;     // warp time, "units" (§4.2)
uniform float uDrift;    // pool time, seconds (slowed with playback paused)
uniform float uSeed;
uniform sampler2D uCover;     // the album cover, blurred (renderer.ts coverTexture), sRGB-decoded
uniform sampler2D uCoverPrev; // the one before it, while they crossfade
uniform vec2 uCoverOn;        // (previous, current): 1 where a cover is loaded, else --art-room
uniform float uCoverFade;     // previous → current, 0 → 1
uniform float uBrightness;    // the cover's, linear (the Stage's brightness control)
uniform vec3 uRoom;
uniform vec3 uAccent;
uniform vec3 uHighlight;
uniform vec3 uGlow;      // pre-multiplied by its alpha
uniform vec2 uKey;       // key light centre, stage uv with y down
uniform float uPoolScale; // Reverb: pools swell with the bass (§7.1), else 1
uniform float uKeyScale;  // Reverb: the key light swells with the sub, else 1
in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed * 0.618);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum;
}
vec2 warp(vec2 p) {
  vec2 q = vec2(fbm(p + vec2(0.0, uFlow)), fbm(p + vec2(5.2, 1.3 - uFlow)));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.5 * uFlow), fbm(p + 4.0 * q + vec2(8.3, 2.8)));
  return p + (r - 0.5) * 0.35;
}
// A soft pool of light, radius r in stage heights.
float pool(vec2 p, vec2 c, float r) {
  float d = length(p - c) / r;
  return exp(-2.0 * d * d);
}
const float TAU = 6.2831853;

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);  // stage-height units, y up
  vec2 w = warp(p * 1.4) / 1.4;           // light through haze, not circles
  float t = uDrift;
  vec2 c1 = vec2(uAspect * (0.5 + 0.32 * sin(TAU * t / 53.0)), 0.55 + 0.25 * sin(TAU * t / 71.0 + 1.0));
  vec2 c2 = vec2(uAspect * (0.5 + 0.35 * sin(TAU * t / 83.0 + 2.0)), 0.45 + 0.22 * sin(TAU * t / 47.0 + 0.5));
  vec2 c3 = vec2(uAspect * (0.5 + 0.28 * sin(TAU * t / 61.0 + 4.0)), 0.50 + 0.30 * sin(TAU * t / 89.0 + 3.0));
  // The base: the cover cropped to the stage like object-fit: cover, flowing a little with the
  // haze's warp (≤ 6% of the cover), so the backdrop lives without competing with the pools.
  vec2 cuv = 0.5 + (vUv - 0.5) * (uAspect > 1.0 ? vec2(1.0, 1.0 / uAspect) : vec2(uAspect, 1.0));
  cuv += (w - p) * 0.5 / max(uAspect, 1.0);
  vec3 prev = mix(uRoom, texture(uCoverPrev, cuv).rgb * uBrightness, uCoverOn.x);
  vec3 cur = mix(uRoom, texture(uCover, cuv).rgb * uBrightness, uCoverOn.y);
  // Intensities (§4.1: pools 0.10–0.22, key light 0.12–0.20) are perceptual amplitudes, so they
  // are squared into linear light: a low glow on a dark room, not a lit wall.
  vec3 col = mix(prev, cur, uCoverFade);
  col += uAccent * (0.16 * 0.16) * pool(w, c1, 0.80 * uPoolScale);
  col += uHighlight * (0.12 * 0.12) * pool(w, c2, 0.60 * uPoolScale);
  col += uAccent * (0.10 * 0.10) * pool(w, c3, 0.90 * uPoolScale);
  // Key light: the lamp the words hang under, 0.35 H, in --art-glow (alpha already applied).
  vec2 key = vec2(uKey.x * uAspect, 1.0 - uKey.y);
  col += uGlow / 0.35 * (0.16 * 0.16) * pool(p, key, 0.35 * uKeyScale);
  outColor = vec4(col, 1.0);
}