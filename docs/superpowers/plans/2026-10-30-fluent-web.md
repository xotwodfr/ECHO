# ECHO web in Fluent 2 with Mica: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-11-02):** all six tasks done on branch `fluent-web` (43b9dc3…b88dbc0), plus fixes from the whole-branch review: opaque sticky headers, the icons' MIT licence shipped as `/licenses/fluentui-system-icons.txt`, and an opaque lyrics-view background (Mica showed through the room and made `listen-frame-390` flip). `pnpm check` passes (1396 unit tests). Full e2e in the CI image: 415 passed, 1 failed: Firefox LYR-17 (`lyrics.spec.ts:426`), failing from 7a95ead (Selawik) on, cause not found. Deferred minors: Mica's unmount leaks one pending blob URL; a skip mid-crossfade pops; Mica re-bakes at 720/1280 but the layout breaks at 720/1024/1400; leftover "M3" comments and `--fl-snackbar-h`; the Mica contrast test omits the bake's saturate; `--fl-fg3` would fail AA on Mica. Merged into `main` 2026-11-02 (fast-forward, with LYR-17 still failing, owner's call); not deployed.

**Goal:** Restyle the web client from Material 3 to Fluent 2, dark only, with an album-tinted Mica glow that is blurred once per album, and change nothing about layout or behaviour.

**Architecture:** `tokens.css` gets a Fluent base layer (`--fl-*`). The alias names the components already read (`--frame`, `--panel`, `--text`, `--green`…) keep their names and are re-pointed at it, so component diffs stay small. `palette/fluent.ts` replaces `palette/m3.ts`: it turns the album accent into a small accent ramp, using the HCT tonal palette from the dependency already installed. `palette/mica.ts` bakes the glow into a blurred image on a canvas once per album, and two fixed layers crossfade by opacity. Fonts and icons are swapped, then the component CSS is restyled.

**Tech Stack:** React 19, Vite 8, plain CSS custom properties, `@material/material-color-utilities` (already a dependency), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-fluent-web-design.md`

## Global Constraints

- Web client only. Nothing under `Android/` changes.
- Dark only. No light theme and no `prefers-color-scheme` handling.
- Pages, frame, routes and behaviour stay the same. Only visuals change.
- No new runtime dependency. Fonts and icons are vendored into `src/client/`. Packages may be `npm pack`ed into the scratchpad to read values, but never added to `package.json`.
- DS-01: every colour, size, duration, easing and shadow lives in `src/client/tokens.css` (`design-rules.test.ts`).
- No `backdrop-filter` anywhere. No CSS `filter: blur()` outside `stage/`. The only blur is the once-per-album canvas bake.
- The Mica glow uses palette colours only, never a cover image (Spotify rule, `DESIGN_SYSTEM.md` §8).
- Spotify's touches stay as they are: `--genre-*`, `--liked-from`/`--liked-to`, `--title-*` sizes 96/72/48/32 (weight 800 → 700), `--mix-title`.
- The player stays a floating pill and keeps `--r-pill`.
- Font stack: `"Segoe UI Variable Text", "Segoe UI", "Selawik", system-ui, sans-serif`. Selawik is self-hosted (OFL). Figtree is deleted.
- Icons: Fluent UI System Icons (MIT), 24-unit grid, regular, plus filled for "on" states, inlined in `src/client/ui/icons.tsx`.
- Fluent token values come from `@fluentui/tokens` `webDarkTheme` (read it via `npm pack @fluentui/tokens` in the scratchpad) unless pinned below.
- `pnpm check` and the full e2e suite pass at the end of every task. Update visual baselines in the CI image (`scripts/e2e-container.sh --project=chromium <spec> -u`) only in Task 6.
- Commit messages follow the repo's style, e.g. `Web: …`.

## Review Focus

1. **Skipping quickly across albums.** If the user skips several albums inside one crossfade, Mica must end on the latest album's glow, drop older bakes that finish late, and revoke every object URL it made. (Task 2, `mica.spec.ts` "rapid skips land on the last album".)
2. **Very bright or near-white accents** (pale yellow, white covers). Secondary text over the layer over Mica must still be ≥ 4.5:1, and text on the accent ≥ 4.5:1. (Task 1 `fluent.test.ts`, Task 2 `mica.test.ts` seeds include `#FFF6B0` and `#F5F5F5`.)
3. **Resize storms.** Dragging the window edge or rotating a phone must re-bake at most once per breakpoint crossing, never once per resize event. (Task 2, "resizing within a breakpoint does not re-bake".)
4. **Same album, new track.** Spotify re-fetches the palette on every track (SP-04), and that must not re-bake when the colours haven't changed. (Task 2, "next track of the same album does not re-bake".)
5. **Canvas failure.** If `toBlob` yields `null` or throws, Mica shows the plain base, nothing throws, and the app works. (Task 2, unit test with an injected bake that fails.)

