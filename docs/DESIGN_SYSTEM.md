# ECHO — Design System

Status: **Draft 3** · 2026-10-25: Shell moved to Material 3 Expressive (§0) · 2026-10-28: liquid glass approved in both zones (§7.11) · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Design research](DESIGN_RESEARCH.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Visualizer](VISUALIZER_SPEC.md)

This is the visual language of the whole application: tokens, component rules and the reason each
effect exists. Implementation must take every colour, size, duration and easing from the tokens in
§13. A raw value in a component counts as a defect (`ACCEPTANCE_CRITERIA.md` DS-01).

Direction name: **Reverb Chamber**. The screen is a dark acoustic room, and sound shows up in it as
light that arrives, reflects and decays. (Chosen in `DESIGN_RESEARCH.md` §4.)

**2026-10-25: the Shell is Material 3 Expressive** (owner decision: "make the design system (not the
lyrics or player view) material 3"). §0 is normative for the Shell and supersedes the Shell parts of
§1–§11 where they disagree; those places say so. Reverb Chamber stays the rule for the **player
view**: the Stage (Listen, its chrome, lyrics, Cover and Visual modes) and the dock's player controls.

---

## 0. Material 3 Expressive in the Shell

Decisions (owner, 2026-10-25): colour from the album art (dynamic), dark theme only, **Roboto Flex**,
the **Expressive** flavour (2025 spec).

