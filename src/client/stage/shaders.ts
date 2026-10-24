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
 * Pass 1, the room (§4.1): the --art-room base, three soft light pools on slow Lissajous paths,
 * shaped by domain-warped fBm (2 warp octaves over 4-octave value noise), and the key light behind
 * the active line. Linear light, written to the half-resolution room target.
 */
export const ROOM_FRAG = /* glsl */ `
precision highp float;
uniform float uAspect;   // stage width / height
uniform float uFlow;     // warp time, "units" (§4.2)
uniform float uDrift;    // pool time, seconds (slowed with playback paused)
uniform float uSeed;
uniform vec3 uRoom;
uniform vec3 uAccent;
uniform vec3 uHighlight;
uniform vec3 uGlow;      // pre-multiplied by its alpha
uniform vec2 uKey;       // key light centre, stage uv with y down
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
  // Intensities (§4.1: pools 0.10–0.22, key light 0.12–0.20) are perceptual amplitudes, so they
  // are squared into linear light: a low glow on a dark room, not a lit wall.
  vec3 col = uRoom;
  col += uAccent * (0.16 * 0.16) * pool(w, c1, 0.80);
  col += uHighlight * (0.12 * 0.12) * pool(w, c2, 0.60);
  col += uAccent * (0.10 * 0.10) * pool(w, c3, 0.90);
  // Key light: the lamp the words hang under, 0.35 H, in --art-glow (alpha already applied).
  vec2 key = vec2(uKey.x * uAspect, 1.0 - uKey.y);
  col += uGlow / 0.35 * (0.16 * 0.16) * pool(p, key, 0.35);
  outColor = vec4(col, 1.0);
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
uniform float uExposure;
uniform float uZoneExposure;   // −0.4…0: the contrast solver darkens the lyric zone (DESIGN_SYSTEM.md §3.4)
uniform float uZoneScrim;      // 0…0.45: then a shadow scrim behind the active line
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

  // Vignette (§7.6): elliptical, --art-shadow, 16% at the corners.
  float v = smoothstep(0.30, 0.71, length(vUv - 0.5));
  col = mix(col, uShadow, 0.16 * v);

  // Scrims (§7.7): 0 → 0.72 over 220px above the bottom edge, 0 → 0.5 over 120px below the top.
  float fromBottom = gl_FragCoord.y / uDpr;
  float fromTop = (uRes.y - gl_FragCoord.y) / uDpr;
  col = mix(col, uShadow, uChrome * 0.72 * clamp(1.0 - fromBottom / 220.0, 0.0, 1.0));
  col = mix(col, uShadow, uChrome * 0.50 * clamp(1.0 - fromTop / 120.0, 0.0, 1.0));

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
