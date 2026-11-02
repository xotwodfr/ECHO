# Springy motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every appearance, disappearance, movement and change in the web client animates with the owner's chosen spring (Motion Lab feel C); nothing pops.

**Architecture:** Motion is CSS tokens (`--spring`, `--fade`, `--exit`, `--exit-move`, `--exit-big`, `--stagger`) that `<html data-motion="full|less|off">` zeroes under less motion. Entrances use CSS transitions with `@starting-style`; exits set `data-leaving` and wait for the element's finite animations (`src/client/ui/motion.ts`) before unmounting or closing. Moves that CSS cannot express (cover flights, list reorders, the lyrics view) use the Web Animations API with the same tokens read from CSS.

**Tech Stack:** React 19, Vite, plain CSS (nesting, `@starting-style`, `linear()`), View Transitions, Web Animations API, Vitest (node, no DOM), Playwright (Chromium + Firefox).

**Spec:** `docs/superpowers/specs/2026-11-02-spring-motion-design.md` (reference demo beside it: `2026-11-02-spring-motion-lab.html`)

## Global Constraints

- Spring: stiffness 230, damping 21, mass 1; sampled into `linear()` with 49 points (4 decimals); duration 592 ms.
- Fades: 220 ms `cubic-bezier(0.32, 0.72, 0, 1)`; opacity never uses the spring curve.
- Exits: 180 ms `cubic-bezier(0.4, 0, 1, 1)`, no bounce. Big exits (right panel, lyrics view): 320 ms `cubic-bezier(0.32, 0.72, 0, 1)`.
- Stagger: 35 ms per item, capped at the 12th item.
- Web client only; no new dependencies; JS bundle for the shell ≤ 350 KB gzip (PERF-05).
- No `backdrop-filter` (DS-01). Components read motion tokens, never literal durations/curves (design-rules tests).
- Motion levels: Full = springs; Less (Reduced, or System on a reduce-motion device) = opacity/colour only, exits still fade; Off = nothing moves.
- No click, key or tap waits for an animation; every animation is interruptible.
- Work on branch `spring-motion`; merge into `main` and redeploy only on the owner's OK.

## Review Focus

- **Closing while still opening (or reopening while closing)** a menu, dialog, panel: it must reverse from where it is, never get stuck half-visible or unmounted while open. Tested in Task 2 and Task 3.
- **Esc and backdrop clicks on dialogs**: still close, with the exit, and focus still returns to the trigger. Tested in Task 2.
- **Infinite animations inside a leaving element** (spinner, now-playing bars) must not keep it mounted forever: `settle()` ignores animations with infinite end time. Tested in Task 2.
- **Fast repeated queue edits** (two Play next in a row, a drag during a running reorder): rows end in the right order with no leftover ghosts. Tested in Task 5.
- **Back from an album to a scrolled page**: the page is restored instantly and the cover flies only to a card that is on screen. Tested in Task 4.

---

### Task 1: Motion tokens, motion levels, and the design system

**Files:**
- Create: `src/client/ui/motion.ts`, `src/client/ui/motion.test.ts`
- Modify: `src/client/tokens.css:148-159` (motion block), `src/client/main.tsx:36-46` (motion level), `src/client/ui/ui.css:1441-1495` and every other `@media (prefers-reduced-motion: reduce)` block in `src/client/**/*.css`, `src/client/design-rules.test.ts`, `docs/DESIGN_SYSTEM.md` §11
- Test: `src/client/ui/motion.test.ts`, `tests/e2e/motion.spec.ts` (new)

**Interfaces:**
- Produces: `springPoints(stiffness: number, damping: number, samples = 48): { points: number[]; durationMs: number }`; `motionLevel(pref: 'system' | 'full' | 'reduced' | 'off', systemReduced: boolean): 'full' | 'less' | 'off'`; tokens `--dur-spring --ease-spring --spring --dur-fade --ease-fade --fade --dur-exit --ease-exit --exit --dur-exit-move --exit-move --dur-exit-big --ease-exit-big --exit-big --stagger`; `<html data-motion>` ∈ `full | less | off`.

- [ ] **Step 1: Create the branch** — `git checkout -b spring-motion`
- [ ] **Step 2: Write the failing unit tests** in `src/client/ui/motion.test.ts`:

```ts
it('samples the owner’s spring: 49 points ending at 1, ~4.9% overshoot, 592 ms', () => {
  const { points, durationMs } = springPoints(230, 21);
  expect(points).toHaveLength(49);
  expect(points[0]).toBe(0);
  expect(points.at(-1)).toBe(1);
  expect(Math.max(...points)).toBeCloseTo(1.049, 2);
  expect(durationMs).toBe(592);
});
it('tokens.css carries exactly that spring', () => {
  const { points, durationMs } = springPoints(230, 21);
  const css = readFileSync(join(ROOT, 'tokens.css'), 'utf8');
  expect(css).toContain(`--ease-spring: linear(${points.join(', ')})`);
  expect(css).toContain(`--dur-spring: ${durationMs}ms`);
});
it.each([
  ['system', false, 'full'], ['system', true, 'less'], ['full', true, 'full'],
  ['reduced', false, 'less'], ['off', false, 'off'],
] as const)('motionLevel(%s, reduced=%s) = %s', (pref, sys, want) =>
  expect(motionLevel(pref, sys)).toBe(want));
```

- [ ] **Step 3: Run** `pnpm vitest run src/client/ui/motion.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `springPoints` (damped spring `x(t) = 1 − e^(−ζω₀t)(cos ω_d t + ζω₀/ω_d · sin ω_d t)`, ω₀ = √k, ζ = c / 2√k, duration T = ln(500)/(ζω₀), points `x(i/48·T)` rounded to 4 decimals, last forced to 1, `durationMs = round(T·1000)`) and `motionLevel` in `motion.ts`. In `tokens.css` add the tokens (values from Global Constraints; `--exit-move` uses `--ease-exit`; `--ease-exit` takes the new exit curve, replacing Fluent's accelerate-max; `--page-rise: 24px`), then:

```css
:root[data-motion="less"] { --dur-spring: 0ms; --dur-exit-move: 0ms; --dur-exit-big: 0ms; --stagger: 0ms; }
:root[data-motion="off"]  { --dur-spring: 0ms; --dur-fade: 0ms; --dur-exit: 0ms; --dur-exit-move: 0ms; --dur-exit-big: 0ms; --stagger: 0ms; }
```

  In `main.tsx` set `document.documentElement.dataset.motion = motionLevel(pref, reducedQuery.matches)`; `lessMotion()` becomes `motionLevel(...) !== 'full'`. Replace every `@media (prefers-reduced-motion: reduce)` block in client CSS with `:root:not([data-motion="full"])` selectors (same rules). Rewrite `DESIGN_SYSTEM.md` §11.1 (tokens table with the new tokens) and §11.2 (movement springs; exits never bounce; fades never spring; size changes allowed when measured smooth; motion levels as in Global Constraints).
- [ ] **Step 5: Add a design-rules test** in `src/client/design-rules.test.ts`: no client CSS file contains `prefers-reduced-motion`.
- [ ] **Step 6: Write e2e** `tests/e2e/motion.spec.ts`: `'Settings → Motion → Full wins over a reduce-motion device'`: `emulateMedia({ reducedMotion: 'reduce' })`, signed in, `<html data-motion>` is `less`; set Motion to Full in Settings; it becomes `full`.
- [ ] **Step 7: Run** `pnpm vitest run src/client` and `pnpm playwright test motion --project=chromium` — Expected: PASS.
- [ ] **Step 8: Commit** — `git commit -m "Web: spring motion tokens and motion levels"`

### Task 2: Exit phases; menus, dialogs and sheets spring in and out

**Files:**
- Modify: `src/client/ui/motion.ts`, `src/client/ui/overlays.tsx` (`useModal`, `Sheet`, `ConfirmDialog`, `Menu`), `src/client/ui/ui.css` (menu, sheet, dialog, backdrop rules; keyframes `menu-in`, `sheet-in`, `dialog-in` removed)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `timing(name: 'spring' | 'fade' | 'exit' | 'exit-move' | 'exit-big'): KeyframeAnimationOptions` (reads `--dur-<name>`/`--ease-<name>` from `:root`; `exit-move` uses `--ease-exit`; for the Web Animations API users in Tasks 5, 8, 9); `settle(el: Element): Promise<void>` (resolves when every finite animation on `el` and its subtree finishes or is cancelled); `leave(el: HTMLElement): Promise<boolean>` (sets `data-leaving`, awaits `settle`, returns `false` if `data-leaving` was removed meanwhile); `useExit(open: boolean, ref: RefObject<HTMLElement | null>): boolean` (mounted: stays `true` until the exit settles; reopening removes `data-leaving` and keeps it mounted); `closeModal(d: HTMLDialogElement): Promise<void>` in `overlays.tsx`. CSS convention: `[data-leaving]` = exit state, `pointer-events: none`.

- [ ] **Step 1: Write failing e2e tests** in `motion.spec.ts` (on `/__ui`):
  - `'a menu animates out before it unmounts'`: open a Menu, press Escape; immediately `.menu[data-leaving]` is attached; then `.menu` count is 0; trigger is focused.
  - `'a dialog closes with its exit, by button, Esc and backdrop'`: for each way, right after the action the dialog is `open` with `data-leaving`, then `open` is false; focus returns to the trigger.
  - `'reopening a closing menu keeps it open'`: open, Escape, click the trigger again before it unmounts → `.menu` attached, no `data-leaving`, after 800 ms still attached.
  - `'a leaving element with a spinner inside still unmounts'`: in the gallery, the Sheet containing a spinner (add one to the gallery's sheet section if absent) closes within 1 s.
  - `'with Motion Off, closing is immediate'`: Motion Off → after Escape `.menu` count is 0 at once.
- [ ] **Step 2: Run** `pnpm playwright test motion --project=chromium` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `settle` (filter `getAnimations({ subtree: true })` to `effect.getComputedTiming().endTime !== Infinity`; `Promise.allSettled` of `.finished`), `leave`, `useExit` in `motion.ts`. In `overlays.tsx`: `closeModal` = `leave(d)` then `d.close()` unless aborted; `useModal` uses it for the `open` prop, backdrop clicks, and `onCancel` (Esc: `preventDefault()` when `cancelable`, then `closeModal`); reopening a leaving dialog deletes `data-leaving`. Close buttons call `closeModal`. `Menu` renders while `useExit(open, menu)`.
- [ ] **Step 4: CSS** in `ui.css`: `.menu`, `.sheet[open]`, `.dialog[open]` transition `opacity var(--fade), scale var(--spring), translate var(--spring)` with `@starting-style` (menu: `scale: 0.9; translate: 0 -6px`, origin stays from placement; dialog: `scale: 0.94`; sheet: `translate: var(--sp-5) 0`; compact sheet: `translate: 0 100%`); `[data-leaving]` versions use `var(--exit)` / `var(--exit-move)` to `opacity: 0` and a small scale/translate; `::backdrop` fades with `var(--fade)` and out with `var(--exit)`. Menu items stagger: `.menu > .menu-item` fade/rise with `transition-delay: calc(var(--i) * var(--stagger))`, and add the shared index rules `:is(.menu, [data-arrive]) > :nth-child(k) { --i: k-1 }` for k = 2…12 plus `:nth-child(n+13) { --i: 12 }`.
- [ ] **Step 5: Run** `pnpm playwright test motion ui --project=chromium --project=firefox` — Expected: PASS (fix `ui.spec.ts` checks that assumed instant close by waiting for the element to detach).
- [ ] **Step 6: Commit** — `git commit -m "Web: menus, dialogs and sheets spring in and animate out"`

### Task 3: The right panel slides; the middle area resizes smoothly

**Files:**
- Modify: `src/client/main.css:56-66,89-91` (shell grid), the `.right-panel` rules, `src/client/shell/RightPanel.tsx`
- Test: `tests/e2e/motion.spec.ts`, `tests/e2e/perf.spec.ts`

**Interfaces:**
- Consumes: `useExit` (Task 2).

- [ ] **Step 1: Write failing e2e tests** (wide viewport 1600×900, Navidrome signed in, something playing):
  - `'the right panel opens and closes with the middle area following'`: sample `.canvas` width every frame for 700 ms after opening the queue; at least 5 distinct intermediate widths between the closed and open widths; after closing, `.right-panel` stays attached with `data-leaving` and then detaches, `.canvas` width returns to the closed width.
  - `'switching Queue ↔ Now Playing crossfades'`: after switching, the new pane has a running animation.
  - `'reopening the panel while it closes keeps it'`: close then reopen at once; panel attached, no `data-leaving`.
  - In `perf.spec.ts`: `'MOT-PERF: opening and closing the right panel keeps ≥ 50 fps'` (median rAF interval over 5 open/close cycles on Home ≤ 20 ms).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: `.shell` gets three column tracks always (`var(--library-w) minmax(0, 1fr) 0px`, open: `var(--np-w)`), `column-gap: 0` with the gaps moved to `.canvas`/`.right-panel` margins so a closed panel leaves no gap; `transition: grid-template-columns var(--spring)`, closing (`.shell:not([data-right])`) `var(--exit-big)`. `.right-panel` clips (`overflow: hidden`) a fixed-width inner (`width: var(--np-w)`) so content never reflows while the column moves; it fades/slides in with `@starting-style` and out under `[data-leaving]` with `var(--exit-big)`. Keep the medium/compact media queries (`main.css` ~2082–2140) as they are, but with the three-track form. `RightPanel` keeps rendering the last pane while `useExit(!!right, ref)`; the pane element is keyed by pane kind with an `@starting-style` fade + small rise.
- [ ] **Step 4: Run** `pnpm playwright test motion perf shell --project=chromium --project=firefox --project=isolated` — Expected: PASS (update shell visual baselines only if the at-rest layout changed by the gap move; it must not).
- [ ] **Step 5: Commit** — `git commit -m "Web: the right panel slides in and out, the page follows"`

### Task 4: Page changes on the spring; the cover flies back on Back

**Files:**
- Create: `src/client/shell/page-transition.ts` (moved from `src/client/main.tsx:48-80`)
- Modify: `src/client/main.tsx`, `src/client/main.css:2416-2476` (View Transition rules)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `pageTransition(update: () => void, from: Route, to: Route): void` (same contract as today); `cardFor(root: ParentNode, path: string): HTMLElement | null` (the `.art` of the `.tile` whose `.tile-link` `href` equals `path`, only if it intersects the viewport).

- [ ] **Step 1: Write the failing e2e test** `'Back flies the header cover into its card'`: wrap `document.startViewTransition` in `page.addInitScript` to record, inside the update callback after it runs, which elements have `viewTransitionName === 'cover'`; open an album from Home, go Back; the recorded new-state element is the Home tile's `.art` for that album. Also `'Back to a scrolled page restores it at once'`: scroll Library, open an album, Back → `.canvas.scrollTop` equals the saved value in the first frame after navigation (existing behaviour kept).
- [ ] **Step 2: Run** — Expected: FAIL on the Back flight.
- [ ] **Step 3: Implement**: move `pageTransition` and the `lastClicked` listener into `page-transition.ts`. On a change whose `to` is the previous history entry (or any change) where the old page has `.page-head .art` and the new DOM has `cardFor(canvas, routePath(from))`, name the old header art `cover` before the transition and the card's art `cover` inside the update callback after `flushSync`. CSS: `::view-transition-old(page)` → `page-out var(--exit) both`; `::view-transition-new(page)` → `page-fade-in var(--fade) both, page-rise var(--spring) both` (opacity and translate split); `::view-transition-group(cover)` → `animation-duration: var(--dur-spring); animation-timing-function: var(--ease-spring)`.
- [ ] **Step 4: Run** `pnpm playwright test motion pages --project=chromium --project=firefox` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Web: page changes spring; covers fly back on Back"`

