# ECHO — The Floating Lyrics Experience

Status: **Draft 2 — normative for the lyric field (F2)** · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Design system](DESIGN_SYSTEM.md) (tokens, type, colour roles) · [Visualizer](VISUALIZER_SPEC.md) (audio features, palette, quality tiers) · [Lyrics integration](LYRICS_INTEGRATION.md) (where lyric data comes from, `LyricsDoc` schema) · [Acceptance criteria](ACCEPTANCE_CRITERIA.md) §LYR

This is ECHO's signature feature and the most detailed spec in the pack. Everything here is meant to
be implementable without guessing. Every number lives in one tuning file (`lyricsConfig.ts`, §15) so
it can be adjusted by eye in M3 without hunting through code.

Prior-art numbers (AMLL, Spicy Lyrics, Beautiful Lyrics) were read from their source code during
research (`DESIGN_RESEARCH.md` §3.2). ECHO uses them as **reference values**. ECHO is itself
AGPL-3.0, so code from **Spicy Lyrics** (AGPL-3.0) *may* be reused, with its copyright and licence
notices kept and the origin noted in a comment. Code from AMLL and Beautiful Lyrics may not be
copied until their licences are confirmed compatible.

---

## 1. The idea

> A lyric line lives like an echo in a room. It **approaches** as a wavefront from the distance,
> **peaks** in focus at the moment it is sung, and **decays** into the room like a reverb tail.

Three consequences shape every decision below:

1. **Time is depth.** How far a line is from the listener (on screen: lower, smaller, dimmer, softer)
   is a function of *how long until it is sung*, computed from timestamps every frame. No line has a
   fixed screen slot; slots are derived from time and line sizes (§4).
2. **The present is still.** The line being sung does not drift while it is read. Everything else
   moves around it.
3. **The room responds, the words stay legible.** Music drives the room hard and the text gently,
   within caps that protect reading (§12).

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| `t` | Song time in ms from `SongClock.now()` (latency-corrected, offset-adjusted; `TECHNICAL_ARCHITECTURE.md` §5.2) |
| Line `L` | One lyric line: `start`, `end`, `words[]` (may be empty), optional `background` (backing vocals), `agent` (vocalist id), `oppositeAligned` (duet) |
| Word `w` | `text`, `start`, `end`, `isPartOfWord` (syllable joins to the next without a space) |
| Sync level | `word` (per-word/syllable times), `line` (line start/end only), `none` (static text). Defined by `LyricsDoc.sync` (`LYRICS_INTEGRATION.md` §5) |
| `H`, `W` | Stage height (window height minus dock, 88px) and width, in CSS px |
| `z` | Depth, 0 (the active plane) to 1 (the far background). Drives scale, opacity, blur |
| Rank `r` | Line order relative to the active line: `0` active, `+1…+3` upcoming (the **transition zone**), `≥ +4` background, `−1, −2` past |
| Hand-over | The moment the active line gives way to the next (§5.3) |

### 2.1 Line states

```
  BACKGROUND ──enter zone──► APPROACHING(+3 → +2 → +1) ──hand-over──► ACTIVE ──hand-over──► DECAYING ──► GONE
  (rank ≥ +4)               (transition zone)                         (rank 0)                (rank −1,−2)
```

Each word has states: `unsung` → `lit` (sweep in progress) → `sung`.

---

## 3. Stage geometry

### 3.1 Coordinate system

Origin top-left of the stage, `x` right, `y` down, in CSS px. The lyric layer is a full-stage
`<div>` above the WebGL canvas. Each line is an absolutely positioned element at `(0,0)`, moved only
with `transform: translate3d(x, y, 0) scale(s)` and centred on its anchor point.

### 3.2 Anchors and zones (at 1440×900, `H` = 812)

| Element | Anchor | Value | At 1440×900 |
|---|---|---|---|
| Active line centre | `y = 0.40 H` | horizontal centre `x = 0.5 W` | y = 325 |
| Transition zone (+1…+3) | below the active line, stacked by size and time (§4.3) | must end above `0.86 H` | ≤ 698 |
| Past lines | above the active line, rising | up to `0.10 H` | ≥ 81 |
| Background field | whole stage, excluding the **reading corridor** | — | — |
| Reading corridor | `x ∈ [0.12 W, 0.88 W]`, `y ∈ [active.top − 0.04 H, zone.bottom + 0.02 H]` | Background lines may pass through it only at `z ≥ 0.85` and opacity ≤ 0.10 | — |
| Safe zone for contrast | central 76% W × 70% H above the dock | contrast sampling region (`DESIGN_SYSTEM.md` §3.4) | — |

Why 40%: the upcoming lines need room *below* the active line, and 40% sits on the optical centre of
the area above the dock. With the chrome visible, the top bar (56px) never overlaps past lines,
because past lines fade before reaching `0.10 H`.

### 3.3 Layout of a single line

- Every line is laid out **once** per document and per resize at `--ly-active` size, with
  `text-wrap: balance`, a max width of `0.64 W` (≈ 22 characters per row at 56px), centred text, and
  at most 2 rows. A line needing 3 rows shrinks by up to 12% (`DESIGN_SYSTEM.md` §4.3); if it still
  needs 3 rows, 3 rows are allowed.
- Measured box: `h_L` (height) and `w_L` (width) at scale 1. Depth scaling is applied by transform,
  so the box never reflows when a line changes state.
- Words are `<span>`s inside the line. A syllable with `isPartOfWord` joins the next span with no
  space. Graphemes are segmented with `Intl.Segmenter` only when a word needs per-letter emphasis
  (§5.5).

---

## 4. Time → space: the depth model

### 4.1 Depth functions

Every visual property of a line is a function of its **rendered** depth `z` (the spring output,
§6). Opacity, blur and scale therefore follow the motion automatically, and there is a single source
of truth.

