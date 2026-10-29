# ECHO — Design System

Status: **Draft 4** · 2026-10-29: ECHO redesigned after Spotify, web and Android (owner decision;
`docs/superpowers/specs/2026-10-29-spotify-redesign-design.md`) · liquid glass kept (§7.11)
Related: [Redesign spec](superpowers/specs/2026-10-29-spotify-redesign-design.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Visualizer](VISUALIZER_SPEC.md)

This is the visual language of the whole application: tokens, component rules and the reason each
effect exists. Implementation takes every colour, size, duration and easing from the tokens in
`src/client/tokens.css` (§13). A raw value in a component counts as a defect
(`ACCEPTANCE_CRITERIA.md` DS-01, checked by `src/client/design-rules.test.ts`).

**2026-10-29: ECHO looks like Spotify.** The owner asked for the app to look "very much like
Spotify", keeping liquid glass. This draft replaces the Material 3 shell (Draft 3, §0) and Reverb
Chamber's player chrome. The name and the wordmark stay ECHO's; none of Spotify's brand marks are
used, except Spotify's own logo where its attribution rules require it (§8).

---

## 1. Principles

1. **Spotify's frame, ECHO's music.** A black frame, dark rounded panels, white and grey text, one
   green accent. The page tints itself with its cover's colour; everything else stays neutral, so
   artwork is the only colour on screen besides the green.
2. **Green means play.** `--green` is for the play buttons, the song or context playing now, toggles
   that are on, and saved hearts. Nothing else is green.
3. **Glass floats.** Liquid glass is for what floats over content: the player pill, the phone mini
   player and tab bar, the sticky page header, menus, sheets and dialogs (§7.11). Panels and pages
   are never glass.
4. **The lyrics view is the one immersive screen.** It fills the window with the cover, blurred
   (the room, `VISUALIZER_SPEC.md`), and keeps ECHO's word-timed lyric column (§4.3).

Zones: **the app** (every page, the panels, the player) follows §3–§10. **The lyrics view**
(`/listen`) adds the light effects of §7 to the same tokens; its stylesheet (`stage/stage.css`) is
the one exempt from DS-02's checks.

---

## 2. Frame

```
wide (≥ 1280px)                         medium (720–1279)          compact (< 720)
┌──────────────── top bar ───────────────┐ ┌──── top bar ────┐       ┌─────────────┐
│ ECHO   (⌂) [ What do you want to play? ]  (F) │ │                 │       │   page      │
├────────┬──────────────────────┬────────┤ ├────┬────────────┤       │             │
│ Your   │  page (scrolls)      │ Now    │ │ lib│  page      │       │             │
│ Library│                      │ Playing│ │    │            │       ├─────────────┤
│        │  ╭── glass pill ──╮  │ / Queue│ │    │ ╭─ pill ─╮ │       │ mini player │
└────────┴──╰────────────────╯──┴────────┘ └────┴─╰────────╯─┘       │ ⌂  ⌕  Library│
                                                                      └─────────────┘
```

- **Top bar** (`--topbar`): the ECHO wordmark, a round Home button, the search pill, the account
  menu (Account, Settings, Admin, Log out).
- **Your Library** (`--library-w`; covers only, `--library-w-min`, below 1024px): Liked Songs,
  playlists, albums, artists; filter chips, a search, the library's order; "+" makes a playlist.
- **The page**: `--panel`, `--r-panel` corners, its own scroll.
- **Right panel** (`--np-w`, wide only): Spotify's Now Playing view (cover, song and heart, About
  the artist, Next in queue) or the queue, toggled from the player.
- **The player** floats over the bottom of the page as a liquid-glass pill (`--pill-h`,
  `--pill-max`, `--pill-inset`); the page keeps room under its content for it.
- **Compact**: no top bar or panels; the glass mini player (`--mini-h`, tinted by the playing
  album) over the glass tab bar (`--tabbar`: Home, Search, Your Library). The mini player opens the
  lyrics view.