**Colour.** `palette/m3.ts` builds the dark `SchemeContent` scheme (material-color-utilities,
spec 2025; owner decision 2026-10-27: `SchemeExpressive` rotated secondary and tertiary away from
the album, which put a green nav pill on a magenta record, so every role now keeps the album's hue) from the playing album's `--art-accent` as the seed, Sodium `#E3B26B` when nothing plays,
and publishes every role as `--md-sys-color-*` (primary, secondary, tertiary, error and their
containers and on-colours; surface, surface-dim/bright, the five surface containers, on-surface,
on-surface-variant, outline, outline-variant, inverse roles, scrim, shadow). Success and warning are
M3 custom colours (`#7FD6A0`, `#E5A93B` harmonised to the seed; tones 80/20/30/90). The roles animate
with the artwork palette (1200 ms, OKLab, `animator.ts`), so a track change re-tints the whole Shell.
`tokens.css` holds the Sodium scheme as the fallback. Every M3 contrast pair is tested for several
seeds (`m3.test.ts`: on-surface on surface ≥ 7:1, on-X on X ≥ 4.5:1, outline on surface ≥ 3:1).

**Type.** Roboto Flex (variable: `opsz` 8–144, `wdth` 25–151, `wght` 100–1000; SIL OFL 1.1,
`fonts/OFL-RobotoFlex.txt`; self-hosted Latin + Latin-Ext). The M3 type scale as
`--md-sys-typescale-<role>` (weight size/line, the family added from `--font-ui` where used) with
the M3 tracking as `--md-sys-tracking-*`; Expressive emphasized roles are one weight step up.
Screen h1: headline-medium; h2: title-large; album title: headline-large emphasized; body:
body-medium; meta: body-small; buttons, tabs, menus: label-large or title-small.

**Shape.** The Expressive corner scale `--md-sys-shape-corner-*`: 4 / 8 / 12 / 16 / 20 / 28 / 32 /
full. Buttons and icon buttons are round and **square off on press** (full → 8px) on the fast
spatial spring; the album FAB rounds on press.

**Elevation.** Tonal: surface containers carry it. Shadows (`--md-sys-elevation-level1…3`) only on
floating surfaces: the album FAB (1), side sheet (1), menu (2), slider bubble (2), dialog (3),
snackbar (3).

**States.** M3 state layers as the content colour mixed over the container: hover 8%, focus 10%,
pressed 10%, dragged 16%. Disabled: content 38%, container 12% of on-surface; the label of a disabled
switch row stays on-surface-variant (it says what is unavailable). Focus: 3px `secondary` outline,
2px offset.

**Motion.** Expressive springs as CSS `linear()` easings generated from M3's stiffness and damping
(spatial: fast 800/0.6, default 380/0.8; effects: fast 3800/1, default 1600/1), each with its
settle time as a duration token. Spatial springs move shape, size and position (they overshoot a
little); effects springs move colour and opacity. Reduced motion keeps colour and opacity only.

**Components** (ui.css, main.css):

| ECHO component | M3 component | Notes |
|---|---|---|
| Sidebar | Navigation drawer (standard), surface-container-low | 56px items; the current one on a secondary-container pill. Below 720px: navigation bar, surface-container (text labels; ECHO's nav has no icons). Glass (§7.11) |
| Search field | Search bar | 56px, full corner, surface-container-high |
| Library / Settings tabs | Secondary tabs | 48px, 3px primary indicator, outline-variant divider |
| Primary / secondary / tertiary / destructive button | Filled / outlined / text / outlined in error | 40px (small) |
| Icon button | Standard icon button | 40px, state-layer circle |
| Choice rows (Settings, album order) | Connected button group | 2px gaps, the chosen one fills (primary) and rounds fully |
| Toggle | Switch | 52×32, handle 16 → 24 (28 pressed) |
| Field | Outlined text field | 56px, 4px corner, 2px primary outline on focus. **Deviation:** the label stays above the field instead of floating in the outline (no markup change; it is always visible and never overlaps a value) |
| Status pill | Tonal label | success / warning / error containers, surface-container-highest for neutral |
| Track rows | List items | 56px, 72px with art; rounded state layer; selected = secondary-container; now playing = primary |
| Album tile | Card without fill | hover state layer on a 20px-corner surround; cover 12px corner; play = small FAB in primary-container |
| Menu | Menu (Expressive) | surface-container, 16px corner, 48px items |
| Queue / help sheet | Modal side sheet | surface-container-low, 16px leading corners. Glass (§7.11), opaque over the Stage (§6) |
| Dialog | Basic dialog | surface-container-high, 28px corner, 24px padding, scrim 32%. Glass (§7.11) |
| Toast | Snackbar | inverse-surface, 4px corner, 48px |

**The player view.** `tokens.css` ends with one block that maps the M3 roles the shared components
read back to Reverb Chamber's neutral tokens inside `.shell[data-view="listen"] .canvas` and the
dock's four player areas (meta, transport, scrubber, right), and sets Mona Sans there; `ui.css` keeps
Reverb Chamber's geometry for buttons and icon buttons there. The Listen and Cover screenshots are
pixel-identical to before the change. The dock bar's own background on Shell screens is
surface-container, so the bar sits in the Shell's colour; its controls keep their look. The queue
and help sheets are Shell (M3).

**Retired with M3:** the ≤ 3% coloured-pixel budget (§3.2; M3 surfaces take the album's tone by
design), "primary buttons are inverted", "no shadow at rest except `--shadow-float`" and "tracking 0"
in the Shell. Still banned in the Shell: gradients, glows, monospace, transformed capitals (DS-02,
`design-rules.test.ts`). **Lifted 2026-10-28 (owner):** the glass and backdrop-blur ban. Liquid
glass is an approved effect in both zones (§7.11).

---

## 1. Two zones, two rule sets

*(Shell column: superseded by §0 where it disagrees; the Stage column is unchanged. 2026-10-28:
liquid glass, §7.11, is approved in both zones.)*

ECHO has two visual zones with different rules. Most generic music apps fail by blurring the
boundary: glow and atmosphere leak into the browsing tools, or dashboard chrome leaks onto the stage.
**Liquid glass is the one effect the zones share**, because it does the same job in both: a
floating control surface that lets what is behind it show through (§7.11). It stays on floating
surfaces; content (lists, grids, forms, lyrics) never turns to glass.

| | **Stage** (S1 Listen, environment, lyric field, Cover/Visual modes) | **Shell** (Library, Search, Queue, Settings, Detail, First run, menus, dialogs) |
|---|---|---|
| Purpose | Feel the song. | Find and control things. |
| Colour source | The current artwork's palette (§3.3), interpolated per track. | Neutral tokens (§3.1). The artwork palette appears in exactly one place: the playing indicator, and the **now-playing accent** on the active track row. |
| Light effects | Allowed **only** from the list in §7, each with a stated purpose. Liquid glass (§7.11) on the top chrome's buttons and brightness pill, and on the dock. | Liquid glass (§7.11) on the floating surfaces only: sidebar, dock, sheets, dialogs. Otherwise none: no gradients or glows (taste-skill app house rules §13; ECHO lifted that skill's glass ban on 2026-10-28). |
| Rule source | This document, §6–§8, plus `LYRICS_EXPERIENCE.md` and `VISUALIZER_SPEC.md` | taste-skill **True-black flat** app style (seed 128902345) with ECHO's face applied (§2), plus this document |
| Motion | Continuous, music-driven, two clocks (§11). | Feedback only: press, hover, focus, sheets opening, rows arriving. Nothing performs an entrance. |

The **transport dock** sits on the boundary. It belongs to the Shell in form (neutral controls,
taste-skill sizes) and to the Stage in colour: the progress fill and play glyph take `--art-accent`.
It is glass in both (§7.11): over the Shell's page and over the room.

---

## 2. ECHO's face (what makes it not a kit)

The taste-skill sheet warns that a dark app with Inter, a #000 ground and one lime accent is "a
well-applied kit". ECHO replaces each default with a choice that comes from its subject:

1. **Data hue from the product's world.** The sheet's lime (`#c6f24e`) is dropped. ECHO's one hue is
   **the current album's accent**. In the shell it marks only what is playing now. The static fallback
   hue is **Sodium** `#E3B26B`, the colour of a single warm practical lamp in a dark studio.
2. **A ground with the product's temperature.** The ground is a cool studio near-black `#0A0B0D`
   (hue ≈ 250°, chroma ≈ 0.005) rather than #000, following the sheet's "cool near-black for a
   monitor" option. It also avoids OLED black smear behind moving text (research §3.4).
3. **A signature element.** The lyric field itself (`LYRICS_EXPERIENCE.md`). In the shell, the
   signature is the **decay trace**: each track row a song has been played from keeps a 2px
   `--art-accent` underline that fades out over the song's duration. It is the echo of what you just
   heard. It appears once per list, on the most recently played row only.
4. **Typeface with character** (§4) instead of the kit default.

---

## 3. Colour

### 3.1 Neutral shell tokens

*(2026-10-25: these are now the **player view's** tokens; the Shell takes its colour from the M3
scheme, §0.)*

All values were checked in sRGB with the WCAG 2.x formula (script in `DESIGN_RESEARCH.md` §6.2).

| Token | Hex | OKLCH (approx.) | Use | Contrast notes |
|---|---|---|---|---|
| `--ground` | `#0A0B0D` | `oklch(0.15 0.005 250)` | Window background, Stage base before the environment paints | — |
| `--surface-1` | `#131417` | `oklch(0.19 0.006 250)` | Cards, sheets, dock, menus | One lightness step |
| `--surface-2` | `#1C1E22` | `oklch(0.23 0.008 250)` | Nested panels, inputs, hovered rows | |
| `--surface-3` | `#272A2F` | `oklch(0.28 0.009 250)` | Pressed state, selected row, active nav pill | |
| `--line` | `#202226` | — | Structural 1px rules (sidebar edge, table rules) | ~1.2:1, structural only |
| `--control` | `#666A71` | — | Borders of inputs, outlined buttons, unfilled toggle track | ≥ 3.0:1 on ground, s1, s2 (WCAG 1.4.11) |
| `--text` | `#F2F1EE` | `oklch(0.95 0.004 90)` | Primary text, icons at rest when emphasised | 17.4 / 16.3 / 14.8 / 12.8 on ground/s1/s2/s3 |
| `--muted` | `#B3B5B9` | — | Secondary text, inactive nav labels | 9.6 / 9.0 / 8.1 / 7.0 |
| `--faint` | `#94979C` | — | Meta, timestamps, placeholders | 6.7 / 6.3 / 5.7 / 4.9 (passes 4.5 everywhere) |
| `--focus` | `#F2F1EE` | — | Focus ring (2px + 2px offset), never the accent | 14.8+ |
| `--positive` | `#7FD6A0` | — | "Connected", success text | ≥ 8.2 |
| `--warning` | `#E5A93B` | — | "Reconnecting", stale | ≥ 6.9 |
| `--negative` | `#EF6B6B` | — | Errors, destructive actions | ≥ 4.8 |
| `--fallback-accent` (Sodium) | `#E3B26B` | `oklch(0.79 0.11 75)` | Accent when no artwork or artwork is achromatic | ≥ 7.4; ink on it: `--ground` 10.2:1 |

Status pill pairs (pale tint, ink of same hue, taste-skill §7.6, dark variant):
`--pill-pos: #15261C / #7FD6A0`, `--pill-warn: #2B2414 / #E5A93B`, `--pill-neg: #2C1A1C / #EF6B6B`,
`--pill-neutral: #1C1E22 / #F2F1EE`.

**Not used anywhere:** violet or indigo as a shell colour, cream with terracotta, neon outlines,
navy/slate darks (taste-skill colour.md §9, app-screens §13). Artwork can of course be violet. The
dynamic palette is the album's colour, not a shell colour.

### 3.2 Colour budget

*(2026-10-25: retired for the Shell with Material 3, §0. The Stage rules below still hold.)*

- Shell screens: coloured pixels (anything not on the neutral ramp) **≤ 3%**, excluding cover art.
  The accent touches only the now-playing indicator and the progress fill.
- Primary buttons are **inverted** (`--text` fill, `--ground` label), never accent-filled.
- Stage: the artwork palette may cover the whole field (it *is* the room light), but the lyric ink
  ramp (§3.4) is always derived for contrast, never taken raw.

### 3.3 Dynamic artwork palette (roles)

Extraction and interpolation algorithms are in `VISUALIZER_SPEC.md` §6. This section defines the
**roles** that every consumer reads. All roles are published as CSS custom properties on `:root`
(for DOM) and as a uniform block (for WebGL), and updated together each frame during a transition.

| Role | Source | Constraint (OKLCH) | Consumers |
|---|---|---|---|
| `--art-dominant` | Most populous cluster | as extracted | Analysis only. Never painted directly. |
| `--art-room` | Dominant, pushed dark | L 0.12–0.24, C ≤ 0.10 | Environment base fill, Cover-mode ground |
| `--art-accent` | Highest chroma × population | L 0.70–0.82, C 0.06–0.18 | Lit-word core, progress fill, play glyph, now-playing row |
| `--art-highlight` | Lightest cluster with C > 0.04, else accent lightened | L 0.86–0.94, C ≤ 0.10 | Lit-word sweep leading edge, bloom tint, halation |
| `--art-glow` | Accent | L 0.60–0.72, C ≤ 0.14, **alpha ≤ 0.35** | Bloom and halation colour only |
| `--art-glow-solid` | Derived: `--art-glow` without its alpha | as `--art-glow` | The active-word glow, which sets its own alpha within §7.2's caps (M3) |
| `--art-shadow` | Room, pushed darker | L 0.06–0.10 | Vignette, scrims |
| `--lyric-ink-*` | Derived (§3.4) | contrast-solved | Lyric text at each depth |

Achromatic or near-achromatic artwork (all clusters C < 0.02): `--art-accent` = Sodium,
`--art-room` = `oklch(0.16 0.006 250)`, and the hue is never invented from noise.

### 3.4 Lyric ink and contrast guarantees

Lyric text is light on a moving dark field, so a contrast check against a static background is not
enough. Rules:

1. **Measure against the worst case.** The environment renderer publishes `roomPeakL`: the 95th
   percentile OKLab L of the environment in the lyric safe zone, sampled at 8×8 every 250 ms from a
   downsampled render target (`VISUALIZER_SPEC.md` §5.4).
2. **Active line** (`--lyric-ink-active`, the *unlit* part of the active line): near-white, tinted
   2% toward `--art-highlight`. Target **WCAG ≥ 7:1 and APCA |Lc| ≥ 75** against `roomPeakL`.
3. **Lit words**: the illuminated colour is `--art-highlight` → `--text` (§7.1). Target **≥ 4.5:1**
   against `roomPeakL`. Lit text is always at least as light as unlit text, so lighting never lowers
   contrast.
4. **Upcoming +1/+2/+3** use opacity steps (`LYRICS_EXPERIENCE.md` §4.1). Each must still reach
   **≥ 3:1**, the large-text threshold. *(Enforced for all three since 2026-10-27, when +2/+3 were made
   more opaque; `docs/reviews/M4.md`.)* Rendered size is ≥ 25px even at the minimum `--ly-active`
   (32px × the +3 scale of 0.80). For lines rendered under 24px (only at the compact breakpoint),
   the floor rises to 4.5:1. +3 must stay readable because the user may read ahead.
5. **Background and past lines** are decorative. No minimum applies, and they are `aria-hidden`
   (`LYRICS_EXPERIENCE.md` §11).
6. **Enforcement.** When a target fails, ECHO does *not* change the ink hue. It **darkens the room**:
   the environment's exposure uniform is lowered in the lyric safe zone until the target is met
   (cap: −40% exposure). If that is not enough, it adds a neutral `--art-shadow` scrim behind the
   active line (radial, 0.0→0.45 alpha, the one gradient permitted for contrast; taste-skill colour.md §7).

---

## 4. Typography

### 4.1 Families

**ECHO's typeface is Mona Sans** (owner decision 2026-10-23, from the M1 Stage specimen; record and
measurements in `docs/reviews/M1-type.md`). The owner needs Latin script only. *(2026-10-25: Mona
Sans is the Stage's and the player view's face; the Shell uses Roboto Flex under Material 3, §0.)*

