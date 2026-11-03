# ECHO — Visual Environment & Visualizer Specification

> **Navidrome only since 2026-11-03.** Spotify was removed (`824eeb9`, `8f2c1b2`; why:
> [reviews/2026-11-03-spotify-outage.md](reviews/2026-11-03-spotify-outage.md)). Every
> track is Navidrome's now, so Reverb applies whenever the audio can be analysed; the Spotify parts
> of §2 are kept as the reason Ambient exists.

Status: **Draft 2** · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Design system](DESIGN_SYSTEM.md) §3.3, §7 (palette roles, permitted light effects) · [Lyrics experience](LYRICS_EXPERIENCE.md) §12 (how the lyric field uses features) · [Playback](PLAYBACK_ARCHITECTURE.md) · [Technical architecture](TECHNICAL_ARCHITECTURE.md) §4.2 (frame order)

The environment is the **room** the lyrics hang in. Its light comes from the album cover. When ECHO
can legitimately analyse the audio, it also responds to the music, with transients sending wavefronts
through the room the way a sound reflects off walls.

---

## 1. Principles

1. **Sound is the cause, light is the effect.** Every audio-reactive motion traces to a measured
   feature. When no feature exists, the room is *ambient*: slow, and never pretending to follow the
   beat.
2. **Silence is still.** Quiet passages and pauses slow the room toward stillness. Decay times are
   used instead of loops.
3. **The room serves the words.** The environment's exposure is capped wherever the lyric needs
   contrast (`DESIGN_SYSTEM.md` §3.4 rule 6).
4. **No spectrum bars.** ECHO does not draw equaliser bars, waveforms or particle fountains. These
   read as screensaver and compete with the type.

---

## 2. Audio sources and what is allowed

### 2.1 Capability matrix

| Source | Can ECHO read samples? | Allowed to analyse? | Environment mode default |
|---|---|---|---|
| **Navidrome** stream through ECHO's same-origin proxy | **Yes.** `<audio>` → `MediaElementAudioSourceNode` → `AnalyserNode`. Same-origin, so not CORS-tainted (Web Audio spec: cross-origin resources without CORS output silence [C]) | Yes: the user's own files on the user's own server | **Reverb** |
| **Dev fixtures** (local files in M3) | Yes, same pipeline | Yes | Reverb |
| **Spotify** Web Playback SDK *(removed 2026-11-03)* | **No.** Audio is decrypted and played inside the EME/Widevine pipeline. The SDK exposes no PCM, analyser or audio-graph access [C: SDK reference lists no such API] | **No.** Developer Policy III.13: "Do not analyze the Spotify Content…" [C]. Audio Features/Analysis endpoints are unavailable to new apps since 2024-11-27 [C] | **Ambient** |

### 2.2 What Ambient means for Spotify (removed)

Removed 2026-11-03 with Spotify. Ambient stays: it is what the room does when no analysis exists
(an analysis failure) or when the user chooses it, with `Features.available = false` and all beat
terms zero (`LYRICS_EXPERIENCE.md` §12.2).

### 2.3 System or tab audio capture: excluded

Capturing system or tab audio through `getDisplayMedia({audio:true})` or a loopback device is **not
implemented** (it was considered for Spotify, whose terms forbid it):

- **UX.** It needs a screen-share permission prompt each session, captures every sound on the
  system, and on Linux tab-audio capture is unreliable.

---

## 3. Feature extraction (Navidrome and fixtures)

### 3.1 Audio graph

```
<audio crossOrigin="anonymous" src="/api/v1/navidrome/stream/:id">
   → MediaElementAudioSourceNode
   → GainNode "replayGain"   (track/album gain from metadata, clamped to avoid clipping by peak)
   → AnalyserNode "tap"      (fftSize 2048, smoothingTimeConstant 0, min/maxDecibels −100/−10)
   → GainNode "volume"       (user volume, perceptual curve v³)
   → destination
```

- The analyser sits **after ReplayGain and before user volume**. Visuals therefore look the same at
  any listening volume, and songs mastered at different loudness react comparably.
- One `AudioContext`, created on the first user gesture (autoplay policy), with
  `latencyHint: 'playback'`.

### 3.2 Per-frame computation (main thread, in the Stage loop)