---

### Task 1: Fluent tokens and the accent ramp

**Files:**
- Create: `src/client/palette/fluent.ts`, `src/client/palette/fluent.test.ts`
- Delete: `src/client/palette/m3.ts`, `src/client/palette/m3.test.ts`
- Modify: `src/client/palette/live.ts` (swap `m3Scheme`/`M3_ROLES`/`m3Var` for the fluent equivalents), `src/client/tokens.css`, `src/client/design-rules.test.ts`, `src/client/ui/logic.ts` (`TOAST_EXIT_MS`), every stylesheet or TSX that reads `--md-sys-*` (about 100 references: `main.css`, `ui/ui.css`, `stage/stage.css`, shell TSX), `tests/e2e/smoke.spec.ts:28-29`, `tests/e2e/ui.spec.ts:462`

**Interfaces:**
- Produces:
  - `FLUENT_ROLES: readonly ['accent','accent-hover','accent-press','on-accent','accent-text','accent-subtle']`
  - `type FluentRole = (typeof FLUENT_ROLES)[number]`
  - `flVar(role: FluentRole): string`, which returns `--fl-${role}`
  - `fluentAccent(seed: string): Record<FluentRole, string>`, hex values
  - the `--fl-*` tokens listed in Step 3

- [ ] **Step 1: Write `fluent.test.ts`**

  Reuse `lum` and `contrast` from `m3.test.ts`. Seeds: the seven in `m3.test.ts` plus `'#FFF6B0'`, `'#F5F5F5'` and `'#535353'` (the fallback).
  - `it('every role is a hex colour for every seed')`: for every seed and role, `/^#[0-9A-F]{6}$/i`.
  - `it('text on the accent is readable')`: `contrast(on-accent, accent) >= 4.5`, and the same for `accent-hover` and `accent-press`.
  - `it('accent text is readable on the darkest and lightest layers')`: `contrast(accent-text, '#1C1C1C') >= 4.5` and `contrast(accent-text, '#3A3A3A') >= 4.5`.
  - `it('the accent stands out from the frame')`: `contrast(accent, '#202020') >= 3` (WCAG 1.4.11).
  - `it('keeps the seed hue')`: for `'#3A6FF2'`, the accent's HCT hue is within 15° of the seed's.