### Task 5: Queue rows slide, arrive and leave

**Files:**
- Modify: `src/client/ui/motion.ts`, `src/client/shell/Queue.tsx`, `src/client/ui/media.tsx` (`TrackRow` passes `data-flip-key`), `src/client/ui/ui.css` (`.fresh` wash, `.flip-ghost`)
- Test: `src/client/ui/motion.test.ts`, `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `occurrenceKeys(keys: string[]): string[]` (each key suffixed `#n`, its n-th occurrence: `['a','b','a'] → ['a#0','b#0','a#1']`); `useFlip(root: RefObject<HTMLElement | null>, deps: unknown[]): void` (before paint after each change: rows `[data-flip-key]` that moved animate from their old offset with `--spring`; new rows rise in and get class `fresh`; removed rows are re-inserted as `aria-hidden` `inert` `.flip-ghost`s at their old position and fade/slide out with `--exit`, then removed).

- [ ] **Step 1: Write failing tests**: unit `occurrenceKeys` (the example above, and stability: moving the second `'a'` keeps `a#0` on the first); e2e `'queue changes slide'`: play an album, open the queue, Play next a song → a row with class `fresh` and a running animation; remove a row → a `.flip-ghost` is attached, then 0 ghosts within 1 s; Alt+↓ on a row → the moved row has a running transform animation and ends in the new order; two Play next in quick succession → final order correct and 0 ghosts after 1 s.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `occurrenceKeys` and `useFlip` (layout effect; positions relative to `root`, which gets `position: relative`; skip everything when `data-motion` is not `full`). In `QueueList`, compute occurrence keys over `nextUp ++ then` once, use them as React keys and `data-flip-key` (the now-playing row keeps `now`), and call `useFlip` on the `.queue-upcoming` element. Keep the focus-follow after Alt+arrows working.
- [ ] **Step 4: Run** `pnpm vitest run src/client/ui` and `pnpm playwright test motion dock --project=chromium --project=firefox` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Web: queue rows slide, arrive and leave"`