| Feature | Computation | Smoothing |
|---|---|---|
| Spectrum | `getFloatFrequencyData` → linear power per bin | — |
| `sub` | 20–60 Hz power sum, dB → normalised | attack 10 ms, release 180 ms (one-pole) |
| `bass` | 20–250 Hz | attack 10 ms, release 180 ms |
| `mid` | 250 Hz–4 kHz | attack 25 ms, release 250 ms |
| `high` | 4–12 kHz | attack 5 ms, release 120 ms |
| `flux` | half-wave-rectified spectral flux over 2–12 kHz (log magnitude) | raw |
| `onset` | `flux > median(flux, 1.5 s) + 1.5·MAD(flux, 1.5 s)` and ≥ 120 ms since the last onset → impulse = `min(1, (flux − thr)/thr)` | impulse, then decays in consumers |
| `rms` | time-domain RMS | 300 ms |
| `intensity` | `0.7·norm(rms) + 0.3·norm(onsetRate over 4 s)` | 2 s |

**Normalisation:** each band value is divided by its running **95th percentile over the last 10 s**
(approximated with a 64-bucket histogram per band, decayed by 0.5% per frame). The p95 has a floor
of −60 dBFS, so near-silence stays near zero instead of being amplified. Values are clamped to 0–1.

**Cost target:** ≤ 0.6 ms per frame (1024 bins, 4 bands, one flux). No allocations in the loop.

### 3.3 Latency alignment

The analyser sees samples **before** the listener hears them, by about `outputLatency`. Features are
written into a 1 s ring buffer stamped with `audioContext.currentTime` and read at
`currentTime − outputLatency` (or `baseLatency` when `outputLatency` is unavailable), so the room
reacts to what is audible now. Bluetooth output (~150–300 ms) is covered when the browser reports it.
Lyrics use the separate song clock (`TECHNICAL_ARCHITECTURE.md` §5.2).

### 3.4 The Features object

```ts
interface Features {
  available: boolean;            // false → all below are 0 except intensity = 0.6
  sub: number; bass: number; mid: number; high: number;   // 0..1, smoothed, normalised
  onset: number;                 // 0..1 impulse on the frame of an onset, else 0
  intensity: number;             // 0..1, slow
  bassImpulse: number;           // max(0, d(bass)/dt) normalised, for impulse springs
}
```

### 3.5 Detecting failure

If `available` should be true but the spectrum is all `-Infinity` or zero for 3 s while playing
(taint, a proxy misconfiguration, a codec path that bypasses Web Audio), ECHO sets
`available = false`, switches to Ambient, and logs `features.silent` once with the stream's response
headers.

### 3.6 Offline pre-analysis (post-MVP)

Decoding the whole file (`OfflineAudioContext`) for a beat grid (`web-audio-beat-detector`, MIT
[C]) would allow anticipatory visuals. This is **out of MVP**: real-time features are enough for
ECHO's responsive (not predictive) visuals. Candidate for after M9.

---

## 4. Visual modes

| Mode | When | Character |
|---|---|---|
| **Reverb** | Default when `available` | The room light field plus **wavefront rings** from onsets, with a feedback buffer that lets light decay like a reverb tail. Bass breathes the exposure. |
| **Ambient** | Default when not `available` (an analysis failure), or chosen | The room light field only, moving on internal time at a slow constant rate. No rings, no feedback, no beat terms. |
| **Still** | Reduced motion, Motion = Off, battery-saver choice, tier T3 | One rendered frame of the room. It re-renders only on palette change (with the 1200 ms interpolation shown at 30 fps, then idle at 0 fps). |

The user can choose `Auto` (default: Reverb if available, else Ambient), `Reverb`, `Ambient` or
`Still` in Settings → Visuals. Choosing Reverb when no analysis exists shows
Ambient with a note. Rings without features would be fake.

### 4.1 Room light field (all modes)

The room is a dark space lit by three soft light pools taken from the palette, seen through haze:

- **Base (2026-10-28, owner):** the track's album cover, blurred, under all the room's light.
  It is blurred once (96 px canvas, `blur(5px) saturate(1.4)`, ≈ 75 CSS px across a 1440 px
  stage), sampled as linear light, cropped to the stage like `object-fit: cover`, and drifts with
  the haze's warp (≤ 6% of the cover). Its brightness is the Stage's brightness control (0–100%,
  per device, default 50%, perceptual: `b^2.2` in light). Tracks of one album share it; a new cover
  crossfades over `--dur-palette`. Without a cover, or one WebGL may not read (no CORS), the base is
  the `--art-room` fill. The contrast probe sees the cover, so a bright one darkens the lyric zone.