| Property | Function / table (linear interpolation between points) |
|---|---|
| Scale `s(z)` | `1 − 0.30 z` → z=0: 1.00 · 0.2: 0.94 · 0.4: 0.88 · 0.6: 0.82 · 1.0: 0.70 |
| Opacity `o(z)` (upcoming and background) | z=0: 1.00 · 0.22: 0.74 · 0.44: 0.54 · 0.66: 0.40 · 0.80: 0.24 · 1.0: 0.12 |
| Blur `b(z)` (CSS px) | z=0: 0 · 0.22: 1.0 · 0.44: 2.0 · 0.66: 3.2 · 0.80: 4.0 · 0.9: 6.0 · 1.0: 8.0 (cap 4px while rank ≤ +3) |
| Ink colour | rank 0: `--lyric-ink-active` (unlit), lit per §5 · ranks ≠ 0: `--lyric-ink-active` mixed 18% toward `--art-room` per 0.33 z (`color-mix(in oklab, …)`) |

Contrast floors from `DESIGN_SYSTEM.md` §3.4 apply after these functions. If the floor for +1…+3
fails, the room is darkened. The line's opacity is never raised, because that would collapse the
depth hierarchy.

### 4.2 Depth targets per rank

| Rank | Target `z` | Notes |
|---|---|---|
| 0 (active) | 0 | Never drifts while active (§1, principle 2) |
| +1 | `0.22 · g₁` | `gᵢ` = time-gap factor (§4.3) |
| +2 | `z₊₁ + 0.22 · g₂` | |
| +3 | `z₊₂ + 0.22 · g₃` | capped at 0.72 |
| ≥ +4 (background) | assigned per line, 0.78–1.0 by time distance (§8.2) | |
| −1 (decaying) | 0 → 0.35 over the decay (§7) | |
| −2 | continues decaying | removed when opacity < 0.02 |

### 4.3 Vertical stacking: time becomes space

The transition zone stacks lines below the active line. The **gap between two consecutive lines
grows with the time between them**, so a line that comes much later sits visibly further away.

```
gᵢ   = clamp( (startᵢ − startᵢ₋₁) / 3200 ms , 0.8 , 1.5 )        // time-gap factor
gapᵢ = 0.040 H · gᵢ                                                // px between boxes
yᵢ   = yᵢ₋₁ + (h_{i−1}·s(z_{i−1}) + hᵢ·s(zᵢ)) / 2 + gapᵢ            // centre of rank i
```

- `y₀ = 0.40 H` (active). Line boxes use their *target* scale, so stacking is stable while springs
  move.
- **Overflow:** if the bottom of +3 would pass `0.86 H`, all three gaps are scaled down uniformly to a
  minimum of 0.5× each. If it still overflows (very long wrapped lines), +3 takes its background
  depth instead (it stays at `z = 0.78`, opacity 0.24, behind +2) until room appears.
- **Approach drift (the "slow float upward"):** while the active line is being sung, each upcoming
  line already moves part of the way toward its next slot:

```
φ = clamp( (t − active.start) / (handoverAt − active.start) , 0 , 1 )   // progress through the active line
drift = 0.30 · easeInOutSine(φ)
target_y(rank k) = lerp( slotY(k), slotY(k−1), drift )      for k = 2, 3
target_y(rank 1) = lerp( slotY(1), slotY(1) − 0.35·(slotY(1) − y₀ − h₀/2 − h₁·s/2 − 0.02H), drift )
target_z(rank k) = lerp( z(k), z(k−1), drift )               (rank 1: toward 0 but stops at 0.65·z₊₁)
```

  Upcoming lines therefore glide continuously at a speed set by the song's actual pacing. A slow
  ballad line drifts slowly over 6 s; a rap line drifts fast over 1.2 s. Rank +1 never gets closer
  than 0.02 H to the active line's box, so they never overlap.

### 4.4 Horizontal placement

- Default: all lines centred at `x = 0.5 W`.
- **Duets** (`oppositeAligned` or ≥ 2 distinct `agent`s): lines of the primary agent anchor at
  `x = 0.42 W` with `text-align: left` relative to a left edge at `0.18 W`. Opposite-aligned lines
  anchor right, ending at `0.82 W`. The field keeps this two-sided arrangement for the whole song
  (decided once at document load), so lines never jump sides mid-song. Without any
  `oppositeAligned` flag, the first agent goes left and the others right. Lines of a `group` agent
  (everyone singing) stay centred (M3).
- A small horizontal **parallax** (§8.4) applies to background lines only.

---

## 5. Word illumination

### 5.1 The sweep (word-timed lyrics)

For each word in the active line:

```
p_w = clamp( (t − w.start) / max(w.end − w.start, 60 ms) , 0 , 1 )
```

`p_w` moves **linearly in time**. Linear is honest: the light moves as the voice moves. Easing would
make it lead or lag the vocal.

**Rendering.** Each word span uses a single gradient through `background-clip: text`, with
`color: transparent`. The gradient's position is driven by one registered custom property `--p`
(`@property --p { syntax: '<percentage>'; inherits: false; initial-value: 0% }`), written **only for
the word currently sweeping**:

```
background-image: linear-gradient(90deg,
   var(--lit)        calc(var(--p) - 0.60em),     /* settled lit colour            */
   var(--lit-edge)   var(--p),                    /* bright leading edge           */
   var(--unlit)      calc(var(--p) + 0.35em));    /* not yet sung                  */
```

| Variable | Value |
|---|---|
| `--unlit` | `--lyric-ink-active` mixed 22% toward `--art-room` (≥ 7:1 vs room up to a room of L 0.30; `DESIGN_SYSTEM.md` §3.4). At 100% ink the sung and unsung words were nearly the same colour and the sweep barely read (M3 design review) |
| `--lit-edge` | `--art-highlight` |
| `--lit` | `color-mix(in oklab, var(--text) 82%, var(--art-highlight))` (warm white tinted by the cover) |
| Edge softness | 0.35em ahead of the edge, 0.60em behind it (prior art: 0.5em AMLL, 0.55em Spicy) |

Words before the sweeping word are fully `--lit` (static gradient, no writes). Words after it are
fully `--unlit`. Per frame the cost is **one property write on one span**. The previous word is
written once more to settle at `--p: 100%`.

