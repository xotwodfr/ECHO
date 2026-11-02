# ECHO — Design System

Status: **Draft 6** · 2026-10-30: the web client in Fluent 2 with Mica (owner decision;
`docs/superpowers/specs/2026-10-29-fluent-web-design.md`). Draft 5 (2026-10-29): ECHO redesigned
after Spotify, web and Android, liquid glass dropped for performance (§7.11). The Android app keeps
Draft 5's Material 3 surfaces (`ANDROID_CLIENT.md`); this document describes the web client.
2026-11-02: the library switch in the top bar (§2, §9.5) and every page header in the playing
song's colour (§3.2).
Related: [Fluent spec](superpowers/specs/2026-10-29-fluent-web-design.md) · [Redesign spec](superpowers/specs/2026-10-29-spotify-redesign-design.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Visualizer](VISUALIZER_SPEC.md)

This is the visual language of the web application: tokens, component rules and the reason each
effect exists. Implementation takes every colour, size, duration and easing from the tokens in
`src/client/tokens.css` (§13). A raw value in a component counts as a defect
(`ACCEPTANCE_CRITERIA.md` DS-01, checked by `src/client/design-rules.test.ts`).

**2026-10-30: Spotify's layout, Fluent 2's surfaces, Mica from the album.** The owner already
runs a Material 3 Navidrome app, so ECHO's web client should not be a second one. The frame, pages
and features stay Spotify's; colour, surfaces, shape, type, icons, controls and states are
Microsoft's Fluent 2, dark only, and the playing album's colour glows through the frame the way
Windows 11's Mica takes the wallpaper's. Spotify's own touches stay: the genre colours, Liked
Songs' gradient, the big page titles, Made For You's lettering, the round play disc and the
floating player pill. The name and the wordmark stay ECHO's.

---

## 1. Principles

1. **Spotify's frame over the album's Mica.** Behind the frame, the playing album's palette
   (`--art-*`) is painted as a soft glow, blurred once per album into a still image
   (`palette/mica.ts`, §6). The panels are Fluent's translucent layer over it; what floats is
   opaque.
2. **Primary means play.** `--green` is an alias of `--fl-accent`, the album's accent as a Fluent
   ramp (`palette/fluent.ts`): play buttons, the song or context playing now, toggles that are on,
   saved hearts, selection markers. Nothing else is the accent.
3. **Fills, not filters.** Depth is a translucent fill, a hairline stroke and, for what floats, a
   Fluent shadow. Nothing reads its backdrop, and nothing is blurred while the app runs (§7.11).
4. **The lyrics view is the one immersive screen.** It fills the window with the cover, blurred
   (the room, `VISUALIZER_SPEC.md`), and keeps ECHO's word-timed lyric column (§4.3); only its
   chrome is Fluent.

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
│        │  ╭───── pill ─────╮  │ / Queue│ │    │ ╭─ pill ─╮ │       │ mini player │
└────────┴──╰────────────────╯──┴────────┘ └────┴─╰────────╯─┘       │ ⌂  ⌕  Library│
                                                                      └─────────────┘