- **Lyrics view** (`/listen`): the whole window; the pill floats over it and fades when the pointer
  rests (PRODUCT_SPEC.md §6.1).

## 3. Colour

### 3.1 Neutrals and the accent

| Token | Value | Use |
|---|---|---|
| `--frame` | #000 | The frame around the panels |
| `--panel` | #121212 | Panels, pages |
| `--raised` / `--raised-2` / `--raised-3` | #1F1F1F / #2A2A2A / #333 | Search pill, cards on hover, chips, menus |
| `--text` / `--muted` | #FFF / #B3B3B3 | Primary and secondary text |
| `--green` (`--green-hover`, `--green-press`) | #1ED760 | Play, playing, on, saved |
| `--hover-row`, `--selected-row` | white at 10% / 20% | Row and list states |
| `--negative`, `--warning` | #F15E6C, #FFA42B | Errors, the offline note |

The `--md-sys-color-*` names the components were written against map onto these values; new code
uses the names above.

### 3.2 Tints from the cover

A page header takes its cover's accent (the server's palette, `VISUALIZER_SPEC.md` §6) as
`--tint`; `[data-tint]` turns it into `--head-colour`, Spotify's header tone: OKLCH lightness 0.42,
chroma at most 0.13, the cover's hue. The body under the header fades from it to `--panel` over
`--body-fade`. Without a tint, `--head-fallback` (#535353). The playing album's tone,
`--playing-tint`, colours the phone mini player. Liked Songs keeps Spotify's violet-to-mint
(`--liked-from`, `--liked-to`); Browse all's genre cards take one of twelve category colours
(`--genre-0…11`), picked by name.

### 3.3 Dynamic artwork palette

The `--art-*` roles (room, accent, highlight, glow, shadow, active ink) are unchanged: the lyrics
view and its room use them (`VISUALIZER_SPEC.md` §6.4), and `--playing-tint` derives from them.

### 3.4 Contrast

White on `--head-colour` keeps ≥ 4.5:1 by construction (lightness 0.42). Secondary text on tints
is `--text-on-tint` (white at 72%). Lyric contrast guarantees are `LYRICS_EXPERIENCE.md` §3.4's.

## 4. Typography

### 4.1 Family

**Figtree** (OFL, self-hosted, weights 300–900), a free face close to Spotify's Circular,
everywhere, lyrics included. Figtree has no width axis: a long lyric line shrinks, then wraps
(`stage/lyrics/layout.ts`).

### 4.2 Scale

| Role | Token | Use |
|---|---|---|
| Page title | `--title-xl/l/m/s` (800, 96/72/48/32px, tracking `--tracking-title`) | Album, artist, playlist headers, stepping down with the title's length |
| Headline | `--md-sys-typescale-headline-medium` (700 32px) | Page headings, Good morning |
| Section | `--md-sys-typescale-title-large` (700 24px) | Shelves, sections |
| Title | `--md-sys-typescale-title-medium` / `-small` (700 16/14px) | Panel heads, card titles in shortcuts |
| Body | `--md-sys-typescale-body-large` / `-medium` (400 16/14px) | Rows, cards, text |
| Small | `--md-sys-typescale-body-small` (400 12px) | Times, notes |

### 4.3 Lyrics

The active line is `--ly-active` (desktop) or `--ly-phone`, bold, start-aligned, in one column
whose lines dim and blur with distance (`LYRICS_EXPERIENCE.md` §4). Settings → Lyrics → size
scales it.

## 5. Space and layout

4px steps (`--sp-1…9`); page gutter `--gutter` (16px on phones). Cards are at least `--tile-min`
wide (`--tile-min-compact` on phones) and fill the row; a shelf shows one row of them (a sideways
scroll on phones). Breakpoints are the one raw value in CSS: compact < 720px, medium 720–1279px,
wide ≥ 1280px; container queries narrow the pill.

## 6. Surfaces and elevation

Panels are flat (`--panel`). Shadows only on what floats (`--md-sys-elevation-level1…3`), on
cards' covers (`--card-shadow`), page covers (`--shadow-art`) and the play buttons
(`--shadow-play`). Frost on glass is ≤ 8px in the fallback path.

## 7. Light, gradients and atmosphere

Gradients in the app are Spotify's own: a page header's shade (`--header-shade`, transparent to
black at 50%), the body's fade from the header colour, Liked Songs' colours, the sign-in page. The
lyrics view keeps ECHO's light (7.1–7.10 of Draft 3, `VISUALIZER_SPEC.md` §5): the word sweep and
glow, the room drawn from the blurred cover, dither, optional grain.

### 7.7 Scrims

Under the lyrics view's chrome, a top scrim (0 → `--scrim-top`) and one above the pill
(0 → `--scrim-dock`), in `--art-shadow`, so the controls keep contrast over the moving room.

### 7.11 Liquid glass

**Technique.** In Chromium, each glass element gets its own SVG filter as its `backdrop-filter`
(`ui/glass.ts`), rebuilt when the element resizes: a light frost, a displacement whose map is
computed per element from Snell's law across a convex squircle rim, saturation, and a specular rim
light. The element's own background is its surface colour made translucent. Over the lyrics view,
while WebGL draws the room, a glass pass draws the pill's and the chrome's glass itself
(`VISUALIZER_SPEC.md` §5.2); without WebGL 2 the SVG or blur glass comes back.

**Where.** The three panels (Your Library, the page, Now Playing and the queue), mostly opaque
so text reads, over a frame tinted by the playing album (`--ambient-*`) that the glass bends at
their edges; the top bar's Home button and search pill; the player pill; the phone mini player
(tinted by the playing album) and tab bar; the sticky page header (tinted by the page); menus;
sheets; dialogs; toasts; the lyrics view's round close button (clear glass). Under the lyrics
view the page panel is not glass: the Stage draws its own room and glass.

**Tokens** (`tokens.css`):

| Token | Controls |
|---|---|
| `--glass-fill` | Share of its surface colour a glass surface keeps (the rest is backdrop) |
| `--glass-fill-stage` | Share of `--art-room` in glass over the lyrics view |
| `--glass-tint-mini` | Share of the playing album's tone in the phone mini player |
| `--glass-fill-panel` | Share of `--panel` the three panels keep |
| `--glass-fill-pill` | Share of `--raised` the top bar's pills and the toast keep |
| `--ambient-a`, `--ambient-b` | Share of the album's accent and highlight in the frame behind the panels |
| `--glass-frost`, `--glass-frost-clear` | Blur before the bend: regular glass, and clear glass |
| `--glass-blur` | Blur of the fallback (no SVG backdrop filters); ≤ 8px (§6) |
| `--glass-saturate` | Saturation of what shows through |
| `--glass-thickness`, `--glass-bezel`, `--glass-ior` | The glass the map is computed for |
| `--glass-refraction` | Scale on the computed bend (0 = flat glass) |
| `--glass-specular`, `--glass-light` | Rim light opacity and direction |
| `--glass-edge` | The hairline around a glass surface |

**Fallbacks.** Engines without SVG backdrop filters: the translucent fill over
`blur(--glass-blur) saturate(--glass-saturate)`. `prefers-reduced-transparency: reduce`: no backdrop
filter and opaque fills. Sheets over the lyrics view stay opaque.

**Spotify artwork.** Spotify forbids overlaying or distorting its artwork (§8): the card's play
button does not sit on a Spotify cover, and glass never rests over Spotify artwork for long.

## 8. Artwork

- Never cropped by a frame other than its own square, never recoloured. 4px radius in lists and
  pages, 6px on cards, round for artists, round in the player pill.
- Sizes: `--art-row` 40, `--art-list` 48, `--art-dock` 56, `--art-shortcut` 64, cards fill their
  column, `--art-detail` 232, the lyrics view `--np-art`.
- Spotify content keeps Spotify's logo and links in the player (PLAYBACK_ARCHITECTURE.md §4.6).
- The green play button rises onto a card's cover corner on hover and focus (Spotify's), except on
  Spotify's own covers.