**Sweep across syllables:** syllables of one word (`isPartOfWord`) share a visual word. The sweep
moves through each syllable span with its own timing and no gap, so the light reads as continuous.

**Lift:** unsung words of the lead line sit 0.05em low; a word rises to its baseline when the sweep
reaches it, over `--dur-lift` (700 ms, `--ease-out`), a CSS transition on the class the sweep
already sets (no per-frame writes). Scrub and still frames snap; reduced motion has no lift.

**Gaps inside a line:** if the next word starts more than 300 ms after the previous ends, the light
rests at the end of the previous word (a sustained "hold"), with no pre-lighting of the next word.

### 5.2 Glow

- The **currently sweeping word** gets a glow: `filter: drop-shadow(0 0 R <glow colour>)`, with
  `R = 0.18em` and alpha 0.35 by default, modulated by vocal sustain (§12.3) up to `R = 0.26em`,
  alpha 0.55. A drop-shadow, not a `text-shadow`: a text-shadow paints over the
  `background-clip: text` fill and veils the sweep (M1 specimen finding). The colour is
  `--art-glow` without its alpha (`--art-glow-solid`), at the glow's own alpha.
- When the word ends, its glow decays exponentially (τ = 220 ms) while the next word's glow rises
  over 90 ms. At most two words glow at once. §12.5's slew limit (1.5/s) takes precedence over both:
  a rise to 0.35 takes at least 233 ms, and when two words are still fading, the older fades at that
  limit and the next word's glow waits for it, so no glow is ever cut (M3).
- Glow is never applied to the whole line, and never to non-active lines (prior art agrees: glow is
  for held words only).
- **Halation** and **bloom** on the lit word happen in the WebGL composite (`VISUALIZER_SPEC.md`
  §5.3). The lyric layer publishes the active word's screen rectangle each frame so the renderer can
  place a light source behind it. The DOM text itself stays crisp.

### 5.3 Hand-over (active → next)

```
lead       = clamp( next.start − active.lastWord.end , 120 ms , 300 ms )
handoverAt = next.start − lead
```

- If there is a gap of ≥ 300 ms between the active line's last word and the next line, the hand-over
  starts 300 ms before the next line, so the incoming line has largely settled (a critically damped
  spring covers ~90% of its travel in ≈ 300 ms at the default frequency) when its first word sounds.
- If lines are back to back, the lead shrinks to 120 ms. The outgoing line starts moving 120 ms
  before it ends, while its last word's sweep is already ≥ 85% done.
- **Line-timed lyrics** use `active.end` (or `next.start` when `end` is missing) instead of
  `lastWord.end`.
- At `handoverAt`: ranks shift by one (`+1 → 0`, `0 → −1`, `+k → +k−1`), the new +3 is promoted from
  the background (§8.5), and new spring targets are set with a **stagger** (§6.3).

### 5.4 Scripts and direction

- **RTL lines** (`dir="rtl"`, detected per line with the first strong character): the sweep runs
  right to left (`linear-gradient(270deg, …)`) and `--p` is measured from the right.
- **CJK:** each character is typically its own timed unit. No tracking. Emphasis (§5.5) depends on
  duration only, not character count.
- **Mixed-script lines:** the line's base direction decides the sweep direction. Embedded opposite-
  direction runs sweep with the line (an accepted simplification, recorded in Q-LY-3).

### 5.5 Emphasis on held words

A word sung for a long time gets a subtle, physical emphasis, so long notes look different from
short ones:

- **Trigger:** word duration ≥ 1000 ms **and** 2–7 graphemes (CJK: duration only). Never for words
  < 150 ms (rap). Sources: all three prior-art renderers use ≥ 1000 ms.
- **Effect:** the word splits into grapheme spans (prepared at layout for qualifying words). Each
  grapheme gets:
  - **Lift:** `translateY` to −0.05em, starting **400 ms before** the word's start (anticipation,
    as in AMLL), on a spring (f = 1.2 Hz, ζ = 0.75).
  - **Swell:** scale to `1 + 0.05·a`, where `a = min(1.2, (dur − 1000)/1500 + 0.6)`; the last word of
    a line gets `a × 1.4`, capped at a +8% swell. Graphemes start in sequence, `dur / 2.5 / n` apart.
  - **Glow:** the word's glow follows its graphemes' peak.
  - The emphasis releases **250 ms before** the word ends, so the line is calm again before the
    hand-over.
- **Caps:** swell ≤ 8%, lift ≤ 0.08em. The prior-art maximum of +12% swell was judged too much for
  ECHO's larger type.

### 5.6 Background vocals and multiple vocalists

- **Background vocals** (Spicy `Background[]`, TTML `x-bg`, or parenthesised text in line-timed
  sources) render as a sub-line **under** their lead line at `0.62×` size, opacity `0.55 ×` the
  lead line's opacity, with the same sweep logic on their own timestamps. They enter with the lead
  line (no separate rank). Their glow alpha is capped at 0.2.
- **Agents / duets:** §4.4. The `--lit` colour of the secondary agent is mixed 25% toward
  `--art-accent` so two voices are distinguishable by colour as well as position. Position alone is
  enough for colour-blind users.

---

## 6. Motion model

### 6.1 Springs

All movement of lines (`y`, `z`, `x`) uses a damped harmonic oscillator parameterised by
**frequency `f` (Hz)** and **damping ratio `ζ`**, integrated in **closed form** per frame. A step is
exact for a constant target over `dt`, so it is stable at 30, 60, 120 and 144 Hz. `dt` is clamped to
100 ms, so a sleeping tab never produces a giant jump.