### Task 6: Buttons press, play/pause morphs, the heart pops

**Files:**
- Modify: `src/client/ui/ui.css` (`.btn`, `.icon-btn`, `.play-btn`, `.tile-play`, `.toggle::after`, `.heart`), `src/client/main.css` (press rules there: ~131, ~310, ~1214, ~1248, ~1271, ~1485), `src/client/shell/hearts.tsx`
- Test: `tests/e2e/motion.spec.ts`

- [ ] **Step 1: Write failing e2e tests**: `'presses spring'`: computed `transition` of `.btn`, `.icon-btn`, `.play-btn` includes `linear(` for `scale`; `'the heart pops when liked, not on load'`: a page with an already-liked song has no running animation on its heart; clicking an unliked heart sets `data-pop` and starts an animation, which ends with `data-pop` removed; `'play/pause morphs'`: toggling play starts animations on both glyphs; with Motion Reduced none of these animate (only opacity).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: every press `scale` transition uses `var(--spring)` (hover colour fades unchanged). Play/pause glyphs: hidden glyph `scale: 0.3; rotate: 90deg; opacity: 0`, shown glyph springs from `scale: 0.3; rotate: -90deg` (`@starting-style` is not needed: both glyphs stay mounted; transition `scale`/`rotate` with `var(--spring)`, opacity `var(--fade)`). Heart: `HeartButton` and `SaveAlbumButton` set `data-pop` on click (removed on `animationend`); CSS `.heart[data-pop] .icon { animation: heart-pop var(--spring) }` (`from { scale: 0 }`) and `.heart[data-pop]::after` ring burst (`from { scale: 0.4; opacity: 0.8 } to { scale: 1.5; opacity: 0 }`, `var(--fade)`); unliking: icon `scale` from 0.7 with `var(--exit)`. Toggle knob `left` transition uses `var(--spring)`. Card play button `translate` uses `var(--spring)`.
- [ ] **Step 4: Run** `pnpm playwright test motion ui pages --project=chromium --project=firefox` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Web: presses, play/pause and the heart spring"`