- [ ] **Step 2: Run** `pnpm vitest run src/client/palette/fluent.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `fluentAccent(seed)` in `palette/fluent.ts`.**

  Take `argbOf` over from `m3.ts`. Build `TonalPalette.fromInt(Hct.fromInt(argb))` with chroma `max(hct.chroma, 16)`, so grey seeds stay grey-ish but never fully grey. Tones: `accent` 80, `accent-hover` 85, `accent-press` 75, `on-accent` 10, `accent-text` 82, `accent-subtle` 30.

  Rewrite `tokens.css`:
  - Remove every `--md-sys-*`.
  - Add the Fluent base:

    ```
    --fl-mica-base: #1C1C1C;
    --fl-solid-base: #202020;
    --fl-layer: rgb(44 44 44 / 0.55);
    --fl-layer-alt: rgb(58 58 58 / 0.6);
    --fl-card: rgb(255 255 255 / 0.05);
    --fl-card-hover: rgb(255 255 255 / 0.08);
    --fl-subtle-hover: rgb(255 255 255 / 0.06);
    --fl-subtle-press: rgb(255 255 255 / 0.04);
    --fl-control: rgb(255 255 255 / 0.06);
    --fl-control-hover: rgb(255 255 255 / 0.084);
    --fl-control-press: rgb(255 255 255 / 0.033);
    --fl-flyout: #2C2C2C;
    --fl-dialog: #2B2B2B;
    --fl-stroke: rgb(255 255 255 / 0.08);
    --fl-stroke-control: rgb(255 255 255 / 0.07);
    --fl-stroke-strong: rgb(255 255 255 / 0.544);
    --fl-fg1: #FFFFFF;
    --fl-fg2: rgb(255 255 255 / 0.786);
    --fl-fg3: rgb(255 255 255 / 0.544);
    --fl-fg-disabled: rgb(255 255 255 / 0.363);
    ```

    Also add the six `--fl-<accent role>` fallback values (`fluentAccent('#535353')`). Add the status colours and their pill backgrounds from `webDarkTheme` (`colorPaletteRed/Green/Yellow` `Foreground1` and `Background2`), and `--fl-focus-outer: #FFFFFF; --fl-focus-inner: #000000`.
  - Shadows:

    ```
    --fl-shadow-4: 0 0 2px rgb(0 0 0 / .24), 0 2px 4px rgb(0 0 0 / .28);
    --fl-shadow-8: 0 0 2px rgb(0 0 0 / .24), 0 4px 8px rgb(0 0 0 / .28);
    --fl-shadow-16: 0 0 2px rgb(0 0 0 / .24), 0 8px 16px rgb(0 0 0 / .28);
    --fl-shadow-28: 0 0 8px rgb(0 0 0 / .24), 0 14px 28px rgb(0 0 0 / .28);
    --fl-shadow-64: 0 0 8px rgb(0 0 0 / .24), 0 32px 64px rgb(0 0 0 / .28);
    ```

  - Corners: `--fl-corner-s: 4px; --fl-corner-m: 8px; --fl-corner-circle: 999px`.
  - Re-point the aliases:
    - `--frame: transparent`. Mica shows through it (Task 2); until then `body` uses `--fl-solid-base`.
    - `--panel: var(--fl-layer)`, `--raised: var(--fl-card)`, `--raised-2: var(--fl-card-hover)`, `--raised-3: var(--fl-control-hover)`.
    - `--hover-row: var(--fl-subtle-hover)`, `--press-row: var(--fl-subtle-press)`, `--selected-row: var(--fl-card)`.
    - `--green: var(--fl-accent)` (plus hover, press, and `--on-green`).
    - `--text: var(--fl-fg1)`, `--muted: var(--fl-fg2)`, `--faint: var(--fl-fg3)`, `--line: var(--fl-stroke)`, `--control: var(--fl-stroke-strong)`, `--focus: var(--fl-focus-outer)`.
    - `--card-shadow: var(--fl-shadow-4)`, `--shadow-float: var(--fl-shadow-16)`, `--shadow-play: var(--fl-shadow-8)`.
    - `--r-control: var(--fl-corner-s)`, `--r-panel: var(--fl-corner-m)`, `--r-art: var(--fl-corner-s)`, `--r-art-lg: var(--fl-corner-m)`, `--r-card: var(--fl-corner-m)`. `--r-pill` is unchanged.
    - Everything else that pointed at an M3 role points at the closest `--fl-*`.
  - Motion:
    - `--dur-press: 100ms; --dur-hover: 150ms; --dur-ui: 200ms; --dur-toast: 250ms; --dur-page: 250ms; --dur-page-out: 100ms; --dur-scrub: 100ms`
    - `--ease-out: cubic-bezier(0.1,0.9,0.2,1); --ease-in-out: cubic-bezier(0.33,0,0.67,1); --ease-exit: cubic-bezier(0.9,0.1,1,0.2)`
    - `--dur-art`, `--dur-palette`, `--dur-pop`, `--dur-loop`, `--dur-art-out`, `--dur-morph` stay (lyrics view and palette).
    - Set `TOAST_EXIT_MS = 250`.
  - Type: replace `--md-sys-typescale-*` with the Fluent ramp and rename every use with this map:

    | New token | Value | Replaces |
    |---|---|---|
    | `--fl-type-caption` | `400 12px/16px` | `body-small` |
    | `--fl-type-caption-strong` | `600 12px/16px` | `label-medium`, `label-small` |
    | `--fl-type-body` | `400 14px/20px` | `body-medium` |
    | `--fl-type-body-strong` | `600 14px/20px` | `title-small`, `label-large`, `label-large-emphasized` |
    | `--fl-type-body-large` | `400 16px/22px` | `body-large` |
    | `--fl-type-subtitle2` | `600 16px/22px` | `title-medium` |
    | `--fl-type-subtitle1` | `600 20px/28px` | `title-large`, `title-large-emphasized` |
    | `--fl-type-title3` | `600 24px/32px` | `headline-small` |
    | `--fl-type-title2` | `600 28px/36px` | `headline-medium` |
    | `--fl-type-title1` | `600 32px/40px` | `headline-large*`, `display-small` |

    The one `--md-sys-tracking-*` use becomes `normal`. `--title-xl/l/m/s` weight becomes 700. Remaining `--md-*` component sizes keep their values under `--fl-` names.

  In `design-rules.test.ts`, update the DS-02 shadow regex to `/^var\(--(fl-shadow-\d+|shadow-[a-z]+|card-shadow|ring-[a-z-]+)\)$/`, the tracking regex to `/^(var\(--tracking-[a-z-]+\)|normal)$/`, and the comments that mention M3.

  In `smoke.spec.ts:28-29` and `ui.spec.ts:462`, read `--fl-solid-base`, `--fl-layer` and `--fl-accent` instead of the M3 roles.