- **Pools:** two to three large, very soft light pools (radius 0.5–0.9 of stage height) in
  `--art-accent` and `--art-highlight`, at low intensity (0.10–0.22). Their centres move on slow
  Lissajous paths (periods 40–90 s). Their shapes are distorted by **domain-warped fBm noise**
  (2 octaves of warp, 4 octaves of value noise) so they look like light through haze, not circles.
- **Key light:** one tighter pool (radius 0.35 H) behind the active lyric line, centred on the rect
  the lyric layer publishes, in `--art-glow` at 0.12–0.20. It is the "lamp" the words hang under,
  and it follows the active line's rect with a 300 ms low-pass.
- **Vignette** and **scrims** per `DESIGN_SYSTEM.md` §7.6–7.7.

### 4.2 Time bases

- Reverb mode: the warp/flow time advances at `0.04 + 0.10·intensity` units per second, so busier
  music means faster flow.
- Ambient mode: constant `0.05` units per second on `performance.now()`, independent of song
  position. Paused playback slows it to 25% over 1.5 s.

### 4.3 Wavefront rings (Reverb)

The echo, made visible:

- Each onset with impulse > 0.35 spawns a ring at an **emitter**: the key light's centre (70%) or
  a seeded random point on the pools (30%).
- Ring radius grows at `0.55 H/s`. Its intensity follows `I = I₀ · e^{−age/τ}` with
  `τ = 0.45 + 0.6·(1 − intensity)` s (sparse music rings longer, like a bigger room). `I₀ =
  0.10 + 0.12·impulse`, capped at alpha 0.22 (`DESIGN_SYSTEM.md` §7.5).
- Ring profile: a soft band 0.02 H wide, tinted `--art-highlight`, rendered additively into the
  feedback buffer.
- At most **3 rings alive**. A new onset beyond that refreshes the oldest.
- Rings pass *behind* the lyric layer and are masked to 40% intensity inside the reading corridor.

### 4.4 Feedback buffer (Reverb)

- A half-resolution ping-pong render target holds "light energy" (rings plus key-light flares).
- Each frame: `energy = prev · decay + new`, with `decay = 0.90 + 0.06·(1 − intensity)`. The previous
  frame is sampled with a 0.3% zoom toward the key light and a slight curl-noise UV warp (≤ 0.002), so
  light lingers and drifts outward like a reflection.
- Only the energy buffer has feedback. The base room never feeds back, so the room cannot smear or
  accumulate.
- Reduced motion and Ambient: the feedback buffer is cleared and unused.

### 4.5 Bass breathing

`exposure = baseExposure · (1 + 0.10·g·bass)` (where `g` is the motion gain,
`LYRICS_EXPERIENCE.md` §12.2), then passed through the luminance slew limiter (§7.3) and the contrast
cap (`DESIGN_SYSTEM.md` §3.4).

---

## 5. Rendering architecture

### 5.1 Stack

three.js 0.186.1 `WebGLRenderer` (WebGL2) and custom
`ShaderMaterial`s on a full-screen triangle. No scene graph beyond an orthographic camera and one or
two meshes. Owned by `StageRenderer` (`TECHNICAL_ARCHITECTURE.md` §4).

### 5.2 Passes (per frame)

| # | Pass | Resolution | Inputs | Output |
|---|---|---|---|---|
| 1 | **Room** | ½ (T0/T1), ⅓ (T2) | palette uniforms, time, key light rect, exposure | `roomRT` (RGBA16F when available, else RGBA8) |
| 2 | **Energy** (Reverb only) | ½ | `energyRT_prev`, rings (uniform array of 3), key flare | `energyRT` (ping-pong) |
| 3 | **Bloom** | ½ → mip chain | `roomRT + energyRT`, threshold L > 0.85 | bloom texture |
| 4 | **Composite** | full (DPR-capped) | room + energy + bloom, halation, vignette, scrims, tone map, grain (opt), **dither** | canvas |
| 4b | **Glass** (`DESIGN_SYSTEM.md` §7.11) | the glass boxes only | the composite again with the glass: room sampled through the bend, saturation inside, rim light after the tone map | canvas, over pass 4 |
| 5 | **Probe** (every 250 ms) | 8×8 | composite downsample of the safe zone | `roomPeakL` for the contrast solver |