| Spring | f (Hz) | ζ | Settle (2%) | Used for |
|---|---|---|---|---|
| `line.normal` | 2.0 → 2.35 (adaptive, below) | 1.0 | ≈ 0.39–0.46 s | `y`, `z` of ranks −1…+3 at hand-over |
| `line.slow` | 1.45 | 1.0 | ≈ 0.64 s | after seek, after interlude, first line, end of song. Critically damped since the M3 tuning session: at ζ 0.85, +1 sank back by up to 0.44 px while it settled (LYR-05) |
| `line.enter` | 1.1 | 0.95 | ≈ 0.76 s | background line entering the transition zone |
| `emphasis.lift` | 1.2 | 0.75 | — | §5.5 |
| `beat.impulse` | 2.0 | 0.5 | — | §12 (bass and onset kicks) |
| `bg.drift` | — | — | — | not a spring: deterministic paths (§8.3) |

Adaptive line frequency (from the AMLL mapping: faster lyrics, stiffer spring):

```
n    = clamp( (next.start − active.start − 100) / 700 , 0 , 1 )   // 0 = lines 100 ms apart, 1 = ≥ 800 ms
f    = 2.0 + 0.35 · (1 − n)^0.2
```

Settle times are for the exact solution from rest (M3 task 5, checked against RK4). Below ζ = 1 the
overshoot stays inside the 2% band, so `enter` settles sooner than the draft's estimate (0.85 s).

Equivalent AMLL stiffness at mass 1: k = (2πf)² ≈ 158–218. This matches AMLL's 170–220 range.

### 6.2 Targets are functions of time

Spring targets are recomputed every frame from `t` (§4.3 drift, §5.3 hand-over). Springs add weight
and absorb discontinuities. They never decide *where* a line goes, only *how* it gets there. If the
clock jumps (seek), targets jump and the springs carry the lines there (§9.6).

### 6.3 Stagger

At a hand-over, new targets apply with a cascading delay: rank −1 (outgoing) at 0 ms, then +1 (new
active) at 0 ms, +2 at 50 ms, +3 at `50 + 50/1.05` ≈ 98 ms, and the entering line at ≈ 143 ms. The
lines move as a ripple, not as a rigid block (AMLL: 50 ms decaying by ÷1.05). Stagger is **disabled**
for seek, resize, document swap and reduced motion.

### 6.4 Two clocks

Lyric motion runs on the **song clock**. UI feedback (chrome fade, toasts) runs on the UI clock
(`DESIGN_SYSTEM.md` §11). They never share easing or timing constants.

---

## 7. Sung lines: the reverb tail

A line that leaves the active position **decays**:

| Property | Behaviour |
|---|---|
| Position | spring (`line.normal`) to rank −1: `y = y₀ − (h₀/2 + 0.035 H + h·s/2)`, then a slow linear rise of `0.05 H` over its decay |
| Depth | `z` 0 → 0.35 over the decay (recedes) |
| Opacity | exponential envelope `o = o_start · e^{−(t − t_h)/τ}`, τ = 520 ms (≈ −60 dB visual decay in ~1.4 s). Removed from the DOM when `o < 0.02` (≈ 2 s) |
| Blur | 0 → 6 px following `1 − e^{−(t−t_h)/τ}` |
| Lit colour | stays lit, then desaturates toward `--lyric-ink-active` with the same envelope (the light dies, not the words) |
| Count | at most 2 decaying lines. A third hand-over removes the oldest immediately (fade over 120 ms) |

Words stay lit while decaying. The listener sees what was just sung, fading. Nothing accumulates into
a static block.

---

## 8. The background field: the rest of the song

All unsung lines beyond +3 float in the background, suggesting the rest of the song around the
listener without competing with the active line.

### 8.1 Population

- Candidates: every line with rank ≥ +4.
- **Render budget:** at most 24 lines (tier T0), 12 (T1), 6 (T2), 0 (T3/reduced; §10, §13). The
  budget takes the **nearest in time** first. Lines further out are not in the DOM.

### 8.2 Placement and depth

- Each background line gets a home position from a **seeded** blue-noise (Poisson-disc) sampler over
  the stage minus the reading corridor (§3.2). The seed is `hash(trackKey)`, so the same song always
  arranges the same way, and two songs differ.
- Minimum distance between home centres: `0.16 H`. Each line is scaled per its depth before the
  check.
- Lines are wide (up to `0.64 W × s(z)`), so a line's centre is kept in far enough that its whole
  box stays on stage with a `0.02 W` margin. In practice most background lines overlap the reading
  corridor (§3.2) and carry its caps (z ≥ 0.85, opacity ≤ 0.10); the caps ease in over `0.02 H`
  outside the corridor, so they are complete at its edge and nothing pops (M3).
- Depth by time distance: `z = 0.78 + 0.22 · clamp((line.start − t) / 60 000 ms, 0, 1)`. Lines due
  within a minute sit in the near background; lines further out sit deepest.
- **Depth buckets** for blur (performance, §13): B1 `z ∈ [0.78, 0.86)` blur 4 px, B2 `[0.86, 0.94)`
  blur 6 px, B3 `[0.94, 1.0]` blur 8 px. Each bucket is one container with one `filter: blur()`.
  Lines move between buckets only when they are re-homed (§8.5), never mid-motion.
- Background lines are **not word-lit** and show no glow. Ink is per §4.1.

### 8.3 Independent motion paths

Each background line drifts on a deterministic, seeded path (no physics, cheap, reproducible):

```
dx(t) = A_x · ( sin(2π t / P₁ + θ₁) + 0.5·sin(2π t / P₂ + θ₂) )
dy(t) = A_y · ( sin(2π t / P₃ + θ₃) + 0.5·sin(2π t / P₄ + θ₄) ) − v_rise · (t − t_home)
```

- Periods `P₁…P₄` are seeded in 23–47 s. Amplitudes `A_x = 0.022 W`, `A_y = 0.018 H`, scaled by
  `(1 − 0.4·(z − 0.78)/0.22)` (deeper moves less) and by the motion gain `g` (§12.4).
- `v_rise`: a very slow upward drift of `0.004 H/s`, so the whole field breathes upward like the
  transition zone. Lines that rise past `0.08 H` fade out over 1.5 s and are re-homed at the bottom
  half (deterministically, next seeded sample).
