# Springy motion everywhere in the web app — design

Status: **approved** by the owner 2026-11-02 ("build it")

## Intent

The owner: "there aren't many animations, when I clicked something it mostly popped out/in", and
the ones there are "blink into place". Both are true of today's code:

- Most motion runs 100–250 ms on Fluent's decelerate-max curve, `cubic-bezier(0.1, 0.9, 0.2, 1)`
  (`--ease-out`). It is 90% of the way there after **64 ms**, which reads as a blink.
- Only entrances animate. Menus, dialogs and sheets have an entry keyframe and vanish on close.
  The right panel, queue changes, loaded content and leaving the lyrics view have no motion at all.

The owner compared three feels side by side in the Motion Lab (kept next to this file as
`2026-11-02-spring-motion-lab.html`, published privately at
https://claude.ai/artifact/RYeAbW5YpRfm3dJsWpz6LX): A (today), B (a long glide), C (a spring).
They chose **C, "springing on everything"**.

## Owner decisions (2026-11-02)

- **Feel C everywhere** in the web client. Anything that appears, disappears, moves or changes
  animates. Nothing pops.
- **Web only.** The Android app is out of scope.
- The full list below ("What moves") is confirmed: "yeah, basically everything".

## The feel

These numbers are the Motion Lab's column C and are what the owner approved:

| | Value |
|---|---|
| Spring | stiffness 230, damping 21, mass 1 (damping ratio 0.69) |
| Overshoot | 4.9%, peaking at ~290 ms |
| Settles | ~590 ms (to within 0.2%) |
| 90% of the way | ~170 ms (today: 64 ms) |
| Fades | opacity never springs: 220 ms, `cubic-bezier(0.32, 0.72, 0, 1)` |
| Exits | 180 ms, `cubic-bezier(0.4, 0, 1, 1)`, **no bounce** |
| Big exits (panel, lyrics view closing) | ~320 ms on the same glide curve, no bounce |
| Stagger for groups (rows, tiles, menu items, lyric lines) | 35 ms per item |

In CSS the spring is a `linear()` easing sampled from the spring (the Motion Lab's `spring()`
does exactly this, 49 points). Movement (transform, scale, clip-path, size) and opacity run as
separate animations or transitions, so the movement can bounce while the fade does not.

## What moves

Each item says what the owner should see. "From the demo" means the Motion Lab shows it.

1. **Menus** (every `Menu`, including the account menu and right-click menus): grow from their
   trigger corner with the spring, items rippling in. On close they shrink and fade out before
   they unmount. *From the demo (scene 1).*
2. **Dialogs and side sheets** (native `<dialog>`: `Sheet`, `ConfirmDialog`, `PlaylistPicker`,
   `ReplaceQueueDialog`, `SessionExpiredSheet`): spring in; on close, by button, Esc or backdrop,
   they animate out before the dialog actually closes. The backdrop fades both ways.
3. **The right panel** (Queue / Now Playing): slides in from the right edge while the middle area
   narrows smoothly, and the reverse on close. No jump of the middle area at either end. *From the
   demo (scene 2).* Switching between Queue and Now Playing inside the panel crossfades with a
   small spring travel.
4. **Page changes**: today's View Transition, retimed to the spring. A clicked card's cover still
   flies into the page header, now with the spring, **and flies back into its card on Back** when
   that card is on the previous page. *From the demo (scene 3).*
5. **Queue changes** (Play next, Add to queue, remove, drag to reorder, clear): rows slide to their
   new places; new rows slide in with a brief accent wash; removed rows slide out. *From the demo
   (scene 4).* A dragged row lands with the spring.
6. **Buttons**: every press springs (a small squash and release). Play/pause morphs with a spring
   rotate-and-scale. The heart pops with the spring and a ring burst when liked, and shrinks out
   when unliked. *From the demo (scene 5).* Hover colour changes stay plain colour fades.
7. **Content arriving**: when a page's tiles, shelves, rows or search results first arrive after
   loading, they rise in with the spring in a 35 ms wave. Skeletons and spinners fade out. *From
   the demo (scene 6).* *My call:* a page restored from cache (Back, "the page as it was") comes in
   with the page change only, no wave, so Back stays instant.
8. **The lyrics view**: opening grows the view out of the player's cover while the cover flies to
   its big spot and the lyric lines rise in. Closing shrinks it back into the player. The rest of
   the shell recedes and returns. *From the demo (scene 7).*
9. **Toasts**: spring up from the bottom; leave with the plain exit.
10. **Tabs and switches**: the selected indicator slides to the new tab with the spring (the phone
    tab bar, chips, the Navidrome | Spotify switch, Settings toggles).
11. **Switching Navidrome ↔ Spotify**: the library panel and page change like a page change
    (crossfade and rise), not a hard swap.
12. **The song changing**: the player's and Now Playing's cover arrive with the spring. The lyrics
    view keeps its own cover change (below).
13. **Anything else that shows or hides** (popovers, the card play button, tooltips, the sticky
    page header, the reconnect prompt, inline errors and empty states): fade and spring in,
    plain exit out.

On phone widths (compact layout), the same rules apply to the compact versions: full-screen
sheets slide up with the spring and down on close, the Library page and tab bar follow the same
page and tab rules.

## Non-goals

- Android.
- The lyrics view's own field motion: the lyric field's springs (`LYRICS_EXPERIENCE.md` §6), the
  Stage visuals, the palette interpolation and Mica's crossfade stay exactly as they are.
- Any change to layout, features or what's on a page. Only how things move between states.
- Animation libraries. CSS transitions/animations, `@starting-style`, the Web Animations API and
  View Transitions are enough; the shell's JS bundle budget (PERF-05, ≤ 350 KB gzip) still holds.

## Anti-goals (a failure even if it all animates)

- **The app feels slower.** No click, key or tap ever waits for an animation. Every animation can
  be interrupted: clicking again mid-animation goes straight to the new state from wherever it
  is. A new page is usable at once (today's `::view-transition { pointer-events: none }` stays).
  Typing in search never waits: results animate as they arrive, without flicker on each keystroke.
- **Jank.** Motion must hold the frame rate on the owner's machines. Anything that animates size
  or layout (the right panel, row collapse) must be measured smooth, or be replaced by a
  snapshot/transform technique (for example a View Transition for the panel). LIB-02 (scroll
  ≥ 55 fps), PERF-03 and PERF-05 keep passing. No `backdrop-filter` (DS-01 test stays).
- **Bouncing exits**, or a bounce big enough to look rubbery. The 4.9% overshoot is the ceiling.
- **Breaking reduced motion.** See below.

## Reduced motion (my call, not raised by the owner)

The Settings → Motion choice keeps its four values and its current meaning:

- **System** follows the device's reduce-motion setting.
- **Reduced** (or System on a device that asks for less): no spring, no travel, no scale; opacity
  and colour changes stay, and exits still fade rather than vanish.
- **Off**: no UI motion.
- **Full**: the springs, even if the device asks for less.

## Constraints in the codebase

- **Tokens.** Durations and curves live in `src/client/tokens.css` (§11.1 of
  `docs/DESIGN_SYSTEM.md`). The spring curve, its duration, the fade, the exit and the stagger
  become tokens there; components read tokens, not literals (the design-rules tests enforce this).
  JS that mirrors a token duration stays equal to it (`design-rules.test.ts`: `TOAST_EXIT_MS`,
  `CHROME_IN_MS`, `CHROME_OUT_MS`, `DUR_PALETTE_MS`).
- **The design system changes.** `DESIGN_SYSTEM.md` §11 says "No bounce on UI elements" and
  "never layout"; the owner's decision reverses the first. Update §11.1 (tokens table) and §11.2
  (rules: spring for movement, no bounce on exits, how size changes are allowed) with this work.
- **Exits need an exit phase.** Menus and the right panel are unmounted by React as soon as they
  close (`Menu` renders `{open && …}`, `RightPanel` returns `null`); dialogs call `.close()` at
  once (`useModal` in `src/client/ui/overlays.tsx`), and Esc closes natively. Each must stay
  mounted/open until its exit finishes, while keeping today's behaviour: focus returns to the
  trigger, Esc and backdrop close, the rest of the page is inert while a modal is open. The toast
  already has this pattern (`leaving` in `toastStore`).
- **Page changes** go through `pageTransition` in `src/client/main.tsx` (View Transitions). It skips
  the transition into and out of the lyrics view on purpose (snapshotting the live Stage is slow);
  the lyrics view's motion should stay outside View Transitions.
- **Browsers.** The suite runs Chromium and Firefox. Where a feature is missing (no View
  Transitions, no `linear()`), fall back to a working non-spring animation, never to an error or a
  stuck state.
- **Tests.** Browser tests that check something is gone right after closing it will need to wait
  for the exit. Visual baselines must be taken at rest.

## What done looks like

- The owner clicks through every item in "What moves" in Chrome and Firefox on the live site and
  nothing pops.
- Each item in "What moves" has a browser test that proves it animates (for example: a closed menu
  is still in the DOM, animating, then gone) and one test proves Reduced turns travel off.
- The existing unit and browser suites pass, including the performance tests.
- *My call:* built on its own branch, merged into `main` and redeployed only on the owner's OK, as
  with earlier projects.

## Left to the builder

- The technique per element (CSS transitions with `@starting-style` and `allow-discrete`, the Web
  Animations API, View Transitions), as long as the feel and the anti-goals hold.
- Exact choreography for items not shown in the Motion Lab (directions, which parts stagger),
  following the lab's style.
- Whether a shared helper or hook handles exit phases, or each component does its own.
- The order of work.