### Task 7: Content arrives in a wave

**Files:**
- Modify: `src/client/ui/motion.ts`, `src/client/ui/media.tsx` (`AlbumTileSkeleton`, `TrackRowSkeleton` note loading; `AlbumGrid`, `TrackList` arrive), `src/client/ui/states.tsx` (`SectionLoading` notes loading), `src/client/shell/page-transition.ts` (route changes reset), `src/client/ui/ui.css`
- Test: `src/client/ui/motion.test.ts`, `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `noteLoading(): void`, `noteRoute(): void`, `shouldArrive(): boolean` (true when a placeholder mounted since the last route change); `useArrival(ref: RefObject<HTMLElement | null>): void` (on mount, if `shouldArrive()`, sets `data-arrive` on the element and removes it after `--dur-spring` + 12 × `--stagger`).

- [ ] **Step 1: Write failing tests**: unit — `noteRoute(); expect(shouldArrive()).toBe(false); noteLoading(); expect(shouldArrive()).toBe(true); noteRoute(); expect(shouldArrive()).toBe(false)`; e2e `'tiles arrive in a wave after loading'`: delay the mock's album list (`page.route` adding 600 ms), open Library → skeletons, then `ul` with `data-arrive` whose 3rd tile has a later animation start than its 1st; after 1.5 s `data-arrive` is gone; `'Back shows the page as it was, no wave'`: open an album, Back → no `data-arrive` on the restored grid.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the arrival state in `motion.ts`, the calls in the placeholders (`useEffect(noteLoading, [])`), `noteRoute()` at the start of `pageTransition`, `useArrival` in `AlbumGrid` and `TrackList` (and the Home shelves' list if they do not use `AlbumGrid`). CSS: `[data-arrive] > *` runs `arrive-fade var(--fade) both, arrive-rise var(--spring) both` (`from { translate: 0 16px; scale: 0.96 }`) with `animation-delay: calc(var(--i, 0) * var(--stagger))`; placeholders fade out where they are replaced is not needed (they unmount; the wave covers it).
- [ ] **Step 4: Run** `pnpm vitest run src/client/ui` and `pnpm playwright test motion pages --project=chromium --project=firefox`, plus `pnpm playwright test perf --project=isolated` (LIB-02 scrolling must not run the wave on scrolled-in tiles) — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Web: loaded content arrives in a wave"`