- [ ] **Step 4: Run** `pnpm vitest run src/client/palette` and `grep -rn "md-sys" src tests`. Expected: tests PASS; the grep prints nothing.

- [ ] **Step 5: Run** `pnpm check`, then `pnpm test:e2e --project=chromium smoke ui pages shell.spec contrast`. Expected: PASS, apart from pixel baselines (`*.visual`), which are not run until Task 6.

- [ ] **Step 6: Commit.** `Web: Fluent 2 tokens; the album accent becomes a Fluent accent ramp`

### Task 2: Mica, baked once per album

**Files:**
- Create: `src/client/palette/mica.ts`, `src/client/palette/mica.test.ts`, `src/client/shell/Mica.tsx`, `tests/e2e/mica.spec.ts`
- Modify: `src/client/palette/live.ts` (add `target` to `paletteStore`), `src/client/shell/Shell.tsx` (mount `<Mica/>` as the first child of the app root), `src/client/main.css`, `src/client/tokens.css`, `src/client/design-rules.test.ts`

**Interfaces:**
- Consumes: `Roles` from `palette/animator.ts`, `paletteStore` from `live.ts`.
- Produces:
  - `paletteStore` state gains `target: Roles | null`. It is set in `show()` only when `key !== target` changes, and is `null` when there is no album or the fetch failed.
  - `micaStops(roles: Roles): [string, string, string]`, which returns OKLCH strings.
  - `type Bake = (stops: [string, string, string], w: number, h: number) => Promise<Blob | null>`
  - `bakeCanvas: Bake`
  - `startMica(host: HTMLElement, opts?: { bake?: Bake }): () => void`
  - Tokens: `--mica-opacity: 0.55`, `--mica-scale: 8` (bake at 1/8 of the window), `--mica-blur: 15px`, `--mica-saturate: 1.3`. `mica.ts` reads these through `getComputedStyle` so the values stay in `tokens.css`.

- [ ] **Step 1: Write `mica.test.ts`** (Node environment; stub `URL.createObjectURL`/`revokeObjectURL`, `matchMedia`, and a minimal host with two child objects that record `style` and `dataset`).
  - `it('stops take the highlight, accent and room hues, capped dark enough')`: for the seeds in Task 1, every stop's OKLCH L is in [0.25, 0.6] and C ≤ 0.15.
  - `it('secondary text stays readable over the layer over Mica')`: for each stop, composite `stop` at `--mica-opacity` over `#1C1C1C`, then `rgb(44 44 44 / .55)` over that. `contrast(rgba(255,255,255,.786) composited, result) >= 4.5`.
  - `it('bakes once per target, not per track')`: set `paletteStore.target` to roles A, then to an equal-valued copy of A. The bake spy is called once.
  - `it('rapid skips land on the last album')`: targets A, B and C are set back to back, with bake promises that resolve in the order C, A, B. The on layer ends showing C's URL, and the URLs for A and B are revoked.
  - `it('a failed bake leaves the plain base')`: the bake resolves `null` and later rejects. No layer has `data-on`, and nothing throws.
  - `it('null target turns Mica off')`: from A to `null`, no layer has `data-on`.