| | **Mona Sans** |
|---|---|
| Axes | `wght` 200–900, `wdth` 75–125 |
| Character | Warm, expressive grotesk: editorial, music-poster confidence |
| Lyric identity device | `wdth` chosen once per line at layout: long lines condense (down to `wdth 82`) instead of shrinking |
| Long lines | condense first, then shrink (≤ 12%), then wrap (§4.3) |
| Licence | SIL OFL 1.1, © 2022 The Mona Sans Project Authors, Reserved Font Name "Mona". Redistributed unmodified (`src/client/fonts/OFL-MonaSans.txt`) |
| Subsets used | latin, latin-ext (Google Fonts v4 files) |

Measured in M1: Mona Sans fits more text per row than the alternative at the same size and can
condense, so lyric lines stay within the row rules at the compact breakpoint (390×844), where the
alternative needed 4–5 rows.

**Runner-up: Geologica.** It and the M1 type specimen were removed on 2026-10-27; the comparison is
recorded in `docs/reviews/M1-type.md`.

**Fallbacks:** `system-ui, sans-serif`. Non-Latin lyrics (not a design target) render in system fonts
and must not break layout (robustness fixtures, `LYRICS_EXPERIENCE.md` §16). No Noto webfonts are
bundled.

Rejected faces (before the M1 specimen): **TikTok Sans** (social-video brand association), **Ubuntu Sans** (OS brand),
**Pliant** (too new, unproven), **Inter/Geist** (kit default).

