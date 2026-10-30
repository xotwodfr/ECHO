# ECHO web in Fluent 2 with Mica: design

Status: draft for owner approval · 2026-10-29
Supersedes the *look* of `DESIGN_SYSTEM.md` Draft 5 for the web client only. The frame and the
behaviour stay as Draft 5 describes them.

## Intent

The owner already runs a separate Navidrome app built in Material 3. A second Material 3 app
gives ECHO nothing of its own, so the web client should look clearly different: Microsoft's
**Fluent 2**, dark, with the playing album's colour glowing through the app the way Windows 11's
**Mica** takes on the wallpaper's colour.

The owner chose this from a throwaway prototype
(`/tmp/claude-1000/-home-folkes-Projects-ECHO/ac6c2aa5-ad05-4782-a095-c4bc25361f50/scratchpad/fluent/proto.html?d=desk&v=mica`,
plus `?d=phone&v=mica` for the phone view). Pick Mica over the solid variant.

## Owner decisions

- **Fluent 2 with Mica**, not solid Fluent.
- **Web only.** The Android app stays Material 3, untouched.
- **Dark only.** No light theme, and the app doesn't follow the system setting.
- **Same app underneath.** Pages, frame, player, lyrics view, menus and every behaviour stay as
  they are now. Only the visuals change. (The owner didn't correct this when it was played back.)
- No reference app the owner wants to avoid.
- **Mica keeps the blurred look** of the prototype. Plain gradients were rejected (see Mica).
- **Spotify's touches stay**: the genre card colours (`--genre-*`), the Liked Songs gradient, the
  big heavy page titles (`--title-*`) and the Made For You cover lettering (`--mix-title`). They
  keep their current look, with the titles set in the new font at its heaviest weight (my call:
  Segoe UI Variable and Selawik stop at Bold, so 800 becomes 700).
- **The player stays a floating pill** with a Fluent surface and shadow (it isn't a docked bar
  like the prototype's). The pill's shape is the one exception to Fluent's corner scale: my
  call is to keep it fully round, because a round floating pill is the player's identity in the
  current layout. Change to 8px if it looks wrong next to the other Fluent surfaces.

## Goals

1. Anyone who knows Windows 11, Teams or the new Outlook should read every surface, control and
   state as Fluent 2.
2. The playing album's colour tints the whole frame like Mica, and the tint crossfades when the
   album changes (`--dur-palette`).
3. Performance is no worse than Draft 5. `perf.spec.ts` passes unchanged, and a new check fails
   if the Mica bake runs more than once per album change.
4. WCAG 2.2 AA holds everywhere. `contrast.spec.ts` and `a11y.spec.ts` pass.

## Non-goals

- Android, light mode, layout or navigation changes, new features.
- Microsoft's Fluent UI React library (`@fluentui/react-components`). ECHO keeps its own
  components and token file. Fluent arrives through tokens, CSS and icons, with no new runtime
  dependency.

## Anti-goals (a failure even if it works)

- **Glass returns by the back door.** No `backdrop-filter`, and no CSS `filter: blur()` on
  anything that is shown. The only blur is the once-per-album canvas bake under Mica (the lyrics view's
  existing room is unchanged and keeps its exemption). The owner already rejected liquid glass for performance
  (`DESIGN_SYSTEM.md` §7.11), and `design-rules.test.ts` keeps banning `backdrop-filter`.
- **Material 3 left over.** Pill buttons, M3 tonal roles, M3 state layers, a snackbar, the M3
  navigation bar, or 16–28px corners would leave ECHO half one system and half the other.
- **Spotify artwork blurred or tinted over.** Spotify forbids it (`DESIGN_SYSTEM.md` §8).

## Constraints

- **DS-01 still applies.** Every colour, size, duration, easing and shadow comes from
  `src/client/tokens.css`, and `design-rules.test.ts` enforces it.
- **The dev box has no AVX2 and an old GPU.** Mica has to cost about as much as a static
  gradient.
- **CSP.** Fonts and icons are self-hosted or inlined. No CDNs.
- **Segoe UI can't be shipped.** Microsoft's licence doesn't allow redistributing it.

## How it looks

### Mica

Mica has to look like the blurred prototype. The owner compared a version built from plain CSS
gradients and turned it down ("not really"). The way to get the blur cheaply is to **blur once per
album, into a still image**, as Windows does with the wallpaper. The owner saw this version
(`proto.html?v=baked`, `desk-baked.png`, `phone-baked.png` beside it):

- The playing album's palette roles (`--art-*`, from `palette/live.ts`) are painted on a small
  canvas at about 1/8 of the window size, then blurred and saturated once with the 2D context's
  `filter`, then saved as an image (an object URL or a data URL, whichever CSP allows).
- That image is the background of a fixed layer behind the frame, stretched to fill it. Scaling
  up a small image softens it further at no cost.
- On an album change, a second layer gets the new image and the two crossfade by opacity
  (`--dur-palette`). The previous image is released. Nothing is blurred during the crossfade.
- It's redrawn only when the album changes or the window crosses a breakpoint, never on scroll,
  resize steps or animation frames.
- It uses palette colours only, never the cover image, so Spotify sources get the same glow
  without their artwork being blurred.

- The frame (`--frame`) is Mica: the dark Fluent base (`#202020`-ish) with the album glow over it.
- Panels and pages are Fluent's "layer" fill: a translucent neutral over Mica, so the glow shows
  through without any backdrop filter.
- Things that float (menus, dialogs, the player, toasts) are opaque Fluent flyout surfaces, so
  text over them never depends on what's underneath.
- With nothing playing, Mica falls back to the plain neutral base.

### Colour

- Fluent 2 dark neutrals for backgrounds, strokes and text (foreground 1, 2, 3, disabled).
- **One accent, taken from the album.** It replaces the M3 scheme (`palette/m3.ts`,
  `SchemeContent`). "Primary means play" (Draft 5 §1.2) stays: the accent goes only on Play, the
  row that's playing, toggles that are on, saved hearts, the selection marker and the focus ring's
  accent where Fluent puts one.
- The accent is derived from the album's colour into a Fluent-style brand ramp with enough
  lightness for AA contrast against its foreground. The ramp algorithm is left to the builder.
- Status colours (error, warning, success) use Fluent's dark palette.

### Shape and elevation

- Corners follow Fluent's scale: 4px for controls, inputs, buttons and rows; 8px for cards,
  panels, menus, dialogs and toasts; the player pill stays round (see Owner decisions); circles for avatars, artists and the Play disc.
- Shadows follow Fluent's ramp (shadow 2/4/8/16/28/64): cards 4, menus 16, the player 16,
  dialogs 64.
- 1px strokes (Fluent's "stroke" tokens) separate surfaces as Windows 11 does.

### Type

Segoe UI Variable through `local()` where it's installed (Windows), then **Selawik**, Microsoft's
open-source Segoe fallback, self-hosted, then system UI fonts. My call: Selawik keeps Linux and
Android browsers close to Segoe's shapes. Figtree is removed. The sizes follow Fluent 2's type
ramp (caption 12, body 14, subtitle 20, title 28, large title 40), with the page title's
step-down by length (`--title-*`) kept, using Fluent's display sizes.

### Icons

Fluent UI System Icons (MIT), 20px regular plus filled for "on" states. Only the glyphs ECHO uses
are inlined into `src/client/ui/icons.tsx`, so there is no icon font and no new dependency.

### Components

All of these follow Fluent 2 as Windows 11 and Teams show it:

- **Buttons.** Primary (accent fill), secondary (subtle fill and stroke), subtle (transparent until
  hover), icon buttons. 32px tall, or 40px where the current layout needs a bigger target. Hover
  and press change the fill; they don't scale.
- **Navigation.** The Your Library panel's rows and the phone tab bar take the Fluent selected
  style: a subtle fill plus a short accent bar on the leading edge (bottom edge on the tab bar).
- **Tabs and filter chips.** Fluent tabs with an accent underline. Library filters become Fluent
  toggle buttons.
- **Inputs.** Subtle fill, 1px stroke, and a bottom stroke that turns accent and 2px on focus. This
  covers the search box.
- **Toggles.** The Fluent switch, 40×20.
- **Sliders.** The Fluent slider: a 4px rail, the accent fill, and a round thumb with an accent
  centre.
- **Track rows.** 4px corners, subtle hover fill. The playing row uses a card fill with a stroke
  and accent text.
- **Menus, sheets, dialogs, toasts.** Fluent menus (8px, shadow 16, 32px items), a Fluent drawer
  for the side sheet, a Fluent dialog (title 20 semibold, buttons at the end), and a Fluent toast
  in place of the snackbar, in the same position above the player.
- **Focus.** Fluent's double focus ring (2px light outside, 1px dark inside) on every control.
- **Loading states.** Flat skeleton bars in Fluent's neutral, with no shimmer (as now).

### Motion

Fluent's duration tokens (50–500ms) and curves (decelerate, accelerate, easy-ease) replace the
values behind the existing `--dur-*` and `--ease-*` names. The names stay, so JS mirrors keep
working. Reduced motion is unchanged.

### Lyrics view (`/listen`)

The room, word sweep and lyric column stay as they are; that view is already its own immersive
look. Only its chrome changes: the player pill, buttons and the scrims' edges take the Fluent
components above.

## Deliverables

1. `tokens.css` rewritten to Fluent 2 dark plus Mica. Token names used by components are kept
   where the meaning holds, so component diffs stay small.
2. `palette/m3.ts` replaced by an accent-ramp module, with unit tests. `materialkolor` on Android
   is not touched.
3. Component CSS (`main.css`, `ui/ui.css`, shell styles) restyled. The lyrics view only gets its
   chrome restyled.
4. Selawik self-hosted with its licence. Figtree removed.
5. Icons swapped to Fluent UI System Icons.
6. `DESIGN_SYSTEM.md` becomes Draft 6 (Fluent 2 + Mica, web), and `README.md` is updated wherever
   it describes the look.
7. Tests: e2e assertions that check M3 colours, radii or the snackbar are updated; visual
   baselines (`shell.visual`, `ui.visual`) regenerated and reviewed; `design-rules.test.ts`
   keeps the `backdrop-filter` ban; `pnpm check` and the full e2e suite pass.
8. Screenshots of Home, an album, search, the library, settings, a menu, a dialog, a toast and
   the lyrics view, desktop and phone, reviewed before calling it done.

## Left to the builder

- The accent ramp algorithm, the exact Mica gradient (number of stops, positions, intensity) and
  the layer opacities, within the contrast and performance goals.
- Whether the page header's album tint (`--head-colour`) stays as is, is toned down so Mica reads,
  or is dropped where it fights Mica.
- Exact Fluent token values (Microsoft publishes them openly).
- How the work splits into commits.