## 9. Components

### 9.1 Buttons

Pills (`--r-pill`), 48px: **primary** green with black text, **secondary** outlined, **tertiary**
text only, **destructive** outlined in `--negative`. Hover grows 4%; press shrinks 3%. Icon buttons
are bare glyphs in `--muted` that turn white and grow on hover; a toggle that is on is green with a
dot beneath (colour is never alone).

### 9.2 Player

The pill: song (cover, title, artists, heart) | shuffle, previous, the white play disc, next,
repeat over the progress bar | Now Playing view, lyrics, queue, sleep timer, volume (full screen on
the lyrics view). The progress and volume are white on grey and turn green with a thumb on hover.
Phones: the mini player shows the song, its heart and play/pause over a hairline of progress.

### 9.3 Track rows

Spotify's table: number (a play glyph on hover, bars while playing), title (green when playing)
with the artist under it where the list mixes albums, the heart (on hover; always once saved), the
duration, the ⋯ menu (Add to playlist, Go to song radio, Play next, Add to queue, Go to artist,
Go to album, and Remove from this playlist in a playlist). Phones drop the numbers and durations.

### 9.4 Cards and shortcuts

Cards: cover, title, subtitle on a surround that lights `--raised` on hover; the whole card is the
link. Home's shortcuts: a strip with a 64px cover and a bold title.