- **Opacity breathing:** each line multiplies its `o(z)` by `0.75 + 0.25·noise(t / P₅)`, with
  `P₅ ∈ [9, 17]` s seeded. This gives "occasional changes in opacity" without any line blinking.
  The maximum rate of change is 0.05/s.

### 8.4 Parallax

- A slow **camera sway** shared by the field: `cam = (0.006 W · sin(2π t/61 s), 0.004 H · sin(2π t/47 s))`.
- Each line's offset = `cam × (1 − z) × 2.2`: near background moves more than far, so the field reads
  as layered depth.
- **Pointer parallax** (optional, on by default, off in reduced motion): the pointer position relative
  to the centre adds up to `±10 px × (1 − z) × 2` with a 600 ms low-pass. It only applies while the
  pointer is over the stage and chrome is visible.
- The active line and the transition zone take **no parallax** (readability).

### 8.5 Entering the transition zone

At each hand-over, the background line that becomes +3 leaves its home position and travels to the
+3 slot on `line.enter` (f 1.1, ζ 0.95). It crosses from its bucket into the lyric layer's main
container at the start of the move. Its blur animates from its bucket value to `b(z₊₃)` through the
line's own `filter` for the ≈ 760 ms of the move, then stays static. If its home is inside the
reading corridor's far edge, it rises from below the zone instead of crossing the active line.

---

## 9. Edge cases and states

### 9.1 Word-timed lyrics (`sync: 'word'`)

The full experience described in §4–§8.

### 9.2 Line-timed lyrics (`sync: 'line'`)

- Depth model, transition zone, background and decay: identical.
- **No per-word sweep.** ECHO never invents word timings (no fake sync). At activation, the whole
  line lights with a **wash**: a left-to-right gradient sweep over a fixed 420 ms (`--ease-out`),
  starting at `line.start`. The wash is clearly a transition, not a vocal-tracking sweep.
- The glow sits on the whole line at 60% of the word-glow alpha, modulated by vocal sustain
  (§12.3) when audio features exist.
- `end` missing: `end = next.start − 100 ms`, or `start + 6 s` for the last line.

### 9.3 Untimed lyrics (`sync: 'none'`)

- No auto-advance. The stage shows a **static lyric sheet**: all lines in a centred column at
  `0.62 × --ly-active`, `z`-styled as rank +1 (opacity 0.74), scrollable by wheel, keyboard
  (`↑/↓`, `PgUp/PgDn` while the lyric layer is focused) and touch.
- A 12px `--faint` note under the first line reads "Lyrics aren't time-synced for this track", with
  the source attribution.
- The background field is hidden. The environment continues.
- Setting "Show unsynced lyrics" (default on). When off, these tracks use Cover mode.

### 9.4 Missing lyrics

- Stage switches to **Cover mode** (`PRODUCT_SPEC.md` §6.1), with "No lyrics found" in 14px `--muted`
  under the cover, plus the list of sources tried as a tooltip on an ⓘ.
- Instrumental tracks (flagged by source, or title containing "instrumental") show the cover with no
  message.

### 9.5 Delayed API responses

Timeline after a track starts, from the lyric request (`LYRICS_INTEGRATION.md` §6 defines timeouts):

| Elapsed | Stage shows |
|---|---|
| 0–600 ms | The environment with palette; no lyric UI (most requests resolve from cache in < 50 ms) |
| 600 ms → | **Interlude dots** (§9.8) centred at the active anchor, with "Finding lyrics…" in 12px `--faint` beneath after 1.5 s |
| Resolved | Dots fade out (250 ms). The field builds: if `t` is already past the first line, lines take their computed positions directly (no stagger), fading in over 400 ms |
| Timeout / not found | §9.4 |
| Late arrival (after Cover mode was shown) | If it arrives within the track: crossfade Cover → Lyrics at the next line start, or immediately if inside an instrumental gap ≥ 2 s. A **better** source arriving late (word-timed replacing line-timed) swaps only if `t < 10 s` or during an instrumental gap; otherwise it is cached for next time. As built (M6): always cached for next time; the mid-song swap is a follow-up (`reviews/M6.md`). |

### 9.6 Pause and seek

**Pause:**
- `t` freezes. Springs settle to their targets, and nothing else moves in the transition zone.
- The active word's glow dims to 60% over 600 ms. The background field's drift slows to 25% speed
  over 1.5 s. It does not stop, because a frozen room looks broken. Paused is "the room holding its
  breath".
- Resume: glow and drift restore over 300 ms. No re-entry animation.

**Seek** (detected when the clock jumps backwards, or by more than 150 ms outside expected advance;
the AMLL rule):
- **During a scrub drag:** the field enters **scrub mode**. Lines take their targets for the scrub
  time with springs bypassed (direct position), and the word sweep jumps. No stagger, no emphasis, no
  beat response. This gives cheap, exact feedback while dragging.
- **On release, or on a keyboard/programmatic seek:** targets jump, and springs use `line.slow`
  (f 1.45, ζ 1) with no stagger. Lines that should not exist in the new state (decaying lines from
  the old position) fade out in 160 ms. Background lines re-home deterministically for the new `t`.
- Seeking into the middle of a word: `p_w` starts mid-word. No emphasis lift is replayed.
- Seek confirmation lag (Spotify): optimistic `t` from the clock is used. If the provider reports a
  position > 300 ms away, the field re-seeks once.

### 9.7 Skipped tracks and song changes

- **Normal track change:** the outgoing field **recedes**. All its lines take `z → 1`, opacity → 0
  over 420 ms (`--ease-exit`), with no stagger. At the same time the palette starts its 1200 ms
  interpolation (`VISUALIZER_SPEC.md` §6.4). The incoming document builds as in §9.5 (Resolved).
- **Rapid skipping** (track changes < 1.5 s apart): lyric requests are debounced (250 ms after the
  last change) and stale responses are dropped by track key. The field shows dots, never the wrong
  song's lyrics. The palette retargets mid-transition from its current value, so it is continuous.