```

- **Top bar** (`--topbar`): the ECHO wordmark, a round Home button, the library switch
  (`Navidrome | Spotify`, only with both connected; §9.5), the search pill, the account menu (the
  library choice when both are connected, Account, Settings, Admin, Log out). On phones the account
  menu opens from an avatar before Home's greeting.
- **Your Library** (`--library-w`; covers only, `--library-w-min`, below 1024px): Liked Songs,
  playlists, albums, artists; filter chips, a search, the library's order; "+" makes a playlist.
- **The page**: `--panel`, `--r-panel` corners, its own scroll.
- **Right panel** (`--np-w`, wide only): Spotify's Now Playing view (cover, song and heart, About
  the artist, Next in queue) or the queue, toggled from the player.
- **The player** floats over the bottom of the page as a round pill: a `--fl-flyout` surface with
  a hairline edge and shadow 16 (`--pill-h`, `--pill-max`, `--pill-inset`); the page keeps room
  under its content for it.
- **Compact**: no top bar or panels; the mini player (`--mini-h`, tinted by the playing album)
  over the tab bar (`--tabbar`, 80px, docked, `--fl-flyout`, the current destination's icon
  filled over a short accent bar: Home, Search, Your Library). The mini player opens the lyrics
  view.
- **Lyrics view** (`/listen`): the whole window; the pill floats over it and fades when the pointer
  rests (PRODUCT_SPEC.md §6.1).

## 3. Colour

### 3.1 Neutrals and the accent

Neutrals are Fluent 2's dark ones (WinUI 3 and `@fluentui/tokens` `webDarkTheme`), fixed.
The accent is the playing album's: `palette/fluent.ts` turns `--art-accent` into an HCT tonal
ramp (accent 80, hover 85, pressed 75, on-accent 10, accent text 82, subtle 30) published as
`--fl-accent*` and animated with the artwork palette by `palette/live.ts`; a grey seed stays grey.
`tokens.css` holds the fallback accent's ramp. The frame's names alias the tokens:

| Token | Fluent token | Use |
|---|---|---|
| `--frame` | transparent | The frame: Mica shows through (§6) |
| `--panel` | `--fl-layer` (#2C2C2C at 55%) | Panels, pages |
| `--raised` / `--raised-2` / `--raised-3` | `--fl-card` / `--fl-card-hover` / `--fl-control-hover` | Cards, the playing row, chips |
| `--text` / `--muted` / `--faint` | `--fl-fg1` / `--fl-fg2` / `--fl-fg3` | Primary, secondary, tertiary text |
| `--green` (`--green-hover`, `--green-press`, `--on-green`) | `--fl-accent` ramp | Play, playing, on, saved, markers |
| `--hover-row`, `--press-row`, `--selected-row` | `--fl-subtle-hover`, `--fl-subtle-press`, `--fl-card` | Hover, press and selected fills |
| `--line`, `--control` | `--fl-stroke`, `--fl-stroke-strong` | Hairlines, control edges |
| `--negative`, `--warning`, `--positive` | `--fl-danger`, `--fl-warning`, `--fl-success` | Errors, the offline note |
| `--focus` | `--fl-focus-outer` | The focus ring (§12) |
| (floating surfaces) | `--fl-flyout`, `--fl-dialog` | Menus, the player, toasts; dialogs, sheets |

### 3.2 The playing song's colour on every page

Every page header (album, artist, playlist, mix, genre, Liked Songs) takes **the playing song's**
colour, not its own cover's (owner, 2026-11-02): `--head-colour` is the playing album's accent
(`--art-accent`) as a calm header tone, OKLCH lightness 0.38 and chroma at most 0.10, animated with
the palette (§3.3). The body under the header fades from it to transparent over `--body-fade`, so the
same song's Mica glow (§6) shows below: one colour story for the whole window. Nothing playing:
the fallback accent's grey. The sticky bar is the same tone, opaque. `--playing-tint` (lightness
0.42) colours the phone mini player. The artwork keeps its own colours: Liked Songs' violet-to-mint
tile (`--liked-from`, `--liked-to`), the mix covers and Browse all's genre cards (`--genre-0…11`,
one of twelve picked by name).

### 3.3 Dynamic artwork palette

The `--art-*` roles (room, accent, highlight, glow, shadow, active ink) are unchanged: the lyrics
view and its room use them (`VISUALIZER_SPEC.md` §6.4), and `--playing-tint` derives from them.

### 3.4 Contrast

White on `--head-colour` keeps ≥ 4.5:1 by construction (lightness 0.42). Secondary text on tints
is `--text-on-tint` (white at 72%). Lyric contrast guarantees are `LYRICS_EXPERIENCE.md` §3.4's.

## 4. Typography

### 4.1 Family

**Segoe UI** (`"Segoe UI Variable Text"`, `"Segoe UI"`), Fluent's face, where Windows has it
installed; it is never shipped (its licence does not allow it). Everywhere else **Selawik**,
Microsoft's open Segoe UI fallback (OFL, self-hosted, 400/600/700, `fonts.css`). Lyrics included.
Neither has a width axis: a long lyric line shrinks, then wraps (`stage/lyrics/layout.ts`).

### 4.2 Scale

| Role | Token | Use |
|---|---|---|
| Page title | `--title-xl/l/m/s` (700, 96/72/48/32px, tracking `--tracking-title`) | Album, artist, playlist headers, stepping down with the title's length (Spotify's) |
| Title 1–3 | `--fl-type-title1/2/3` (600 32/28/24px) | Page headings, Good morning |
| Subtitle | `--fl-type-subtitle1` / `-subtitle2` (600 20/16px) | Sections, dialog titles; panel heads |
| Body | `--fl-type-body-large` / `-body` / `-body-strong` (16/24, 14/20, 600 14/20) | Rows, cards, text, buttons |
| Caption | `--fl-type-caption` / `-caption-strong` (12/16) | Times, notes, tab labels |

### 4.3 Lyrics

The active line is `--ly-active` (desktop) or `--ly-phone`, bold, start-aligned, in one column
whose lines dim and blur with distance (`LYRICS_EXPERIENCE.md` §4). Settings → Lyrics → size
scales it.

## 5. Space and layout

4px steps (`--sp-1…9`); page gutter `--gutter` (16px on phones). Cards are at least `--tile-min`
wide (`--tile-min-compact` on phones) and fill the row; a shelf shows one row of them (a sideways
scroll on phones). Breakpoints are the one raw value in CSS: compact < 720px, medium 720–1279px,
wide ≥ 1280px; container queries narrow the pill.

## 6. Surfaces, Mica and elevation

**Mica.** `.mica`, fixed behind the shell, is `--fl-mica-base` with two image layers. When the
playing album changes, `palette/mica.ts` paints the album's highlight, accent and room
(`micaStops`: OKLCH lightness held to 0.25–0.6, chroma to 0.15, so text on the layer keeps AA) as
a gradient on a canvas at 1/`--mica-scale` of the window, blurs and saturates it once
(`--mica-blur`, `--mica-saturate`), and shows the image on the hidden layer at `--mica-opacity`;
the layers crossfade over `--dur-palette`. It bakes again only when the window crosses a
breakpoint, never on scroll or resize steps. Palette colours only, never the cover (§8). Nothing
playing, or a failed bake: the plain base.

**Surfaces.** Panels are `--fl-layer` over Mica. Floating surfaces are opaque with a hairline
`--fl-stroke` and a Fluent shadow (`--fl-shadow-4…64`): cards 4, menus, the player and toasts 16,
dialogs and the side sheet 64. Corners are Fluent's: `--fl-corner-s` 4px for controls, rows and
art in lists; `--fl-corner-m` 8px for cards, panels, menus, dialogs and toasts; circles for the
play disc, avatars, artists and the player pill.

## 7. Light, gradients and atmosphere

Gradients in the app are Spotify's own: a page header's shade (`--header-shade`, transparent to
black at 50%), the body's fade from the header colour, Liked Songs' colours, the sign-in page. The
lyrics view keeps ECHO's light (7.1–7.10 of Draft 3, `VISUALIZER_SPEC.md` §5): the word sweep and
glow, the room drawn from the blurred cover, dither, optional grain.

### 7.7 Scrims

Under the lyrics view's chrome, a top scrim (0 → `--scrim-top`) and one above the pill
(0 → `--scrim-dock`), in `--art-shadow`, so the controls keep contrast over the moving room.

### 7.11 No glass

Liquid glass (Draft 4: an SVG displacement filter as each floating surface's `backdrop-filter`,
and a second composite pass over the lyrics view) was dropped on 2026-10-29: a backdrop filter
re-renders what is under its element whenever that changes, so scrolling, the palette animating
and the lyrics view's moving room all re-filtered every glass surface each frame.
`design-rules.test.ts` fails on any `backdrop-filter`, and on CSS `filter: blur()` outside the
lyrics view. The one blur in the app is Mica's, baked once per album into an image (§6); the
browser then only composites it. Translucency without a filter (Fluent's layers, a scrim) costs
nothing and stays allowed.

**Spotify artwork.** Spotify forbids overlaying or distorting its artwork (§8): the card's play
button does not sit on a Spotify cover.

## 8. Artwork

- Never cropped by a frame other than its own square, never recoloured. 4px radius in lists and
  pages, 6px on cards, round for artists, round in the player pill.
- Sizes: `--art-row` 40, `--art-list` 48, `--art-dock` 56, `--art-shortcut` 64, cards fill their
  column, `--art-detail` 232, the lyrics view `--np-art`.
- Spotify content keeps Spotify's logo and links in the player (PLAYBACK_ARCHITECTURE.md §4.6).
- The accent play button rises onto a card's cover corner on hover and focus (Spotify's), except on
  Spotify's own covers.
- Motion (§11): ECHO's own covers spring in when the song changes and fly between a card and its
  page's header and into and out of the lyrics view. Spotify's artwork only ever fades (its Design
  Guidelines, `PLAYBACK_ARCHITECTURE.md` §4.6).

## 9. Components

### 9.1 Buttons

Fluent's, 32px (`--fl-button-h`), `--r-control` corners: **primary** the accent with on-accent
text, **secondary** `--fl-control` with a `--fl-stroke-control` edge, **tertiary** transparent,
**destructive** transparent with `--negative` text. Hover changes the fill; a press also squashes
the control a little, and it springs back on release (§11). Icon buttons are subtle: a bare glyph in `--muted` with a `--fl-subtle-hover` fill on hover.
A toggle that is on is the accent with a dot beneath (colour is never alone). The play disc is
round (Spotify's shape) in the accent.

### 9.2 Player

The floating pill (`--fl-flyout`, `--fl-stroke`, shadow 16, round): song (cover, title, artists,
heart) | shuffle, previous, the play disc, next, repeat over the progress bar | Now Playing view,
lyrics, queue, sleep timer, volume. Sliders are Fluent's: a 4px `--fl-stroke-strong` rail, the
accent fill, a 20px thumb with an accent centre that grows on hover. Phones: the mini player shows
the song, its heart and play/pause over a hairline of progress (no thumb).

### 9.3 Track rows

Spotify's table: number (a play glyph on hover, bars while playing), title, the heart (on hover;
always once saved), the duration, the ⋯ menu (Add to playlist, Go to song radio, Play next, Add to
queue, Go to artist, Go to album, and Remove from this playlist in a playlist). Rows have 4px
corners and a subtle hover fill; the row playing is a card (`--raised`, a `--fl-stroke` edge) with
its title in `--fl-accent-text`. Phones drop the numbers and durations.

### 9.4 Cards and shortcuts

Cards: cover, title, subtitle on a surround that lights `--raised` on hover; the whole card is the
link. Home's shortcuts: a strip with a 64px cover and a bold title.

### 9.5 Inputs, toggles, chips, tabs, navigation

Fields and the search box are Fluent's: `--fl-control` fill, a `--fl-stroke-control` edge over a
`--fl-stroke-strong` bottom edge that turns accent and 2px on focus (`--ring-input-focus`), under
the focus ring. Switches are Fluent's: a 40×20 track in a 24px target, off an outline with a
matching knob, on the accent with an on-accent knob. Chips and view switches are toggle buttons
(4px, edged; selected is the accent). Tabs are text with a 3px rounded accent bar under the
current one. The current Your Library row and phone tab carry a short accent bar (leading edge,
or under the icon) over a subtle fill. The library switch is a segmented control: a `--fl-control`
track with a hairline edge, two 30px segments, the chosen one the accent (a fieldset of pressed
buttons, like Settings' choices). In a menu, a choice among siblings is a `menuitemradio` with a
check before the chosen one.

### 9.6 Sheets, menus, dialogs, toasts

Fluent's: menus `--fl-flyout` with a 4px inset, 32px items with 4px hover fills, 8px corners,
shadow 16; the side sheet a drawer (`--fl-dialog`, shadow 64) over the scrim; dialogs
`--fl-dialog`, 8px, shadow 64, `--fl-type-subtitle1` titles and buttons at the end; the toast a
`--fl-flyout` surface with an info glyph, bottom-centre above the player. Each springs in (a
menu from its trigger's corner, its items rippling in; a sheet from its edge, from the bottom on
phones) and plays its exit before it goes, by button, Esc or backdrop (§11.2).

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

The owner's choice (2026-11-02, `docs/superpowers/specs/2026-11-02-spring-motion-design.md`):
**springy motion on everything** that appears, leaves, moves or changes. Nothing pops.

### 11.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--spring` (`--dur-spring` / `--ease-spring`) | 592ms, a `linear()` spring: stiffness 230, damping 21, 4.9% overshoot | Every movement in: scale, translate, size, clip, cover flights |
| `--fade` (`--dur-fade` / `--ease-fade`) | 220ms, `cubic-bezier(0.32,0.72,0,1)` | Opacity in (opacity never springs) |
| `--exit` (`--dur-exit` / `--ease-exit`) | 180ms, `cubic-bezier(0.4,0,1,1)` | Opacity out |
| `--exit-move` (`--dur-exit-move`) | 180ms on `--ease-exit` | Movement out: no bounce |
| `--exit-big` (`--dur-exit-big` / `--ease-exit-big`) | 320ms, `cubic-bezier(0.32,0.72,0,1)` | Big things leaving: the right panel, the lyrics view |
| `--stagger` | 35ms | Per item in a group (menu items, rows, tiles), capped at the 12th |
| `--dur-press` / `--dur-hover` | 100 / 150ms | Colour change on press and hover (presses themselves spring) |
| `--dur-toast` | 250ms | The toast's time to leave (`TOAST_EXIT_MS`) |
| `--dur-art` | 640ms | The pill fading out, the lyrics view's side settling |
| `--dur-palette` | 1200ms | Palette interpolation and Mica's crossfade |
| `--ease-out` / `--ease-in-out` | Fluent's decelerate max / easy ease | Colour and the few non-UI fades left |