### Task 8: The lyrics view grows out of the player and shrinks back

**Files:**
- Modify: `src/client/ui/motion.ts`, `src/client/shell/page-transition.ts`, `src/client/stage/stage.css:630-660` (old `np-in` / `np-cover-in` entrance removed), `src/client/ui/ui.css` (`.motion-ghost`)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `ghost(el: HTMLElement): HTMLElement` (a `position: fixed` deep clone at `el`'s rect, scroll offsets of scrolling descendants copied, `aria-hidden`, `inert`, class `motion-ghost`, appended to `body`); `fly(from: Element, to: Element, t: KeyframeAnimationOptions): Promise<void>` (a clone of `to` animates from `from`'s box to `to`'s; both hidden meanwhile).
- Consumes: `pageTransition` (Task 4), `timing` (Task 2).

- [ ] **Step 1: Write failing e2e tests** (Chromium; something playing): `'opening the lyrics view grows it from the player'`: click the player's cover/lyrics button → a `.motion-ghost` exists and `.canvas` has a running `clip-path` animation; within 1 s no ghost remains; `'closing shrinks it back into the player'`: click the chevron → a `.motion-ghost` exists over the restored page, gone within 1 s, and the page is clickable immediately (a click on a Home tile during the animation navigates); `'with Motion Reduced there are no ghosts'`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** in `page-transition.ts` a branch for changes into/out of `listen` (motion `full` only; otherwise today's instant change):
  - Open: `ghost(.shell)` without its `.dock` (remove it from the clone), placed under the shell (`z-index: -1`, above Mica); `update()`; animate `.canvas` `clip-path` from the dock cover's box (`inset(… round var(--r-art))`) to `inset(0 round 0)` with `timing('spring')`; the ghost to `scale: 0.95; opacity: 0.2` with `timing('exit-big')`; `fly(dock cover, .np-side .art--cover, timing('spring'))`; `.np-titles`, `.np-progress` and the lyric list rise in with `--stagger`; remove the ghost when the clip finishes.
  - Close: `ghost(.canvas)` (its `.stage` set to `data-renderer="css"` so the CSS room paints instead of the blank cloned WebGL canvas) above the shell, below the dock; `update()`; animate the ghost's `clip-path` to the dock cover's box with `timing('exit-big')` and `fly(ghost cover, dock cover, timing('exit-big'))`; the returning `.topbar`, `.library-panel`, `.canvas`, `.right-panel` spring from `scale: 0.95; opacity: 0.2`; remove the ghost at the end. The ghost has `pointer-events: none`.
- [ ] **Step 4: Run** `pnpm playwright test motion stage stage-chrome lyrics --project=chromium --project=firefox` and `pnpm playwright test perf --project=isolated` (PERF-03 holds) — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Web: the lyrics view grows from the player and shrinks back"`

### Task 9: Toasts, tabs, switches, chips, the cover on song change