**Liquid glass (2026-10-28):** pass 4b draws the glass of the Stage's controls (the top chrome's
buttons and brightness pill, the dock), up to 8 boxes. It is the composite's own shader compiled
with the glass, drawn as quads over those boxes; the full-screen composite is compiled with an
empty glass function. Measured under SwiftShader, where every instruction runs for every pixel
whatever the branches, glass inside the full-screen composite halved the frame rate; as its own
pass over about a tenth of the pixels it costs about 30% there and next to nothing on a GPU. `engine.ts` measures every attached
non-modal glass element (`ui/glass.ts`) with one ResizeObserver on each of them and the stage, and
uploads their boxes and corner radii (`glassUniforms`, and `glassQuads` for the pass's
geometry); the bend across the rim is a 32-step lookup that
`ui/glass.ts` computes from the `--glass-*` tokens, the same physics as the SVG filter. The room
sample (and Reverb's energy) is taken through the bend; saturation applies inside each box and the
rim light after tone mapping. All of it is scaled by the chrome level, so it fades with the controls
(Still snaps it: no moving bend under reduced motion). The controls keep only their CSS tint while
WebGL draws; with the CSS room they use the SVG or blur glass instead (§9).

**As built (M5):** bloom and halation are a small blur of the energy buffer inside the composite, not a
separate mip-chain pass (`docs/reviews/M5.md`); revisit if the look needs more.

- **Tone mapping:** a simple filmic curve (Hable-style, exposure-driven) in linear space, then sRGB
  encode. Palette colours are converted OKLab → linear sRGB in JS before upload.
- **Halation** (`DESIGN_SYSTEM.md` §7.3): the composite blurs the bloom texture once more, shifts it
  toward red (multiplies by `(1.0, 0.55, 0.35)`) and adds it at 0.08–0.18 strength around the key light
  only.
- **Dither:** a 64×64 blue-noise texture, ±1 LSB, the last operation. It is always on, including in
  Still mode.
- **Grain** (optional): luminance-only, 2–3%, its noise offset updated at 24 fps.

### 5.3 The lit word as a light source

Each frame the lyric layer publishes `activeWordRect` (screen px) and `glowLevel`. The composite adds
a small elliptical flare (`--art-glow`, intensity `0.25·glowLevel`) behind it, which feeds bloom and
halation. The DOM glyphs stay crisp. The halo lives in the room, so the word appears to emit light.

### 5.4 Contrast probe

The probe pass renders the composite's safe zone into an 8×8 RGBA8 target and reads it back every
250 ms with `readPixels` (64 pixels, negligible stall; a fence-sync async read is used where
supported). It computes the 95th-percentile OKLab L, `roomPeakL`, which feeds the contrast solver
(`DESIGN_SYSTEM.md` §3.4). If the target is not met, the solver lowers a `lyricZoneExposure` uniform
(a radial mask around the reading corridor), slew-limited at 0.5/s, down to −40%.

### 5.5 Canvas and DPR

- Canvas fills the stage. Backing store: `min(devicePixelRatio, 1.5)` at T0, `1.25` at T1, `1.0` at T2
  and T3.
- `ResizeObserver` drives resize. Render targets are recreated only when the size changes by more
  than 2%.

### 5.6 Context loss

On `webglcontextlost`: stop the loop, show the CSS fallback room (§9), and on
`webglcontextrestored` rebuild all targets and materials and resume. A Playwright test forces this via
`WEBGL_lose_context` (`ACCEPTANCE_CRITERIA.md` VIS-07).

---

## 6. Artwork colour extraction

### 6.1 Where and from what

Extraction runs **on the server** (`src/server/palette/`), once per album, so every client (web
today, desktop and mobile later) and every user gets the identical palette, and clients do no image
work.

- **Navidrome:** the server fetches `getCoverArt?id=…&size=256` directly from Navidrome over the
  compose network, using the requesting user's credentials.
- **Decode:** `sharp` → resize to 128×128 (`fit: 'fill'`, sRGB), raw RGBA pixels. Target ≤ 150 ms
  per cover on the OptiPlex (i7-3770), including fetch from the local Navidrome (VIS-03).

### 6.2 Algorithm

1. Read pixels and **drop a 3% border** on every side (frames, borders and edge text are common).
2. Drop pixels with alpha < 0.5.
3. Quantise with `QuantizerCelebi.quantize(pixels, 24)`. Score candidate colours with `Score.score`
   (material-color-utilities 0.4.0, Apache-2.0 [C]). Keep the **population** map for dominance.
4. Convert all clusters to OKLCH (ECHO's own conversion functions, `src/shared/oklab.ts`).
5. Assign roles (`DESIGN_SYSTEM.md` §3.3):
   - `dominant` = the highest-population cluster.
   - `accent` = argmax over clusters of `population^0.5 · C` with `C ≥ 0.04`, skipping clusters
     within ΔE_ok < 0.04 of `dominant` when an alternative of ≥ 5% population exists. If none has
     `C ≥ 0.04`: **achromatic** (step 7).
   - `highlight` = the lightest cluster with `C > 0.04` and population ≥ 2%, else `accent` with
     L → 0.90.
6. **Constrain** each role into its OKLCH box (`DESIGN_SYSTEM.md` §3.3). Lightness is clamped. Chroma
   is compressed with a soft knee (`C' = Cmax·tanh(C/Cmax)`). Hue is kept. Out-of-gamut values are
   gamut-mapped to sRGB by **reducing chroma** at constant L and h (binary search, 8 steps), not by
   channel clipping.
7. **Achromatic covers** (all clusters `C < 0.02`): `accent` = Sodium `#E3B26B`, `room` =
   `oklch(0.16 0.006 250)`, `highlight` = `oklch(0.92 0.04 80)`. No hue is invented from noise.
8. **Mostly white covers** (dominant L > 0.85): `room` is taken from the darkest meaningful cluster
   (population ≥ 3%). If none exists, the neutral room is used with the cover's hue at C ≤ 0.03. The
   room is never light.
9. **Neon or very saturated covers:** step 6's soft knee keeps `accent` at C ≤ 0.18 and `room` at
   C ≤ 0.10, giving a "smoked" room even for neon covers.

Output: `Palette { room, accent, highlight, glow, shadow, inkActive, source: 'art'|'fallback', version: 1 }`.
`palette.version` lets cached palettes be invalidated when the algorithm changes.

### 6.3 Caching

`GET /api/v1/palette/:albumKey` returns the cached palette, or computes and caches it on a miss
(concurrent requests for the same key share one computation). The cache is shared across users,
because a palette contains no user data. TTL: none (invalidated by `palette.version`). Colour arrives in one round trip, typically before
the artwork pixels. Targets, measured at the client: ready ≤ 150 ms after a track change when
cached, ≤ 600 ms when not (`ACCEPTANCE_CRITERIA.md` VIS-03).

**Prefetch:** when the next track is known, the client requests its palette in the background.

### 6.4 Transitions between tracks

- Interpolate every role **in OKLab** (Cartesian) over `--dur-palette` = 1200 ms with
  `--ease-in-out`. OKLab avoids hue-wrap artefacts and the random hues near zero chroma that OKLCH
  hue interpolation produces [C: CSS Color 4 discussion; MDN].
- If a new target arrives mid-transition (rapid skip), the transition restarts **from the current
  interpolated value**. Colour is always continuous.
- CSS variables update each frame during a transition and stop updating when it settles.
- Reduced motion keeps the 1200 ms colour transition (colour is not motion).

### 6.5 Contrast solving

After interpolation, each frame, the lyric ink roles are re-checked against `roomPeakL`
(`DESIGN_SYSTEM.md` §3.4). This is cheap: one OKLab → luminance conversion per role.

---

## 7. Audio-reactive mapping (environment)

### 7.1 Mapping

| Feature | Environment response | Range |
|---|---|---|
| `bass` | exposure breathing (§4.5); pool radius +6% | slew-limited |
| `sub` | key-light radius +8%, a very slow "pressure" swell | — |
| `onset` | wavefront ring spawn (§4.3); key flare +0.15 for 120 ms | ≤ 3 rings |
| `mid` | pool drift speed ×(1 + 0.3·mid); key light warmth (hue shift toward highlight ≤ 6°) | — |
| `high` | energy-buffer warp amplitude ×(1 + 0.5·high) | ≤ 0.003 UV |
| `intensity` | flow speed (§4.2), feedback decay (§4.4), ring τ (§4.3), motion gain `g` | — |

### 7.2 Calm and intense passages

At `intensity < 0.2`: no rings below impulse 0.5, flow at minimum, exposure breathing ±3%.
At `intensity > 0.75`: rings at full rate, flow ×1.6, breathing ±10% (Balanced). The intensity
setting (§7.4) scales these.

### 7.4 Intensity setting (`visuals.intensity`, default **expressive**)

The owner chose **Expressive** as the default. The setting multiplies the environment's responses
**before** the photosensitivity limiter (§7.3), which always has the last word:

| Parameter | Subtle | Balanced | **Expressive (default)** |
|---|---|---|---|
| Exposure breathing (max) | ±5% | ±10% | ±15% |
| Ring spawn threshold (impulse) | 0.55 | 0.35 | 0.25 |
| Ring `I₀` cap (alpha) | 0.12 | 0.22 | 0.22 (cap unchanged: `DESIGN_SYSTEM.md` §7.5) |
| Rings alive (max) | 2 | 3 | 3 |
| Flow speed at high intensity | ×1.3 | ×1.6 | ×2.0 |
| Pool radius response to bass | +3% | +6% | +9% |
| Feedback decay (longer trails) | −0.02 | ±0 | +0.02 (cap 0.97) |
| Background-lyric beat kicks and drift change (`LYRICS_EXPERIENCE.md` §12.2) | ×0.5 | ×1.0 | ×1.5 |
| Active line and transition zone | **identical at every setting** | | |

Reduced motion overrides the setting (Still mode). The quality tier can remove effects (e.g. no
feedback at T2) regardless of intensity.

### 7.3 Photosensitivity guard (hard limit)

WCAG 2.3.1 defines a flash as a pair of opposing changes in relative luminance of ≥ 10% of maximum
(where the darker state is below 0.80), and allows no more than 3 per second over a significant area
(~25% of a 10° visual field, roughly 341×256 px at 1024×768) [C: W3C Understanding 2.3.1]. ECHO
stays far below this:

- **Global and regional luminance slew limit:** the environment's mean relative luminance over any
  region ≥ 10% of the stage must not change by more than **0.08 within any 333 ms window**, so no
  flash pair can occur at all. This is implemented as a slew limiter on every luminance-driving
  uniform (exposure, ring intensity sum, flare) at ≤ 0.24/s combined.
- **No saturated red flashes:** ring and flare tints are clamped so `R/(R+G+B) < 0.8`.
- **Verification:** an automated Playwright check records 10 s at 30 fps of a stress fixture (a
  techno kick pattern at 140 BPM with full-band transients). It computes the mean luminance of a 4×4
  grid of regions per frame and asserts the slew limit (`ACCEPTANCE_CRITERIA.md` A11Y-08).

---

## 8. Performance and quality tiers

### 8.1 Tiers

| Tier | DPR cap | Room res | Energy/feedback | Bloom | Rings | Halation | Grain | Lyric background budget | Glass (§5.2) |
|---|---|---|---|---|---|---|---|---|---|
| **T0 High** | 1.5 | ½ | yes | yes (5 mips) | 3 | yes | opt | 24 | bend, rim light, saturation |
| **T1 Balanced** | 1.25 | ½ | yes | yes (3 mips) | 2 | yes | opt | 12 | bend, rim light, saturation |
| **T2 Low** | 1.0 | ⅓ | no | no | 1 (no feedback, direct draw) | no | no | 6 | rim light, saturation |
| **T3 Minimal** | 1.0 | — | — | — | — | — | — | 0 (Still mode: one frame per palette change) | tint only |

The glass column is `GLASS_BY_TIER` in `governor.ts`: the bend is the only part that reads the room
through a dependent fetch, so it is the first to go.

### 8.2 Governor

- Measures the frame interval (rAF deltas) as an EMA (α = 0.1). It also measures GPU time with
  `EXT_disjoint_timer_query_webgl2` when available.
- **Target:** `1000 / refreshRate`. The refresh rate is estimated from the median of 60 rAF deltas
  at startup (60/120/144 Hz).
- **Step down** one tier if the EMA exceeds `1.15 × target` for 1.0 s, or GPU time exceeds
  `0.6 × target` for 1.0 s.
- **Step up** one tier if the EMA is at full refresh (`≤ 1.05 × target`) and GPU time below
  `0.4 × target` for 8 s, and no change has happened in the last 20 s (hysteresis). *Corrected
  2026-10-28:* this read "EMA below `0.8 × target`", which vsync-locked frames can never show, so a
  step down was for ever. With full refresh as the test, a step up is a probe: a tier that cannot
  hold steps down again after 1 s, at most one change per 20 s.
- **Floor:** on its own the governor goes no lower than **T2**. T3 is Still (a frozen room) and is a
  manual choice; in Still nothing is measured, so an automatic T3 could never come back. A remembered
  T3 is ignored at start.
- **Never** change tier during the first 3 s of a track (shader compile / art decode spikes) or
  during a scrub.
- **Per-device memory:** ECHO clients run on very different hardware (a laptop iGPU, a gaming PC).
  Each device remembers its last stable tier in `localStorage` and starts there. A first run starts
  at T1, plus T0 if `WEBGL_debug_renderer_info` reports a discrete GPU.
- User override: Settings → Visuals → Quality: `Auto` (governor) / `High` / `Balanced` / `Low` /
  `Minimal`. It is stored per device. A manual choice disables the governor except for an emergency step-down below 20 fps
  sustained for 3 s.

**As built (M9):** `src/client/stage/governor.ts`, fed by the engine on frames that draw the room;
GPU time is not wired yet (the frame-interval EMA alone decides). The lyric field keeps the tier it
was mounted with until the Stage is reopened; the room follows every change. Unit tests: PERF-02.

### 8.3 Budgets (reference machine, `ACCEPTANCE_CRITERIA.md` §0)

- T0 at 2560×1440: GPU ≤ 8 ms per frame, total main thread ≤ 6 ms (stage loop ≤ 4 ms, of which lyric
  field ≤ 2.5 ms and features ≤ 0.6 ms).
- Hidden tab: 0 frames (the loop stops). Window visible but minimised to a small size: normal.
- Shader compile on first open: < 250 ms. Shaders are compiled at app start behind the shell, not on
  first play.

---

## 9. Fallbacks

| Failure | Behaviour |
|---|---|
| WebGL2 unavailable | **CSS room**: `--art-room` background, two radial-gradient light pools in `--art-accent`/`--art-highlight` at 14% alpha, with a 128px tiled blue-noise PNG overlay at 3% to prevent banding. Palette transitions via CSS custom properties. Lyrics unaffected. Settings shows "Visuals limited: WebGL 2 isn't available in this browser." |
| Context lost | CSS room until restored (§5.6) |
| Either of the two above | The Stage's glass controls use the SVG or blur glass (`DESIGN_SYSTEM.md` §7.11) |
| Feature extraction silent | Ambient (§3.5) |
| Artwork fails to load | fallback palette, `palette.source = 'fallback'` |
| Low tier or reduced motion | Still mode, with lyric degradation per `LYRICS_EXPERIENCE.md` §13 |

---

## 10. Deterministic mode (tests)

`?frame=<ms>&seed=<n>&fixture=<name>&tier=<T0..T3>` renders a single frame at song time `<ms>` with
features from a recorded fixture track (a JSON of per-frame Features), fixed noise seeds, and the
governor disabled. Used by Playwright visual snapshots and by design review screenshots
(`IMPLEMENTATION_PLAN.md` M2–M4).

`fixture` names a hand-authored track (`src/client/fixtures/feature-tracks.ts`: `ballad`, `pop`,
`techno`, `silence`; pure functions of song time), a recording, or a lyric fixture
(`LYRICS_EXPERIENCE.md` §16), which supplies its paired track and, when `track` is absent, cues its
guide track at `<ms>`.

Recording format (development builds; `src/client/fixtures/features/<name>.json`):
`{ "fps": <n>, "frames": [<Features>, …] }`, one Features object (§3.4) per frame at `fps`. Song
time `t` reads frame `floor(t · fps / 1000)`; before the first frame or after the last, the end
frame holds. Every level is in 0..1. An unknown or invalid fixture is reported on the console and
the frame renders without it.
