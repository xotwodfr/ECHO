
precision highp float;
uniform sampler2D uRoomTex;
uniform vec3 uShadow;
uniform float uExposure;
uniform float uZoneExposure;
uniform float uZoneScrim;
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
vec3 hable(vec3 x) {
  const float A = 0.15, B = 0.5, C = 0.1, D = 0.2, E = 0.02, F = 0.3;
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
  col = hable(col * uExposure) / hable(vec3(11.2));
  outColor = vec4(toSrgb(clamp(col, 0.0, 1.0)), 1.0);
}