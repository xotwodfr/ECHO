
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
// The glass (DESIGN_SYSTEM.md §7.11). Boxes in CSS px from the canvas's top left, y down.
uniform int uGlassN;
uniform vec4 uGlassRect[8];    // x, y, w, h
uniform vec4 uGlassCorner[8];  // radii: top-left, top-right, bottom-right, bottom-left
uniform float uGlassBend[32]; // inward shift across the rim, CSS px, edge first
uniform float uGlassBezel;
uniform float uGlassSat;
uniform float uGlassSpec;
uniform vec2 uGlassLight;      // the rim light's direction, y down
uniform float uGlassBendOn;    // per tier (governor.ts GLASS_BY_TIER)
uniform float uGlassLightOn;
in vec2 vUv;
out vec4 outColor;

float zoneMask(vec2 uv) {
  float d = length((uv - vec2(0.5, 0.43)) / vec2(0.46, 0.32));
  return 1.0 - smoothstep(0.75, 1.15, d);
}
float scrimMask(vec2 uv) {
  float d = length((uv - vec2(0.5, 0.63)) / vec2(0.36, 0.13));
  return 1.0 - smoothstep(0.0, 1.0, d);
}

void glass(vec2 p, inout vec2 uv, out float inside, out float rim) {
  inside = 0.0;
  rim = 0.0;
}

vec3 hable(vec3 x) {
  const float A = 0.15, B = 0.5, C = 0.1, D = 0.2, E = 0.02, F = 0.3;
  return (x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F) - E / F;
}
vec3 toSrgb(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  // The glass fades with the chrome it belongs to (Still snaps it, so reduced motion never sees the
  // bend move).
  vec2 uv = vUv;
  float inside;
  float rim;
  glass(vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr, uv, inside, rim);
  bool bent = uv != vUv;
  uv = mix(vUv, uv, uChrome);
  vec3 col = texture(uRoomTex, vUv).rgb;
  if (bent) col = texture(uRoomTex, uv).rgb;

  // Reverb (§4.3–§4.4, §5.2): the energy, masked to 40% in the reading corridor so rings pass
  // behind the words. A soft glow of it (a small blur standing in for the bloom chain), and
  // halation shifted toward red around the key light only.
  if (uEnergyOn > 0.5) {
    vec2 at = bent ? uv : vUv;
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
  // below the top. Light, since the glass chrome (§7.11) sits right on them.
  float fromBottom = gl_FragCoord.y / uDpr;
  float fromTop = (uRes.y - gl_FragCoord.y) / uDpr;
  col = mix(col, uShadow, uChrome * uScrimDock * clamp(1.0 - fromBottom / 220.0, 0.0, 1.0));
  col = mix(col, uShadow, uChrome * uScrimTop * clamp(1.0 - fromTop / 120.0, 0.0, 1.0));

  // Contrast (§5.4): the lyric zone is darkened, never the ink changed.
  col *= 1.0 + uZoneExposure * zoneMask(vUv);
  col = mix(col, uShadow, uZoneScrim * scrimMask(vUv));

  // What shows through the glass is more saturated (--glass-saturate).
  if (inside > 0.0) {
    float sat = mix(1.0, uGlassSat, uGlassLightOn * uChrome);
    col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, sat), 0.0);
  }

  col = hable(col * uExposure) / hable(vec3(11.2));
  col = toSrgb(clamp(col, 0.0, 1.0));
  col = mix(col, vec3(1.0), rim * uChrome); // the glass's rim light, over the tone-mapped room

  // Blue-noise dither (§7.8): ±1 LSB, last.
  float n = texture(uNoise, gl_FragCoord.xy / 64.0).r;
  col += (n * 2.0 - 1.0) / 255.0;
  outColor = vec4(col, 1.0);
}