`ui/motion.ts` samples the spring (`springPoints`); a unit test keeps tokens.css equal to it.
The lyric field's springs are `LYRICS_EXPERIENCE.md` §6's.

### 11.2 Rules

- Movement springs; opacity fades; **exits never bounce**. The 4.9% overshoot is the ceiling.
- **Spotify's artwork** stays in its original form (Spotify Design Guidelines, §8): it never
  scales or flies, it only fades with what holds it. ECHO's own covers (Navidrome) spring in, and
  fly between a card and its page's header and into and out of the lyrics view.
- An entrance is a transition from `@starting-style`; an exit sets `data-leaving` and the element
  stays until its animation ends (`settle`, `useExit`, `closeModal`). Nothing waits on an animation
  to accept input, and every animation can be interrupted.
- Animate `transform`, `scale`, `opacity`, `clip-path` and colour. A size or grid change may
  animate only where it is measured smooth (the right panel's column, MOT-PERF).
- **How much moves** is `<html data-motion>` from Settings → Motion against the device's
  reduce-motion setting (`motionLevel`): **full** springs (Full wins over the device); **less**
  (Reduced, or System on a device asking for less) keeps opacity and colour, nothing travels,
  scales or loops; **off** stops UI motion. tokens.css zeroes the tokens; no stylesheet reads
  `prefers-reduced-motion` itself.

## 12. Accessibility baseline

- Focus is Fluent's double ring: a 2px `--fl-focus-outer` outline over a 1px `--fl-focus-inner`
  hairline inside it (`--ring-focus-inner`), so it reads on any surface, the accent included.
- WCAG 2.2 AA. Targets ≥ 24×24px (2.5.8); focus visible on every control and never hidden by the
  pill or a sheet (2.4.11).
- Colour is never the only signal (toggle dots, status pills with text, hearts with labels).
- Photosensitivity limits are `VISUALIZER_SPEC.md` §7.3's.
- Text resizes to 200% without loss.

## 13. Token file

`src/client/tokens.css` is normative. Every colour, size, duration, easing and shadow value
lives there; component code reads only custom properties (DS-01).