- **Gapless/crossfade (Navidrome):** the new document is prepared off-screen 2 s before the boundary.
  Its first line arrives as a normal hand-over from the old song's last line.

### 9.8 Instrumental gaps, intros and outros

- **Gap ≥ 7 s** between a line's end and the next start (also the intro before the first line):
  **interlude dots** at the active anchor. Three dots, 0.22em at `--ly-active`, breathing on a 4 s
  cycle (scale 0.4 → 1.25, opacity 0.2 → 0.9), with 80 ms between dots. They enter over 750 ms and
  leave 500 ms before the next line's hand-over (prior art: AMLL).
- During a gap, +1 holds at its approach slot. The drift formula uses the gap as the active span, so
  it rises slowly the whole time.
- The dots' brightness follows the bass envelope (±15%) when features exist.
- **After the last line:** the last line decays normally. The field then shows nothing; the
  environment carries the outro. At `duration − 4 s`, a single `--faint` 14px line "Up next: Title —
  Artist" fades in at `0.86 H` (only if there is a next track).

### 9.9 Lyric lengths and vocal pacing

| Situation | Behaviour |
|---|---|
| Very fast lines (< 350 ms apart) | Hand-overs closer together than 350 ms are **coalesced**: the field advances by two ranks in one stagger, so it never flickers through a line the eye cannot read. Each line still takes the active state for its time, and its words still sweep. |
| Very fast words (< 150 ms) | No emphasis. Sweep is still exact. Glow decay τ shortens to 120 ms. |
| Slow ballad (lines ≥ 6 s) | Drift moves the transition zone over the whole line duration (§4.3), so the field is never static for long. |
| Very long line (3 rows) | Allowed at the active position. Transition-zone overflow rule (§4.3) handles stacking. |
| Repeated lines (chorus) | Treated as separate lines with their own timing. No de-duplication. |
| Hundreds of lines | Only ranks −2…+3 and ≤ 24 background lines exist in the DOM. Lines are created and recycled from a pool of 40 elements. |
| Overlapping lines (two vocals at once, not marked as background) | The earlier-starting line is active. The overlapping line is placed as +1 at drift 1.0 (as close as allowed) and its words sweep while still at rank +1, with a glow but at +1's opacity. |
| Empty or whitespace lines | Treated as gaps (§9.8) and never rendered as blank boxes. |

### 9.10 Window resize

- On `ResizeObserver` (debounced 120 ms): recompute `H`, `W`, `--ly-active`, re-measure every line
  in the pool, recompute targets. **No springs and no stagger:** lines jump to their new positions
  in a 200 ms opacity dip (to 0.6 and back) that hides the reflow.
- During an active resize drag, the field freezes its layout (scaled with the stage via a single
  container transform) until the debounce settles.
- Full-screen toggle counts as a resize.

### 9.11 Reduced motion

See §10.

### 9.12 High GPU usage and low frame rates

See §13. In short: the lyric layer **degrades last** and **never drops below its readability core**:
word sweep, the active line, the +1…+3 zone, and decaying lines without blur animation.

### 9.13 Timing offset

- Global offset (Settings → Lyrics) plus a per-track offset (`[`/`]`, ±50 ms, saved per user via `PUT
  /api/v1/me/tracks/:trackKey/override`). Both are added inside `SongClock` for lyrics only. Visual features use the
  un-offset clock. A toast shows the total ("Lyrics +150 ms").
- If the `LyricsDoc` carries its own offset (OpenSubsonic `offset`, LRC `[offset:]`), it is applied
  first.

---

## 10. Reduced motion

Triggered by `prefers-reduced-motion: reduce` **or** Settings → Visuals → Motion = Reduced. A third
option, Motion = Off, is described below.

| Element | Full | Reduced |
|---|---|---|
| Hand-over | springs + stagger | **Crossfade in place over 180 ms.** Lines are placed at their slots with no travel; the outgoing line fades while the incoming one brightens |
| Approach drift | yes | none (slots static) |
| Word sweep | yes | **yes**. It is a colour change that carries timing information, not motion |
| Glow | modulated | constant 0.35 alpha on the sweeping word |
| Emphasis lift and swell | yes | none |
| Decay | rise + blur + fade | fade only, 300 ms |
| Background field | 24 lines drifting | hidden |
| Parallax | yes | none |
| Beat response on text | yes | none |
| Palette transition | 1200 ms | 1200 ms (colour, not motion) |
| Interlude dots | breathing | static dots at 0.6 opacity |

**Motion = Off** (WCAG 2.2.2 "Pause, Stop, Hide": a way to stop auto-moving content without stopping
the music): the stage shows a static lyric sheet like §9.3, with the active line marked by
`--lit` colour and `aria-current`, and the sheet scrolls only on hand-over by an instant jump. The
environment freezes to one still frame. The `V` key cycles to Cover mode as another static option.

---

## 11. Accessibility

- The animated field is `aria-hidden="true"`. Accessible content is provided separately.
- A visually hidden `<ol aria-label="Lyrics">` mirrors the document's lines. The active line carries
  `aria-current="true"`.
- **Line announcements** are opt-in (Settings → Lyrics → "Announce lyric lines", default off). When
  on, a `role="status"` `aria-live="polite"` region receives the active line text at each
  hand-over, coalesced to at most one announcement per 1.5 s.
- The lyric layer never takes focus during playback. In static sheets (§9.3, §10 Off) it is
  focusable (`tabindex="0"`, `role="document"`) for scrolling.