**One setting per lyric line, whatever its state.** A line changes state (upcoming → active → past)
while the user watches it. Any change to weight, width or sharpness would change its advance widths,
reflow it mid-move and break the sweep geometry (research §3). So per-line font settings (Mona Sans'
`wdth`) are computed **once at layout** and never change or animate. Depth and focus are
expressed only through transform, opacity, blur and colour.

No monospace anywhere. Timecodes and counts use `font-variant-numeric: tabular-nums`.
**Verification (M1):** confirm the face's `tnum` really changes digit widths (taste-skill
§9.1). If it does not, numeric spans use `system-ui` with `tnum` (Q-DS-1). **Result:** both
candidates have proportional default digits and a working `tnum` feature, measured in Chromium and
Firefox (`docs/reviews/M1-type.md`). No numeral fallback is needed for either face.

Fonts are **self-hosted** (woff2, Latin + Latin-Ext subsets) and served by the ECHO server, with no
third-party font CDN.

### 4.2 Shell type scale (taste-skill sheet sizes, kept)

*(2026-10-25: the Shell uses the M3 type scale in Roboto Flex, §0. These sizes remain for the dock's
player controls and the Stage's chrome.)*

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `--fs-title` | 20 / 28 | 600 | Screen h1 ("Library", album name in Detail = 24/32) |
| `--fs-section` | 16 / 24 | 500 | Section and card titles |
| `--fs-figure` | 24 / 30 | 400 | Lead figures (track count in Detail header) |
| `--fs-body` | 14 / 20 | 400 | Rows, nav, body |
| `--fs-small` | 12 / 16 | 400 | Meta, timestamps, axis text. Nothing smaller anywhere. |

Max 3 weights in the shell (400/500/600). Tracking 0 at text sizes. Sentence case everywhere, no
tracked capitals.

### 4.3 Stage type scale (lyrics)

Sizes are fluid and keyed to the **stage height** (lyrics fill vertical space), with a viewport-width
cap so long lines fit.

| Token | Value | Notes |
|---|---|---|
| `--ly-active` | `clamp(32px, min(6.2vh, 4.6vw), 88px)` | Active line. At 1440×900 → 56px. |
| Other lines | Laid out at `--ly-active`, then scaled by depth with `transform` | Upcoming, background and past lines are the same box as the active line, seen from further away. The scale function `s(z)` is in `LYRICS_EXPERIENCE.md` §4. One layout per line, so nothing reflows when a line becomes active. |
| Weight | 600 for every lyric line (`wght` 600, plus the per-line `wdth` chosen at layout) | One weight: see "One setting per lyric line" above. 600, not 700+, because light text on dark reads heavier. |
| Long lines | `text-wrap: balance`; max 2 rows. If a 3rd row would be needed: condense to `wdth` ≥ 82, then reduce that line's size by up to 12%, then allow 3 rows | Computed once per line at layout |
| Line height | 1.12 within a wrapped line | |
| Tracking | −0.022em for every lyric line | Fixed, because lines are laid out once at active size and scaled by transform. Changing tracking per state would reflow. |
| Measure | max 22ch-equivalent per row (≈ 64% stage width at 56px) | Lyric lines are short; the cap keeps eyes centred |
| Alignment | **Centred** | taste-skill allows one centred moment per screen. This is it. Duet/secondary vocalist lines offset per `LYRICS_EXPERIENCE.md` §8.4. |
| Script handling | CJK: no tracking, line height 1.2. RTL: `dir="rtl"` per line, sweep direction reverses (`LYRICS_EXPERIENCE.md` §5.4) | |

User setting **Lyric size**: 85% / 100% / 115% / 130%, a multiplier on `--ly-active`.

---

## 5. Space, grid, layout

- **Base unit 4px.** Spacing tokens: `--sp-1: 4` · `--sp-2: 8` · `--sp-3: 12` · `--sp-4: 16` ·
  `--sp-5: 24` · `--sp-6: 32` · `--sp-7: 48` · `--sp-8: 64` · `--sp-9: 96`.
- **One gap** in shell grids: `--gap: 16px` (horizontal and vertical). The sheet's 14 is rounded to
  the 4px grid because ECHO's album grid needs a 4px base. This is a recorded redraw, reason: grid
  arithmetic with 168px tiles.
- **Shell frame (taste-skill "Ruled T-frame", adapted):** a 224px sidebar (wordmark, Listen, Library,
  Search, Settings; utilities at the bottom; 34px nav pitch; active = label #B3B5B9 → #F2F1EE plus
  `--surface-3` pill at 8px radius) and **no top bar**. The sheet's 64px top bar is dropped because
  ECHO has nothing real to put in it, and an empty top bar is a flagged failure. Search lives in
  the sidebar as a 32px field with `/` hint. Recorded redraw.
- **Dock:** 88px tall, full width, `--surface-1` on shell screens and transparent over a scrim on
  the Stage.
- **Canvas gutter:** 32px from the sidebar rule and the window edge. Content is fluid; album grid
  columns = `floor((W + 16) / (168 + 16))`, tiles stretch to fill so edges land on both gutters.
  Write this arithmetic as a comment in the grid component.
- **Stage:** full-bleed, no sidebar. Lyric safe zone = central 76% width × 70% height above the dock.
- Breakpoints: `compact < 720px` (sidebar → bottom bar of 4 destinations, queue full-screen),
  `medium 720–1279`, `wide ≥ 1280`. The Stage keeps its composition at every width (§4.3 scales it).

---

## 6. Surfaces, elevation, blur

*(Shell: superseded by §0's tonal elevation, M3 shadows and corner scale. Blur: the Shell's
backdrop-blur ban was lifted for liquid glass on 2026-10-28, §7.11.)*

- **Elevation is lightness, never shadow, at rest** (sheet's move): ground → surface-1 → surface-2 →
  surface-3. A surface that floats (menu, popover, tooltip, dialog, toast) additionally gets
  `--shadow-float: 0 12px 32px rgba(0,0,0,.45), 0 0 0 1px #2A2D33`. This is the only shadow.
- **Radii (bimodal, soft):** `--r-panel: 16px` (sheets, dialogs, settings panels), `--r-card: 12px`
  is **not** used (weak-site default). Controls are `--r-pill: 999px` (buttons, chips, search) or
  `--r-control: 8px` (inputs, nav pill). Artwork: `--r-art: 4px` at ≤ 64px, `8px` above (§8).
  Nested radii step down.
- **Blur.** Backdrop blur appears only as part of **liquid glass** (§7.11), in both zones: the
  light frost before the refraction, and the plain blur fallback where SVG backdrop filters are
  missing. Sheets over the Stage (queue, help) stay an **opaque** surface at 100%: a sheet over an
  animated field must not show smeared motion through it, because that is distracting and costs
  GPU. On the Stage, blur is otherwise used only as **depth of field** on lyric lines
  (`LYRICS_EXPERIENCE.md` §4) and inside the environment shader. Blur radius cap: **4px on lines the user might read ahead (+1…+3), 8px on background and
  past lines** (taste-skill motion rule 10: blur ≤ 8px).

---

## 7. Light, gradients and atmosphere (Stage; 7.11 in both zones)

Every effect has a purpose. Anything not on this list does not ship. 7.1–7.10 are the Stage's
only. 7.11, liquid glass, is approved for both zones (owner, 2026-10-28).

| # | Effect | Purpose | Limits |
|---|---|---|---|
| 7.1 | **Word illumination sweep:** a horizontal gradient `--lyric-ink-active` → `--art-highlight` → `--text`, moving across each word with its timestamp | Shows *exactly* where the voice is | Leading edge soft width = 0.35em. Sweep is the only animated gradient on text. |
| 7.2 | **Active-word glow:** a drop-shadow halo in `--art-glow-solid` (a text-shadow would veil the sweep, `LYRICS_EXPERIENCE.md` §5.2) | Makes the sung word the brightest object in the room, like a lamp | Radius 0.18em, alpha ≤ 0.35 (≤ 0.55 at peak sustain); never on more than the current word + the previous word fading out |
| 7.3 | **Halation:** a warm red-shifted edge glow around the active line's lit text (film optics) | Signature "filmed, not rendered" quality; separates text from the field | Composited in the environment pass at ½ res; strength 0.08–0.18 |
| 7.4 | **Room light field:** the environment shader (`VISUALIZER_SPEC.md`) | Ambient light *from the cover*; carries energy without moving the text | Exposure capped by §3.4 rule 6 |
| 7.5 | **Wavefront rings** (Reverb mode): expanding rings from onsets with exponential decay | Turns the idea (an echo) into the visual response to transients | ≤ 3 alive at once; alpha ≤ 0.22; disabled in reduced motion |
| 7.6 | **Vignette:** elliptical, `--art-shadow`, 12–20% falloff | Pulls the eye to the centre and darkens corners under chrome for contrast | Static |
| 7.7 | **Scrims:** a bottom gradient under the dock (0 → `--scrim-dock` alpha over 220px) and a top one (0 → `--scrim-top` over 120px) when chrome is visible. 2026-10-28: lightened from 0.72 and 0.5 to 0.4 and 0.25, because the glass chrome (7.11) sits right on them and its fill now carries part of the contrast | Contrast for controls over a moving field | Neutral `--art-shadow` only |
| 7.8 | **Dither:** blue-noise ±1 LSB as the last shader step, on every gradient | Prevents 8-bit banding in dark gradients (functional, not stylistic) | Always on |
| 7.9 | **Grain (optional, off by default):** luminance-only, 2–3%, 24 fps | Film texture for users who want it | Settings → Visuals → "Film grain" |
| 7.10 | **Bloom:** threshold bloom on the lit word and wavefronts only | Lets light bleed like a lamp | Threshold L > 0.85, intensity ≤ 0.6, ½ res. **No anamorphic streaks** (rejected, §14) |
| 7.11 | **Liquid glass** (both zones, 2026-10-28): a floating surface bends what is behind it through a curved rim and catches a specular edge light. Stage: the top chrome's round buttons and brightness pill, the dock. Shell: sidebar, dock, sheets, dialogs | Controls that float over the content without hiding it: the room (Stage) or the page (Shell) stays visible under them, so the chrome reads as one object lying on the music instead of a panel cut out of it | Floating surfaces only, never content. Refraction only inside the rim (`--glass-bezel`); the interior shows the backdrop unbent. Frost ≤ 8px (§6). Sheets over the Stage stay opaque (§6). Text on glass keeps its §12 contrast against the surface's fill alone |

### 7.11 Liquid glass

**Technique.** In Chromium, each glass element gets its own SVG filter as its `backdrop-filter`
(`ui/glass.ts`), rebuilt when the element resizes: a light frost (`feGaussianBlur`), then a
displacement (`feDisplacementMap`) whose map is computed per element from Snell's law across a
convex squircle rim, then saturation, then a specular rim light (an `feImage` over the result). The
element's own background is its role colour made translucent, so the surface keeps its M3 (Shell)
or room (Stage) tone.

**Two variants**, as in iOS: **regular** glass (sidebar, dock, sheets, dialogs) frosts what is
behind it, so content passing under a panel never competes with the panel's text; **clear** glass
(the Stage's round buttons and brightness pill) barely frosts, since it carries only icons over a
room that is already blurred. On the Stage the dock's glass is a layer under its controls, so it
fades with the chrome.

**Tokens** (`tokens.css`; DS-01 holds: no glass value lives in component code):

| Token | Controls |
|---|---|
| `--glass-fill` | Share of its M3 surface colour a Shell glass surface keeps (the rest is backdrop) |
| `--glass-fill-stage` | Share of `--art-room` in a Stage glass surface |
| `--glass-frost`, `--glass-frost-clear` | Blur before the bend (SVG filter): regular glass, and clear glass (the Stage chrome sets `--glass-frost` to it) |
| `--glass-blur` | Blur of the fallback (no SVG backdrop filters); ≤ 8px (§6) |
| `--glass-saturate` | Saturation of what shows through, both paths |
| `--glass-thickness`, `--glass-bezel`, `--glass-ior` | The glass the map is computed for: slab thickness, rim width, refractive index |
| `--glass-refraction` | Scale on the computed bend (0 = flat glass) |
| `--glass-specular`, `--glass-light` | Rim light opacity and its direction |

**Fallbacks.** Engines without SVG backdrop filters (Firefox, Safari): the same translucent fill
over `blur(--glass-blur) saturate(--glass-saturate)`, no refraction. `prefers-reduced-transparency:
reduce`: no backdrop filter, and the fill goes to 100%, so every glass surface is the opaque surface
it was before 2026-10-28. Reduced motion changes nothing: glass is static and never animates by
itself. Hidden chrome (PRODUCT_SPEC.md §6.1) fades the glass with its controls.

**Open (Spotify).** A glass sheet over the Library bends the covers under it. Spotify forbids
distorting or blurring its artwork (`PLAYBACK_ARCHITECTURE.md` §4.6, §8 here). Before Spotify ships
with glass, either sheets over Spotify artwork go opaque or this is cleared against the guidelines.

---

## 8. Artwork presentation

- Artwork is **never cropped, recoloured, blurred-and-stretched, or overlaid with text**. This is the
  safe reading of provider artwork rules and respects the artist's work. The room is built from
  *extracted colours*, not from a blurred copy of the cover. Blurred covers carry their text and
  borders into the room (research §1, Plexamp write-up).
- **Corner radius is 4px or 8px only**, everywhere and for every provider. Spotify's design
  guidelines allow exactly these two values [C], and one rule for all artwork keeps the system simple.
- Sizes: 40 (rows), 64 (dock), 168+ (grid), 240 (Detail header), up to `min(60vh, 640px)` (Cover
  mode).
- On track change in Cover mode: **opacity-only** crossfade (old out over 420 ms, new in over 640 ms,
  overlapping 200 ms). The artwork itself is never scaled, moved or animated (Spotify: "no
  animation"). It is applied to all providers for one consistent behaviour.
- **Spotify content** additionally requires (`PLAYBACK_ARCHITECTURE.md` §4.6): the Spotify logo
  (≥ 70px wide) beside Spotify metadata/artwork, metadata linking back to Spotify, and artwork plus
  metadata **visible whenever Spotify audio plays**. Chrome auto-hide therefore never hides the dock's
  artwork, title and artist for Spotify tracks.
- Missing artwork: a `--surface-2` square with the album title set in the ECHO face (`--font`) at 600, 18% of the
  square, `--muted`, left-aligned at 8% inset. No placeholder icon.

---

## 9. Components

*(Shell: the M3 components of §0 replace §9.1, §9.3–§9.7. §9.2 Transport is the player's and
unchanged.)*

Each component lists its states. All interactive components have **default, hover, pressed,
focus-visible, disabled**, and loading where relevant. Focus is always a 2px `--focus` outline at a
2px offset, following the shape's radius.

### 9.1 Buttons

| Variant | Spec | Use |
|---|---|---|
| Primary | 36px tall, pill, `--text` fill, `--ground` label 14/500, 16px horizontal padding | One per screen: "Play" in Detail, "Save" in a settings panel, "Connect" |
| Secondary | 36px, pill, transparent, 1px `--control` border, `--text` label | "Shuffle", "Test connection" |
| Tertiary | text only, `--text`, underline on hover (0.07em, 0.18em offset) | "View all", "Retry" |
| Destructive | Secondary shape, `--negative` border + label | "Disconnect", "Clear queue" (with confirmation) |
| Icon button | 36px hit area (40px on Stage), 20px outline icon at 1.5px stroke, `--muted` → `--text` on hover | Queue, settings, ⋯ |

Hover: fill shifts one surface step (or primary to `#FFFFFF`). Pressed: `scale(0.97)` for 140 ms.
Disabled: label `--faint`, border `--line`, plus a tooltip or adjacent text saying why. Opacity is
never used for disabled.

### 9.2 Transport

- **Play/pause:** 56px circle, `--text` fill, glyph in `--ground`. On the Stage the glyph is
  `--art-room` (the colour of the room, inverted). Glyph morph play↔pause 180 ms.
- **Prev/next:** 40px icon buttons. **Shuffle/repeat:** 36px; active = glyph `--art-accent` plus a 4px
  dot beneath (state is never shown by colour alone).
- **Scrubber:** visible track 4px (`--surface-3`), fill `--art-accent`, buffered range `--control`
  at 40%. Hit area 24px tall. Hover: track → 6px over 150 ms and thumb (12px `--text` circle)
  appears. Pointer-down jumps to the point. Drag shows a time bubble (12px tabular) **and the lyric
  line at that time** above the cursor. Release seeks. Keyboard: `role="slider"`,
  `aria-valuetext="1 minute 42 seconds of 4 minutes 5 seconds"`, ←/→ ±5 s, Shift ±15 s,
  Home/End.
- **Volume:** 96px horizontal slider, perceptual curve (`gain = v³`), wheel ±5%, mute toggles to the
  previous value.
- **Provider/device mark:** 12px text "Navidrome" / "Spotify · ECHO" in `--faint` at the dock's right.

### 9.3 Lists and tables (shell)

- Track row 48px (single line) / 64px (with artwork 40px and subline). No zebra striping. Rules
  `--line` between rows only in Detail tables. Header 12px `--faint`, sentence case.
- Hover: `--surface-2` fill (an ECHO deviation from taste-skill §7.8 "outline hover". Reason: rows are
  play targets and need a large visible target in a dark UI). Selected: `--surface-3`. Now playing:
  title in `--art-accent` plus the animated 3-bar glyph (static under reduced motion), plus the
  decay trace (§2, item 3).
- Numbers (duration, track #) right-aligned, tabular.

### 9.4 Album tile

- Cover at tile width, `--r-art-lg`, title 14/500 `--text` 8px below, artist 12 `--muted`. Hover:
  a 32px play button appears at the right end of the **title row, below the cover**, never on top
  of the artwork (no overlays on art: §8). The cover's surround brightens one surface step. The tile
  does not lift or zoom.

### 9.5 Inputs, toggles, selects

- Input 40px, `--surface-2` fill, 1px `--control` border, `--r-control`, label above at 14/500
  (taste-skill §8.1), placeholder in `--faint`. Error: border `--negative` plus a 12px message below
  with an icon. Secret fields: masked, with "Show" toggle, never prefilled from the server
  (`SETTINGS_AND_SECURITY.md` §6.1).
- Toggle 32×18, off track `--control`, on track `--text` with a `--ground` knob (semantic, not
  accent).

### 9.6 Sheets, menus, dialogs, toasts

- **Queue sheet:** 400px, `--surface-1`, `--r-panel` on the leading corners, enter `translateX(24px)`
  + opacity over 240 ms `--ease-out`. Focus moves into the sheet; `Esc` closes and returns focus.
  Glass (§7.11) over the Shell; opaque over the Stage (§6).
- **Menu:** `--surface-2`, `--shadow-float`, 8px radius, 32px items, opens from the trigger
  (scale 0.98 → 1, 160 ms).
- **Dialog:** for destructive confirmation only. Names the object ("Disconnect Navidrome
  (music.home.lan)?"), states the consequence, and uses a destructive primary.
- **Toast:** bottom-centre above the dock, `--surface-2`, 14px, 4 s, max 1 visible, `role="status"`.
  Used for offsets ("Lyrics −100 ms"), queue additions, and saved settings.

### 9.7 Connection status row (Settings)

Provider mark + name (16/500), status pill (Connected / Not connected / Reconnecting / Error), one
line of `--muted` detail ("music.home.lan · Navidrome 0.5x · 41,203 tracks"), actions on the right
(Test, Disconnect / Connect). Example in `SETTINGS_AND_SECURITY.md` §8.

---

## 10. States

taste-skill app-screens §11, applied:

- **Loading:** the final layout with flat `--surface-2` bars at the real size of each value. No
  shimmer. Covers show `--surface-2` (or the cached dominant colour, darkened to `--art-room`).
  Nothing shifts when data lands.
- **Empty:** frame and header stay, plus one sentence and one action ("No playlists on this server
  yet."). No illustrations.
- **Error:** inside the block that failed: one sentence (what failed + last good time) plus Retry.
  Never a full-screen error unless no provider is reachable at all.
- **Offline/reconnecting:** status in the dock (`--warning` pill), with library content kept visible
  from cache and a freshness note.
- **Stage-specific states** (no lyrics, lyrics loading, ambient-only) are in `LYRICS_EXPERIENCE.md` §9.

---

## 11. Motion system

*(Shell feedback motion uses the M3 Expressive springs of §0; the Stage's two clocks are unchanged.)*

ECHO runs **two clocks** that never mix (research principle 9):

| Clock | Drives | Character |
|---|---|---|
| **UI clock** | Shell feedback, sheets, menus, toasts | Short ease-outs, 140–320 ms |
| **Song clock** | Lyric field, environment, palette, Cover transitions | Timestamp-locked positions with springs and slow eases, 400–1600 ms |

### 11.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 140ms | Press scale |
| `--dur-hover` | 180ms | Colour change on hover |
| `--dur-ui` | 240ms | Sheets, menus |
| `--dur-toast` | 320ms | Toast in/out |
| `--dur-art` | 640ms | Cover crossfade in |
| `--dur-palette` | 1200ms | Palette interpolation between tracks |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` (expo-out) | Most UI moves |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | Things that travel (palette, cover) |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | Things leaving for good, 60–70% of entrance duration |
| `ease` | CSS default | Colour-only changes |

Springs for the lyric field (stiffness, damping, mass, per element type) are defined in
`LYRICS_EXPERIENCE.md` §6, because they are part of that spec's timing model.

### 11.2 Rules

- Animate `transform`, `opacity`, `filter` (Stage only) and shader uniforms. Never animate layout
  properties.
- No bounce or elastic overshoot on UI elements. Lyric **line** springs are critically damped or
  slightly under-damped (ζ ≥ 0.85), so lines never visibly bounce. The small impulse springs (beat
  kicks ζ 0.5, emphasis lift ζ 0.75) are under-damped by design but amplitude-capped
  (≤ 2px, ≤ 0.08em), so their overshoot is below perception (`LYRICS_EXPERIENCE.md` §6.1).
- Nothing in the shell performs an entrance on load (taste-skill app rule). Rows arriving from a
  fetch fade in over 180 ms with no travel.
- **Reduced motion** (`prefers-reduced-motion: reduce`, or the in-app override): drop travel,
  scale, parallax, blur animation, wavefronts and beat response. Keep opacity and colour changes
  (palette still interpolates over 1200 ms). Full Stage behaviour is in `LYRICS_EXPERIENCE.md` §10.

---

## 12. Accessibility baseline

- WCAG **2.2 AA** for the shell. The Stage meets AA for the active line and upcoming lines (§3.4).
- Targets: ≥ 24×24 CSS px everywhere (2.5.8); transport ≥ 40px; Stage controls ≥ 40px.
- Focus visible on every control and never obscured by the dock or a sheet (2.4.11).
- Colour is never the only signal (shuffle/repeat dots, status pills have text).
- **Photosensitivity:** no element may flash more than **3 times per second**, and no large-area
  luminance change above the WCAG 2.3.1 general-flash threshold. Beat response is limited by
  `VISUALIZER_SPEC.md` §7.3 (luminance slew limit). The check is in `ACCEPTANCE_CRITERIA.md` A11Y-08.
- Text resizes to 200% without loss in the shell. Stage lyric size has its own setting (§4.3).

---

## 13. Token file (normative)

The implementation's `tokens.css` starts from this block verbatim. Dynamic `--art-*` defaults are
the fallback (achromatic) palette and are overwritten at runtime.

```css
:root {
  color-scheme: dark;

  /* neutral shell */
  --ground: #0A0B0D;  --surface-1: #131417;  --surface-2: #1C1E22;  --surface-3: #272A2F;
  --line: #202226;    --control: #666A71;
  --text: #F2F1EE;    --muted: #B3B5B9;      --faint: #94979C;      --focus: #F2F1EE;
  --positive: #7FD6A0; --warning: #E5A93B;   --negative: #EF6B6B;
  --pill-pos-bg: #15261C;  --pill-pos-ink: #7FD6A0;
  --pill-warn-bg: #2B2414; --pill-warn-ink: #E5A93B;
  --pill-neg-bg: #2C1A1C;  --pill-neg-ink: #EF6B6B;
  --pill-neutral-bg: #1C1E22; --pill-neutral-ink: #F2F1EE;
  --fallback-accent: #E3B26B;

  /* dynamic artwork palette (runtime-overwritten; these are the achromatic fallback) */
  --art-room:      oklch(0.16 0.006 250);
  --art-accent:    #E3B26B;
  --art-highlight: oklch(0.92 0.04 80);
  --art-glow:      oklch(0.68 0.10 75 / 0.35);
  --art-glow-solid: oklch(from var(--art-glow) l c h);   /* lyric glow takes its own alpha (M3) */
  --art-shadow:    oklch(0.08 0.004 250);
  --lyric-ink-active: oklch(0.95 0.006 80);

  /* type */
  --font: "Mona Sans", system-ui, sans-serif;   /* decided in M1 (§4.1) */
  --fs-title: 20px; --fs-section: 16px; --fs-figure: 24px; --fs-body: 14px; --fs-small: 12px;
  --lh-title: 28px; --lh-section: 24px; --lh-figure: 30px; --lh-body: 20px; --lh-small: 16px;
  --ly-active: clamp(32px, min(6.2vh, 4.6vw), 88px);

  /* space */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px;
  --sp-6: 32px; --sp-7: 48px; --sp-8: 64px; --sp-9: 96px;
  --gap: 16px; --gutter: 32px; --sidebar: 224px; --dock: 88px;
  --form-w: 420px;   /* sign-in, setup and connection forms (M5) */

  /* shape */
  --r-pill: 999px; --r-control: 8px; --r-panel: 16px; --r-art: 4px; --r-art-lg: 8px;
  --shadow-float: 0 12px 32px rgba(0,0,0,.45), 0 0 0 1px #2A2D33;

  /* controls */
  --control-h: 36px; --input-h: 40px; --row-h: 48px; --row-h-media: 64px; --nav-pitch: 34px;

  /* component sizes (§5, §8, §9; added in M2) */
  --rule: 1px; --focus-ring: 2px; --trace: 2px; --dot: 4px;
  --icon: 20px; --hit-lg: 40px; --play: 56px; --tile-play: 32px; --search-h: 32px; --menu-item-h: 32px;
  --tile-min: 168px; /* phones: --tile-min-compact 132px, two columns at 390 (M9) */ --art-row: 40px; --art-dock: 64px; --art-detail: 240px; --art-cover-max: 640px;
  --scrub-track: 4px; --scrub-thumb: 12px; --scrub-hit: 24px; --volume-w: 96px;
  --toggle-w: 32px; --toggle-h: 18px; --toggle-knob: 14px;
  --target-min: 24px;           /* M9: WCAG 2.5.8 floor; switches pad their 18px track to it */
  --spotify-logo: 80px;         /* M7: Spotify's full logo, never under 70px wide */
  --sheet-w: 400px; --signin-w: 360px;
  --primary-hover: #FFFFFF;

  /* motion */
  --dur-press: 140ms; --dur-hover: 180ms; --dur-ui: 240ms; --dur-toast: 320ms;
  --dur-art: 640ms; --dur-palette: 1200ms;
  --dur-pop: 160ms; --dur-scrub: 150ms; --dur-loop: 1000ms;   /* added in M2 */
  --dur-art-out: 420ms; --dur-art-overlap: 200ms;   /* Cover crossfade, §8 (M2) */
  --ease-out: cubic-bezier(.16,1,.3,1);
  --ease-in-out: cubic-bezier(.65,0,.35,1);
  --ease-exit: cubic-bezier(.4,0,1,1);
}
.num { font-variant-numeric: tabular-nums; }
```

---

## 14. Critique of this system

Applied with the **design-critique** framework and taste-skill **tells.md**. Every listed failure
mode was checked against the system and either designed out or justified.

| Risk (from the skills) | Status in ECHO | Reasoning |
|---|---|---|
| Glassmorphism (tells §1, app house rules) | **Adopted, limited** (owner, 2026-10-28) | Liquid glass (§7.11) on floating surfaces only, with a stated purpose: refraction at the rim instead of a heavy frost, frost ≤ 8px, opaque under reduced transparency, sheets opaque over the moving Stage. Content surfaces never turn to glass. |
| Neon glow on dark | **Constrained** | Glow exists on exactly one object (the sung word), with an alpha cap, derived from the cover. A glow on a button or border is a defect. |
| Gradient text | **Justified exception** | The word sweep (7.1) is the brief's core requirement, and it *encodes time*, so it is information, not decoration. It is not used on any other text. |
| Generic dark dashboard (sidebar + KPI cards) | **Designed out** | No KPI tiles, no cards with icons. The Library is a cover grid, which is the product's real object (app-screens: "cover art shows the cover"). |
| Kit typeface (Inter/Geist) | **Designed out** | Mona Sans, chosen in M1 from a Stage specimen against Geologica (§4.1). |
| Animation for its own sake | **Constrained** | Stage motion is timestamp- or audio-caused (two clocks). The shell has no entrances. Idle loops pause when the window is hidden. |
| Anamorphic lens streaks | **Rejected** | Proposed in research. Reads as sci-fi trailer cliché and competes with the lyric. |
| Feedback-buffer trails behind text | **Rejected for text** | They smear lyrics. Allowed only inside the environment (VISUALIZER Reverb mode), never sampled over the lyric layer. |
| Monospace "instrument readouts" | **Rejected** | Proposed in research. taste-skill bans mono outside code, and tabular figures do the job. |
| Word-ghost trails (research direction C) | **Adopted, limited** | Past *lines* dissolve with a drifting afterimage (`LYRICS_EXPERIENCE.md` §7). This is the "reverb tail" made visible. Single ghost, ≤ 900 ms. |
| Pure #000 ground | **Changed** | `#0A0B0D` (sheet-sanctioned cool near-black). Avoids OLED smear behind moving text. |
| Centred text | **One moment** | Lyrics only. The shell is left-aligned. |

**Squint test (planned for M2):** the Listen screen should read as three masses: the active line,
the dock, and the room. Library should read as: a cover grid, the dock, and a quiet sidebar. If a
fourth mass appears (glow, a busy environment, chrome), reduce it.