### 9.5 Inputs, toggles, chips

Fields are 48px with a 1px `--control` edge that turns white on hover and gets a second white pixel
inside on focus. Toggles are Spotify's: 40×24, a white knob sliding onto green. Chips are pills,
the chosen one white with black text.

### 9.6 Sheets, menus, dialogs, toasts

All glass (§7.11). Menus are compact (40px items). Toasts are a white pill above the player.

### 9.7 Connection status row (Settings)

Unchanged from Draft 3: name, status pill and detail, actions on the right.

## 10. States

- **Loading:** the final layout with flat `--raised-2` bars at the real size of each value. No
  shimmer. Nothing shifts when data lands.
- **Empty:** frame and header stay, plus one sentence and one action.
- **Error:** inside the block that failed: one sentence plus Retry.
- **Offline/reconnecting:** a note in the player, content kept from cache with a freshness note.
- Lyrics states are `LYRICS_EXPERIENCE.md` §9.

## 11. Motion system

### 11.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 140ms | Press and hover scale |
| `--dur-hover` | 180ms | Colour change on hover |
| `--dur-ui` | 240ms | Menus, the sticky header, the card's play button |
| `--dur-toast` | 320ms | Toast in/out |
| `--dur-art` | 640ms | The pill fading out, the lyrics view's side settling |
| `--dur-palette` | 1200ms | Palette interpolation between tracks |
| `--ease-out` / `--ease-in-out` / `--ease-exit` | | Entrances / travels / exits |

The lyric field's springs are `LYRICS_EXPERIENCE.md` §6's.

### 11.2 Rules

- Animate `transform`, `scale`, `opacity` and colour; never layout.
- No bounce on UI elements.
- **Reduced motion:** no scale, travel or loops; opacity and colour stay.

## 12. Accessibility baseline

- WCAG 2.2 AA. Targets ≥ 24×24px (2.5.8); focus visible on every control and never hidden by the
  pill or a sheet (2.4.11).
- Colour is never the only signal (toggle dots, status pills with text, hearts with labels).
- Photosensitivity limits are `VISUALIZER_SPEC.md` §7.3's.
- Text resizes to 200% without loss.

## 13. Token file

`src/client/tokens.css` is normative. Every colour, size, duration, easing, shadow and glass value
lives there; component code reads only custom properties (DS-01).