- Contrast floors: `DESIGN_SYSTEM.md` §3.4. Photosensitivity: §12.5 and `VISUALIZER_SPEC.md` §7.3.
- Attribution (required by Spicy Lyrics' terms and good practice): a 12px `--faint` line at the
  bottom-left of the stage, visible with chrome. Format in `LYRICS_INTEGRATION.md` §8.

---

## 12. Music-reactive behaviour of the lyric field

### 12.1 Inputs

The lyric field reads the per-frame `Features` object from `VISUALIZER_SPEC.md` §3. All values are
normalised to 0–1 per song, already smoothed and latency-aligned:

| Feature | Meaning |
|---|---|
| `bass` | sub+bass envelope (20–250 Hz), attack 10 ms, release 180 ms |
| `onset` | percussive onset impulse (high-band spectral flux), 0 or a 0–1 peak, refractory 120 ms |
| `mid` | 250 Hz–4 kHz envelope (vocal band proxy) |
| `intensity` | slow measure of how much is happening (loudness vs the song's own p95, plus onset density), 2 s smoothing |
| `available` | `false` when no analysis exists (Spotify, Ambient mode, analysis failure) |

### 12.2 Motion gain

`g = 0.35 + 0.65 · intensity`. Every beat-driven term below is multiplied by `g`, so quiet passages
are calm and intense passages are expressive. When `available = false`, `g = 0.6` constant and all
beat terms are 0.

The user's **intensity setting** (`visuals.intensity`, default **expressive**;
`VISUALIZER_SPEC.md` §7.4) multiplies the *background* terms only (percussion kicks on background
lines, drift speed changes): subtle ×0.5, balanced ×1.0, expressive ×1.5. The active line and the
transition zone keep the same caps at every setting (§12.4). Readability does not depend on the
setting.

### 12.3 Mapping table

| Musical cue | Lyric response | Cap | Smoothing |
|---|---|---|---|
| **Bass** | Active line scale pulse `1 + 0.012·g·bassImpulse`; transition-zone lines lean toward the viewer: `z −= 0.025·g·bass` | Scale ≤ +1.5%. `z` shift ≤ 0.025 | `bassImpulse` = positive derivative of `bass` fed into `beat.impulse` spring (f 2, ζ 0.5) |
| **Percussion** (onset) | Background lines receive a small independent kick: `translate` impulse of `≤ 2 px × g` in a seeded direction per line | ≤ 2 px. Never on ranks 0…+3 | `beat.impulse` spring per bucket (not per line, for cost) |
| **Sustained vocals** (heuristic) | `sustain = smoothstep(0.6 s, 1.5 s, wordElapsed) · mid` (word-timed), or `mid` while a line is active (line-timed). Glow radius `0.18 → 0.26em` and alpha `0.35 → 0.55` | alpha ≤ 0.55 | attack 120 ms, release 400 ms |
| **Quiet passage** (`intensity < 0.2` for 4 s) | Background drift speed ×0.6, opacity breathing amplitude halves | — | 2 s |
| **Intense passage** (`intensity > 0.75`) | Drift speed ×1.4, approach drift fraction 0.30 → 0.38, glow +0.05 alpha | Text luminance never changes with beats | 2 s |

"Sustained vocals" is a **heuristic**: ECHO does no vocal source separation. Word duration from
timestamps plus mid-band energy approximates it. This is recorded as a known limitation (Q-LY-1).

### 12.4 Readability caps (hard limits)

- The active line's position never moves more than **2 px** from beats. Its opacity and luminance are
  **never** beat-driven.
- No beat response at all during the first 300 ms after a hand-over (the eye is acquiring the line).
- Every beat term is clamped *after* summing.

### 12.5 Photosensitivity

The lyric layer produces no flashes. Glow alpha changes are slew-limited to 1.5/s. The environment's
luminance limits are in `VISUALIZER_SPEC.md` §7.3.

---

## 13. Performance budget and degradation

The lyric layer is DOM: ~4–30 line elements and ~10–80 word spans in the DOM at any time.

| Rule | Value |
|---|---|
| Style writes per frame | ≤ 40 (positions of visible lines, `--p` on one word, glow on ≤ 2 words) |
| Writes are skipped when the value changed by less than | 0.1 px, 0.005 opacity, 0.05 px blur |
| Layers | each line `will-change: transform, opacity` while moving, removed 500 ms after settling |
| Blur | per-line `filter` only on ranks +1…+3 and decaying lines (≤ 5 elements). The background uses 3 bucket containers |
| Layout | measurement only at document load and resize. **Zero layout reads in the frame loop** |
| Budget | ≤ 2.5 ms main-thread time per frame for `lyricField.update` at T0 on the reference machine (`ACCEPTANCE_CRITERIA.md` PERF-03) |

**Degradation ladder** (driven by the perf governor, `VISUALIZER_SPEC.md` §8. The lyric layer steps
down only after the environment has already stepped down):

| Tier | Lyric field |
|---|---|
| T0 | Full |
| T1 | Background budget 12, bucket blurs 3/4/5 px, pointer parallax off |
| T2 | Background budget 6, bucket blur off (opacity only), emphasis swell off (lift kept) |
| T3 | Background hidden, decay without blur, glow static, stagger off |
| Floor (never removed) | Active line, word sweep, +1…+3 with springs, decaying lines' fade |

---

## 14. Colour in the lyric field

- Every lyric colour comes from the palette roles (`DESIGN_SYSTEM.md` §3.3), so it changes with the
  song.
- During the 1200 ms palette transition between tracks, the lyric CSS variables interpolate
  **in OKLab** each frame together with the environment's uniforms. Old lines receding and new lines
  arriving pass through the same intermediate colours, with no abrupt change.
- The contrast solver (`DESIGN_SYSTEM.md` §3.4) runs on the *interpolated* palette, so contrast holds
  mid-transition.
- Spotify tracks use art-derived colour while gate G1 is on (the default by owner decision,
  `PLAYBACK_ARCHITECTURE.md` §4.6). If the admin switches G1 off, the fallback palette (Sodium) is
  used and the lyric field works identically. Likewise, G2 off turns Spotify lyrics into the untimed
  sheet (§9.3).

---

## 15. Tuning file

All constants above live in `src/client/stage/lyrics/lyricsConfig.ts` as one exported frozen object,
grouped by section number. The values below are the file as of the M3 tuning session (2026-10-24):

```ts
export const LYRICS = {
  anchorY: 0.4, // §3.2
  maxWidth: 0.64, // §3.3
  maxRows: 2,
  shrinkMax: 0.12,
  depth: {
    scaleK: 0.3, // §4.1
    opacity: [
      [0, 1],
      [0.22, 0.74],
      [0.44, 0.54],
      [0.66, 0.4],
      [0.8, 0.24],
      [1, 0.12],
    ],
    blur: [
      [0, 0],
      [0.22, 1],
      [0.44, 2],
      [0.66, 3.2],
      [0.8, 4],
      [0.9, 6],
      [1, 8],
    ],
    zoneBlurCap: 4,
  },
  zone: {
    dz: 0.22, // §4.2, §4.3
    zMax: 0.72,
    zBackground: 0.78,
    gapH: 0.04,
    gapRefMs: 3200,
    gapClamp: [0.8, 1.5],
    gapShrinkMin: 0.5,
    bottom: 0.86,
    drift: 0.3,
    approachK: 0.35, // rank +1 closes 35% of its clearance
    clearH: 0.02, // and keeps at least this much
    approachZFloor: 0.65,
  },
  sweep: { edgeAhead: 0.35, edgeBehind: 0.6, holdGapMs: 300, minWordMs: 60 }, // §5.1
  glow: {
    radius: 0.18, // §5.2
    radiusMax: 0.26,
    alpha: 0.35,
    alphaMax: 0.55,
    decayMs: 220,
    decayFastMs: 120, // words < 150 ms (§9.9)
    riseMs: 90,
    slewPerS: 1.5, // photosensitivity (§12.5): alpha never changes faster
    paused: 0.6, // §9.6: dims to 60% over 600 ms, restores over 300 ms
    pauseMs: 600,
    resumeMs: 300,
  },
  wash: { ms: 420 }, // §9.2 line-timed lines
  handover: { leadMinMs: 120, leadMaxMs: 300, coalesceMs: 350 }, // §5.3, §9.9
  emphasis: { minMs: 1000, minG: 2, maxG: 7, anticipateMs: 400, releaseMs: 250, swellMax: 0.08 }, // §5.5
  springs: {
    normal: [2.0, 2.35, 1.0], // §6.1
    slow: [1.45, 1.0], // critically damped: +1 never drifts back down after a slow hand-over (LYR-05)
    enter: [1.1, 0.95],
    lift: [1.2, 0.75],
    impulse: [2.0, 0.5],
  },
  stagger: { baseMs: 50, decay: 1.05 }, // §6.3
  decay: { tauMs: 520, rise: 0.05, zEnd: 0.35, blurMax: 6, maxPast: 2, gapH: 0.035, dropMs: 120 }, // §7
  background: { budget: [24, 12, 6, 0], minDist: 0.16, ampX: 0.022, ampY: 0.018, rise: 0.004 }, // §8
  interlude: {
    minGapMs: 7000,
    cycleMs: 4000,
    leaveMs: 500,
    enterMs: 750,
    fadeMs: 250,
    dotEm: 0.22,
    dotStepMs: 80,
  }, // §9.8
  build: { fadeInMs: 400, seekOutMs: 160, recedeMs: 420 }, // §9.5, §9.6, §9.7
  reduced: { crossfadeMs: 180, decayMs: 300, dotsAlpha: 0.6 }, // §10
  lineTimed: { endGapMs: 100, lastLineMs: 6000 }, // §9.2
  beat: {
    scaleMax: 0.012, // §12.3: 1 + 0.012·g·bassImpulse
    scaleCap: 0.015, // §12.4, after summing
    zLean: 0.025,
    kickPx: 2,
    quietMs: 300, // §12.4: none after a hand-over
    bassForce: 0.022, // per ms: a bass hit (≈ 45 ms of bassImpulse) peaks the spring at its level
    sustainAttackMs: 120,
    sustainReleaseMs: 400,
    quietBelow: 0.2, // intensity, for quietForMs
    quietForMs: 4000,
    intenseAbove: 0.75,
    passageMs: 2000, // quiet and intense passages blend in and out
    quietSpeed: 0.6, // background drift speed
    intenseSpeed: 1.4,
    intenseDrift: 0.38, // approach drift fraction (§4.3: 0.30)
    intenseGlow: 0.05,
    setting: { subtle: 0.5, balanced: 1, expressive: 1.5 }, // §12.2, background terms only
  },
} as const;
```

Visual tuning sessions adjust only this file. Changed values are written back here, so this
document remains the source of truth.

---

## 16. Fixtures for M3 (mock data)

M3 builds the whole field against realistic **mock `LyricsDoc`s** before any lyric source is
integrated. Required fixtures in `fixtures/lyrics/` (original text written for ECHO, no copyrighted
lyrics), each paired with a silent or synthetic audio track of the same duration so the clock can
run:

| Fixture | Exercises |
|---|---|
| `ballad-word.json` | 3:40, word-timed, lines 4–7 s, long held words (emphasis), a 12 s instrumental bridge |
| `rap-word.json` | 2:50, word-timed, words 90–200 ms, lines 0.9–1.8 s, two lines < 350 ms apart (coalescing) |
| `duet-word.json` | two agents, `oppositeAligned`, background vocals in parentheses and as `Background[]` |
| `pop-line.json` | line-timed only, missing `end` values |
| `static.json` | untimed |
| `cjk-word.json` | Japanese, per-character timing. **Robustness only:** must render correctly with system fonts and not break layout. Not a design target (owner: Latin script only) |
| `rtl-line.json` | Hebrew or Arabic, line-timed. Robustness only, as above |
| `accents-word.json` | Latin with diacritics and ligature-prone pairs (é, ñ, ø, ß, "fi", "ffl"), apostrophes, em dashes. **This is the primary design target for typography.** |
| `long-lines.json` | lines that need 3 rows at 1024×640 |
| `intro-outro.json` | 25 s intro, 30 s outro |

Each fixture has a Vitest test asserting `activeIndexAt(t)`, `handoverAt`, the coalescing decisions
and stack positions at a list of sample times. Playwright snapshots render
`?fixture=<name>&frame=<ms>` at fixed times (`TECHNICAL_ARCHITECTURE.md` §8).