**Files:**
- Modify: `src/client/ui/motion.ts`, `src/client/ui/ui.css` (`.toast`), `src/client/main.css` (`.source-switch`, `.chip`, `.pref-choice` pressed backgrounds move to `::before`; `.tabbar` indicator), `src/client/shell/SourceSwitch.tsx`, `src/client/shell/LibraryPanel.tsx` (chips), `src/client/shell/SettingsViews.tsx` (pref choices), `src/client/shell/Shell.tsx` (`TabBar`), `src/client/shell/Dock.tsx:93`, `src/client/shell/RightPanel.tsx` (Now Playing cover)
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `useSlide(ref: RefObject<HTMLElement | null>, selected: string): void` (`selected` = CSS selector of the chosen item, e.g. `[aria-pressed="true"]`; when the chosen item changes, its `::before` animates from the previous item's box via `animate(…, { pseudoElement: '::before', ...timing('spring') })`).

- [ ] **Step 1: Write failing e2e tests**: `'a toast springs up'` (running animation on `.toast` right after it appears); `'the switch indicator slides'` (Settings segmented choice or the source switch: after clicking the other option, the pressed button's `::before` has a running animation — `getAnimations()` on the button filtered by `effect.pseudoElement === '::before'`); `'the player cover springs in on a new song'` (Next → `.dock .art` has a running animation).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: toast enters with `@starting-style { opacity: 0; translate: 0 16px; scale: 0.96 }` (`var(--fade)`, `var(--spring)`), leaves with `var(--exit)`. Segmented controls and chips paint the pressed state on `::before` (`position: absolute; inset: 0; border-radius: inherit; z-index: -1`; host `position: relative; isolation: isolate`) and call `useSlide`. Tab bar (compact): the active tab's pill/indicator on `::before`, `useSlide(nav, '[aria-current="page"]')`. Dock and Now Playing covers: `<Artwork key={track.key} …>` inside an element that runs `cover-in` (`from { scale: 0.9; opacity: 0 }`, `var(--spring)`/`var(--fade)`). Update the `Artwork` doc comment ("never cropped or animated" → never cropped; arrives with the spring).
- [ ] **Step 4: Run** `pnpm playwright test motion ui shell source --project=chromium --project=firefox` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Web: toasts, tabs, switches and covers spring"`

### Task 10: Navidrome ↔ Spotify, and everything else that shows or hides

**Files:**
- Modify: `src/client/shell/SourceSwitch.tsx` (and the phone avatar menu's source switch in `src/client/shell/AccountMenu.tsx`), `src/client/shell/page-transition.ts`, `src/client/main.css`, `src/client/ui/ui.css`
- Test: `tests/e2e/motion.spec.ts`

**Interfaces:**
- Produces: `switchTransition(update: () => void): void` in `page-transition.ts` (a View Transition naming `.canvas` `page` and `.library-panel` `library`, same keyframes as a page change; instant when motion is not `full` or View Transitions are missing).

- [ ] **Step 1: Write failing e2e tests**: `'switching library source is a page change'` (Spotify connected via `connectSpotify`; spy `startViewTransition`; clicking Spotify calls it once); `'block states and notices fade in'` (an error block from `faults()` has a running animation when it appears).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: both source switches call `switchTransition(() => setSource(s))`. Give `@starting-style` fade + spring rise (`translate: 0 8px`) to `.block-error`, `.block-empty`, `.notice`, `.home-reconnect`, `.freshness`, the sticky page header's appearance, and any element in client CSS that switches `display` on a state attribute without a transition (search: `[data-` state rules setting `display`/`opacity` without `transition`).
- [ ] **Step 4: Run** `pnpm playwright test motion spotify source states --project=chromium --project=firefox --project=isolated` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Web: source switches and state changes animate"`

### Task 11: Whole-app verification and docs

**Files:**
- Modify: `docs/README.md` (status), `docs/ACCEPTANCE_CRITERIA.md` (add `MOT-01` … one line per "What moves" item, pointing at `tests/e2e/motion.spec.ts`), the spec's status line

- [ ] **Step 1: Run** `pnpm check` — Expected: typecheck, lint, all unit tests and the build pass; note the shell bundle size against PERF-05.
- [ ] **Step 2: Run** `pnpm test:e2e` (all three projects) — Expected: everything passes except the known Firefox LYR-17 failure (`lyrics.spec.ts:426`).
- [ ] **Step 3: Click through** every "What moves" item in Chromium and Firefox on a dev server (screen recordings to the scratchpad); fix anything that still pops.
- [ ] **Step 4: Whole-branch review** with a fresh reviewer; fix findings test-first.
- [ ] **Step 5: Commit docs** — `git commit -m "Docs: spring motion built"`; report to the owner and merge/deploy only on their OK.