- [ ] **Step 2: Run** `pnpm vitest run src/client/palette/mica.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**
  - `micaStops`: clamp each of `highlight`, `accent` and `room` in OKLCH (reuse `shared/oklab.ts`).
  - `bakeCanvas`: follow the prototype's `?v=baked` code. Use a canvas of `ceil(w/scale)+30 × ceil(h/scale)+30`, a 135° linear gradient through the three stops, then `ctx.filter = 'blur(var) saturate(var)'` with the token values. Draw with a 10px overscan, then `toBlob`.
  - `startMica`:
    - Subscribe to `paletteStore` `target`.
    - Bake, then set the inactive layer's `backgroundImage` to the object URL and move `data-on` to it.
    - Revoke the previous URL `DUR_PALETTE_MS` later.
    - Use a generation counter so stale bakes are dropped.
    - Re-bake on `matchMedia('(max-width: 719px)')` and `'(max-width: 1279px)'` change events only.
  - `Mica.tsx`: `<div className="mica" aria-hidden="true">` with two `.mica-layer` divs, calling `startMica` in an effect.
  - CSS: `.mica` is `position: fixed; inset: 0; z-index: -1; background: var(--fl-mica-base)`. `.mica-layer` has `background-size: 100% 100%; opacity: 0; transition: opacity var(--dur-palette) var(--ease-in-out)`. `[data-on]` sets `opacity: var(--mica-opacity)`.
  - In `design-rules.test.ts`, add `it('no stylesheet outside stage/ uses filter: blur')`, matching `/(^|[^-])filter\s*:[^;]*blur\(/` on non-`stage/` CSS.

- [ ] **Step 4: Run** `pnpm vitest run src/client/palette src/client/design-rules.test.ts`. Expected: PASS.

- [ ] **Step 5: Write `tests/e2e/mica.spec.ts`** (Chromium). Use `addInitScript` to count `HTMLCanvasElement.prototype.toBlob` calls on `window.__micaBakes`.
  - `'one bake per album'`: play Harbour Lights track 1 → 1 bake. Next track (same album) → still 1. Scroll the page and resize from 1440 to 1300 wide → still 1. Play another album → 2.
  - `'crossing a breakpoint re-bakes once'`: resize from 1440 to 700 in 10 steps → exactly +1.
  - `'Mica shows the album colour'`: sample a pixel of the frame gutter before and after playing. It changes, and stays within the clamp.

- [ ] **Step 6: Run** `pnpm test:e2e --project=chromium mica perf contrast`. Expected: PASS.

- [ ] **Step 7: Commit.** `Web: Mica behind the frame, the album's glow blurred once per album`

### Task 3: Type: Segoe UI, then Selawik

**Files:**
- Create: `src/client/fonts/selawik-{regular,semibold,bold}-{latin,latin-ext}.woff2`, `src/client/fonts/OFL-Selawik.txt`
- Delete: `src/client/fonts/figtree-*.woff2`, `src/client/fonts/OFL-Figtree.txt`
- Modify: `src/client/fonts.css`, `src/client/tokens.css` (`--font`, `--font-ui`), `src/client/stage/lyrics/layout.ts` (comments and any Figtree name), `src/client/stage/lyrics/field.ts`, `tests/e2e/smoke.spec.ts:42-60`, `tests/e2e/stage.spec.ts:106`

- [ ] **Step 1: Rewrite the smoke test** `'everything uses Figtree, and nothing else'` as `'the type is Segoe UI, falling back to Selawik'`:
  - The token matches `/^"?Segoe UI Variable Text"?, "?Segoe UI"?, "?Selawik"?,/`.
  - The computed family of `body` and the dock equals the token.
  - `document.fonts.check('600 16px "Selawik"')` is true.
  - The loaded families are `['Selawik']` on the Linux test box.

  In `stage.spec.ts:106`, load `"Selawik"`.

- [ ] **Step 2: Run** `pnpm test:e2e --project=chromium smoke`. Expected: FAIL.

- [ ] **Step 3: Get the font files.**
  - Download Selawik's latest release from `github.com/microsoft/Selawik`: `selawk.ttf`, `selawksb.ttf`, `selawkb.ttf` and the licence.
  - Subset to the same two unicode ranges as `fonts.css` today with `uvx --from 'fonttools[woff]' pyftsubset <ttf> --unicodes=<range> --flavor=woff2 --output-file=…`.
  - In `fonts.css`, add six `@font-face` rules (family `"Selawik"`, weights 400/600/700, `font-display: swap`) and a header comment like the Figtree one.
  - Set `--font` and `--font-ui` to the stack in Global Constraints. The lyrics follow `--font`.

- [ ] **Step 4: Run** `pnpm check && pnpm test:e2e --project=chromium smoke stage lyrics`. Expected: PASS.

- [ ] **Step 5: Commit.** `Web: Segoe UI where installed, Selawik everywhere else; Figtree goes`

### Task 4: Fluent UI System Icons

**Files:**
- Modify: `src/client/ui/icons.tsx`, `src/client/ui/ui.css` (`.icon`, `.icon--solid`), the 12 TSX call sites that pass `icon--solid`, `src/client/tokens.css` (`--icon: 20px`)

**Interfaces:**
- Produces: `Icon({ name, className, solid }: { name: IconName; className?: string; solid?: boolean })`. `IconName` keeps its current 40 keys, so callers don't change apart from `solid`.

- [ ] **Step 1: Get the icons.** Run `npm pack @fluentui/svg-icons` in the scratchpad and extract it. For each of the 40 keys, take the closest-meaning `<name>_24_regular.svg` and `<name>_24_filled.svg`. Copy the path `d` attributes into `PATHS` as `{ regular, filled }`. Put the source file name in a comment beside each key.

- [ ] **Step 2: Implement `Icon`.** Use `fill="currentColor"` with no stroke attributes, render `filled` when `solid`, and keep `viewBox="0 0 24 24"`. Replace `className="icon--solid"` (or `className={cond ? 'icon--solid' : …}`) with `solid={cond}`, and delete the `.icon--solid` CSS.

- [ ] **Step 3: Run** `pnpm check && grep -rn "icon--solid\|strokeWidth" src/client`. Expected: PASS; the grep prints nothing.

- [ ] **Step 4: Run** `pnpm test:e2e --project=chromium ui shell.spec a11y`. Expected: PASS.

- [ ] **Step 5: Commit.** `Web: Fluent UI System Icons`

### Task 5: Fluent components

**Files:**
- Modify: `src/client/ui/ui.css`, `src/client/main.css`, `src/client/stage/stage.css` (chrome only: the pill and buttons), `src/client/tokens.css` (component sizes), `tests/e2e/ui.spec.ts:515-516` and any other e2e assertion on radius, height or colour that the restyle moves

Restyle to Fluent 2 as the spec's "Components" section lists. The values the spec doesn't pin:

- **Buttons:** `--control-h: 32px`, the page action bar 40px, padding `0 12px`, `--r-control`.
  - Primary: `--green` fill with `--on-green` text, plus `--fl-stroke-control`.
  - Secondary: `--fl-control` with `--fl-stroke-control`.
  - Subtle: transparent, `--fl-subtle-hover` on hover.
  - Hover and press change the fill only. Remove the scale transforms.
  - The round Play discs, the player pill, avatars and artist images stay round.
- **Inputs and search:** `--input-h: 40px`, `--search-h: 36px`, `--fl-control` fill, `--fl-stroke-control` edge, and a bottom edge of `--fl-stroke-strong`. On focus the bottom edge becomes 2px `--green` via a `--ring-input-focus` token.
- **Switch:** `--toggle-w: 40px; --toggle-h: 20px; --toggle-knob: 12px`.
  - Off: a `--fl-stroke-strong` outline, with the knob in the same colour.
  - On: `--green` fill, with the knob in `--on-green`.
- **Slider:** 4px rail of `--fl-stroke-strong`, `--green` fill, `--scrub-thumb: 20px` with a `--fl-flyout` disc and a 12px `--green` centre, always visible.
- **Navigation selected:** `--selected-row` fill plus a 3×16px `--green` bar on the leading edge. On the phone tab bar, a 16×3px bar under the icon. The M3 indicator pill goes.
- **Tabs:** a 3px `--green` underline with rounded ends. Filter chips become toggle buttons: `--r-control`, and selected uses `--green`/`--on-green`.
- **Track rows:** `--r-control` corners, `--hover-row` hover. The playing row gets `--raised` fill, a `--fl-stroke` edge and `--green` title.
- **Menus:** `--fl-flyout`, `--fl-stroke` edge, `--fl-shadow-16`, `--fl-corner-m`, 4px padding, 32px items with `--fl-corner-s` hover.
- **Side sheet:** `--fl-dialog`, `--fl-shadow-64`, `--fl-corner-m` on its open edge.
- **Dialog:** `--fl-dialog`, `--fl-shadow-64`, `--fl-corner-m`, 24px padding, `--fl-type-subtitle1` title, buttons at the end.
- **Toast** (formerly the snackbar): `--fl-flyout`, `--fl-stroke`, `--fl-shadow-16`, `--fl-corner-m`, with a status icon at the start. Same position above the player.
- **Focus:** everywhere, `outline: 2px solid var(--fl-focus-outer)` plus `box-shadow: var(--ring-focus-inner)` (`inset 0 0 0 1px var(--fl-focus-inner)`), with `outline-offset: 0`.
- **Player pill:** `--fl-flyout` with `--fl-stroke` and `--fl-shadow-16`, still `--r-pill`.

- [ ] **Step 1: Update the e2e assertions** that pin M3 looks to Fluent values. `ui.spec.ts:515` expects the card cover to stay `'8px'`, `:516` expects the row art to stay `'4px'`. Add `expect(await style(page, '.btn--primary', 'border-radius')).toBe('4px')` and `expect(await style(page, '.btn--primary', 'height')).toBe('32px')`, using the real primary-button class from `ui/controls.tsx`.

- [ ] **Step 2: Run** `pnpm test:e2e --project=chromium ui`. Expected: FAIL on the new assertions.

- [ ] **Step 3: Restyle** `ui.css`, `main.css` and the chrome of `stage.css` as listed above, one component group at a time. Check each group in the `/__ui` gallery (`pnpm dev`).

- [ ] **Step 4: Run** `pnpm check && pnpm test:e2e --project=chromium --project=firefox ui pages shell.spec dock stage-chrome a11y contrast`. Expected: PASS.

- [ ] **Step 5: Commit.** `Web: Fluent 2 controls, menus, dialogs, toasts and focus`

### Task 6: Docs, baselines and review

**Files:**
- Modify: `docs/DESIGN_SYSTEM.md` (Draft 6), `docs/ACCEPTANCE_CRITERIA.md` (DS-03, DS-10), `README.md` (wherever it describes the look), `tests/e2e/shell.visual.spec.ts-snapshots/*`, `tests/e2e/ui.visual.spec.ts-snapshots/*`

- [ ] **Step 1: Rewrite `DESIGN_SYSTEM.md`** as Draft 6: "Spotify's layout, Fluent 2's surfaces, Mica from the album". Rewrite §1 principles, §3 colour (the `--fl-*` table and the accent ramp tones), §4 type (the stack and the ramp table from Task 1), §6 surfaces and Mica, §7.11 (keep "No glass" and add the once-per-album bake as the one allowed blur), §9 components, and §11 motion values. Keep §2 frame, §5, §8, §10 and §12 except for M3 wording.
  - DS-10: "`--font` names one family and its fallbacks: Segoe UI where installed, Selawik shipped".
  - DS-03: Selawik renders, checked through `document.fonts`.
  - README: replace any "Material 3" or "Figtree" description of the web look. Android stays Material 3, so say so.

- [ ] **Step 2: Regenerate the baselines** in the CI image: `scripts/e2e-container.sh --project=chromium shell.visual ui.visual -u`. Open every changed PNG and check against the spec. Mica glow is visible behind the frame, there are no M3 pills or tonal blocks, and the Spotify touches are intact. Fix anything wrong before going on.

- [ ] **Step 3: Run the full gate:** `pnpm check && pnpm test:e2e`. Expected: all pass. The `dock.spec` flake noted on 2026-10-29 also fails at HEAD, so record it and don't count it as caused by this change.

- [ ] **Step 4: Review screenshots.** With `review-shots.spec.ts`, or by hand with Playwright, take desktop (1440×900) and phone (390×844) shots of Home, an album, Search, Your Library, Settings, an open menu, a dialog, a toast and the lyrics view. Check them against the approved prototype (`desk-baked.png`, `phone-baked.png`).

- [ ] **Step 5: Commit.** `Docs and baselines: Draft 6, Fluent 2 with Mica on the web`
