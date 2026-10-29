import { HABLE } from './palette.ts';

// Stage shaders (GLSL ES 3.00), drawn on one full-screen triangle (VISUALIZER_SPEC.md §5.1–5.2).

export const FULLSCREEN_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Pass 1, the room (§4.1): the album cover, blurred, as the base (owner, 2026-10-28; --art-room
 * where there is none), three soft light pools on slow Lissajous paths, shaped by domain-warped fBm
 * (2 warp octaves over 4-octave value noise), and the key light behind the active line. Linear
 * light, written to the half-resolution room target.
 */
export const ROOM_FRAG = /* glsl */ `
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
}`;

/**
 * Pass 2, energy (Reverb only, §4.4): the light that lingers. The previous energy, sampled with a
 * 0.3% zoom toward the key light and a slight warp, decays, and the rings (§4.3) and the key flare
 * are added. Only this buffer feeds back; the room never does.
 */
export const ENERGY_FRAG = /* glsl */ `
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
}`;

/**
 * The lyric zone in canvas uv (y up; the canvas spans the dock too): the reading corridor
 * (LYRICS_EXPERIENCE.md §3.2: x 0.12–0.88 W, active line at 0.40 H, zone to 0.86 H) as a soft
 * ellipse, and the active line's own smaller ellipse for the scrim (DESIGN_SYSTEM.md §3.4 rule 6,
 * the one gradient permitted for contrast).
 */
const ZONE_GLSL = /* glsl */ `
float zoneMask(vec2 uv) {
  float d = length((uv - vec2(0.5, 0.43)) / vec2(0.46, 0.32));
  return 1.0 - smoothstep(0.75, 1.15, d);
}
float scrimMask(vec2 uv) {
  float d = length((uv - vec2(0.5, 0.63)) / vec2(0.36, 0.13));
  return 1.0 - smoothstep(0.0, 1.0, d);
}`;

/**
 * The contrast probe (VISUALIZER_SPEC.md §5.4): the composite's safe zone (the corridor rect) into
 * an 8×8 RGBA8 target, read back every 250 ms. The same light path as the composite, without the
 * scrims and dither, which only darken.
 */
export const PROBE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uRoomTex;
uniform vec3 uShadow;
uniform float uExposure;
uniform float uZoneExposure;
uniform float uZoneScrim;
in vec2 vUv;
out vec4 outColor;
${ZONE_GLSL}
vec3 hable(vec3 x) {
  const float A = ${HABLE.A}, B = ${HABLE.B}, C = ${HABLE.C}, D = ${HABLE.D}, E = ${HABLE.E}, F = ${HABLE.F};
  return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
}
vec3 toSrgb(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = vec2(mix(0.12, 0.88, vUv.x), mix(0.14, 0.66, vUv.y));
  vec3 col = texture(uRoomTex, uv).rgb;
  col = mix(col, uShadow, 0.16 * smoothstep(0.30, 0.71, length(uv - 0.5)));
  col *= 1.0 + uZoneExposure * zoneMask(uv);
  col = mix(col, uShadow, uZoneScrim * scrimMask(uv));
  col = hable(col * uExposure) / hable(vec3(${HABLE.W.toFixed(1)}));
  outColor = vec4(toSrgb(clamp(col, 0.0, 1.0)), 1.0);
}`;

/**
 * Pass 4, the composite (§5.2): room → vignette → scrims → filmic tone map → sRGB encode →
 * blue-noise dither (±1 LSB, always the last step). Energy, bloom, halation and grain join here
 * in later milestones.
 */
export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uRoomTex;
uniform sampler2D uNoise;      // 64×64 blue noise
uniform vec2 uRes;             // backing-store px
uniform float uDpr;            // backing px per CSS px
uniform vec3 uShadow;          // --art-shadow, linear
uniform float uChrome;         // 0..1: scrims follow chrome visibility (DESIGN_SYSTEM.md §7.7)
uniform float uScrimTop;       // --scrim-top
uniform float uScrimDock;      // --scrim-dock
uniform float uExposure;
uniform float uZoneExposure;   // −0.4…0: the contrast solver darkens the lyric zone (DESIGN_SYSTEM.md §3.4)
uniform float uZoneScrim;      // 0…0.45: then a shadow scrim behind the active line
uniform sampler2D uEnergyTex;  // Reverb: rings and flares (§4.4); black otherwise
uniform float uEnergyOn;
uniform vec2 uKeyUv;           // the key light, canvas uv (y up), for halation
in vec2 vUv;
out vec4 outColor;
${ZONE_GLSL}

vec3 hable(vec3 x) {
  const float A = ${HABLE.A}, B = ${HABLE.B}, C = ${HABLE.C}, D = ${HABLE.D}, E = ${HABLE.E}, F = ${HABLE.F};
  return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
}
vec3 toSrgb(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 col = texture(uRoomTex, vUv).rgb;

  // Reverb (§4.3–§4.4, §5.2): the energy, masked to 40% in the reading corridor so rings pass
  // behind the words. A soft glow of it (a small blur standing in for the bloom chain), and
  // halation shifted toward red around the key light only.
  if (uEnergyOn > 0.5) {
    vec2 at = vUv;
    vec3 e = texture(uEnergyTex, at).rgb;
    vec2 o = 6.0 / uRes;
    vec3 glow = (texture(uEnergyTex, at + vec2(o.x, o.y)).rgb + texture(uEnergyTex, at - vec2(o.x, o.y)).rgb
      + texture(uEnergyTex, at + vec2(o.x, -o.y)).rgb + texture(uEnergyTex, at + vec2(-o.x, o.y)).rgb) * 0.25;
    col += mix(1.0, 0.4, zoneMask(vUv)) * (e + 0.5 * glow);
    float near = exp(-dot(vUv - uKeyUv, vUv - uKeyUv) / (0.18 * 0.18));
    col += glow * vec3(1.0, 0.55, 0.35) * 0.12 * near;
  }

  // Vignette (§7.6): elliptical, --art-shadow, 16% at the corners.
  float v = smoothstep(0.30, 0.71, length(vUv - 0.5));
  col = mix(col, uShadow, 0.16 * v);

  // Scrims (§7.7): 0 → --scrim-dock over 220px above the bottom edge, 0 → --scrim-top over 120px
  // below the top. Light, since the chrome sits right on them.
  float fromBottom = gl_FragCoord.y / uDpr;
  float fromTop = (uRes.y - gl_FragCoord.y) / uDpr;
  col = mix(col, uShadow, uChrome * uScrimDock * clamp(1.0 - fromBottom / 220.0, 0.0, 1.0));
  col = mix(col, uShadow, uChrome * uScrimTop * clamp(1.0 - fromTop / 120.0, 0.0, 1.0));

  // Contrast (§5.4): the lyric zone is darkened, never the ink changed.
  col *= 1.0 + uZoneExposure * zoneMask(vUv);
  col = mix(col, uShadow, uZoneScrim * scrimMask(vUv));

  col = hable(col * uExposure) / hable(vec3(${HABLE.W.toFixed(1)}));
  col = toSrgb(clamp(col, 0.0, 1.0));

  // Blue-noise dither (§7.8): ±1 LSB, last.
  float n = texture(uNoise, gl_FragCoord.xy / 64.0).r;
  col += (n * 2.0 - 1.0) / 255.0;
  outColor = vec4(col, 1.0);
}`;
