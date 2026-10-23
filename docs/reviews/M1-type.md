# M1: Typeface review (Geologica vs Mona Sans)

Status: **Decided: Mona Sans** (owner, 2026-10-23). Geologica is kept in the specimen as the
alternative for future comparison and is not shipped. Criteria: `DESIGN_SYSTEM.md` §4.1. Acceptance:
DS-03, DS-10 (`ACCEPTANCE_CRITERIA.md` §7), both pass (`M1.md`).

## How to review

```sh
pnpm install && pnpm build
ECHO_PORT=8787 pnpm start            # any free port; 8080 is the container default
# open http://localhost:8787/specimen.html
```

Or `pnpm dev` and open the Vite URL + `/specimen.html`. The specimen is a development page: the
production image is built with `ECHO_SPECIMEN=0`, so it (and Geologica) is not in the container.

- The specimen opens on Mona Sans. **F** switches to Geologica and back, **P** cycles the palette (Sodium, Tide, Ember). The buttons at
  the top right do the same. The URL keeps the state (`?face=mona&palette=tide`).
- Resize the window, or use the browser's device mode, to see the stage at other sizes. The stage is
  laid out at the real `--ly-active` for the window and re-laid out 120 ms after resizing stops.
- Scroll down for the review sheet: measured tabular digits, long lines at the real measures for
  1440×900, 1024×640 and 390×844, the shell type scale and the glyph set in both faces.
- Screenshots of every face × palette × viewport, in Chromium and Firefox:
  `SHOTS=1 pnpm test:e2e -g "review"` writes them to `specimen-shots/` (git-ignored).

The stage is a **frozen moment** built from the documented geometry (`LYRICS_EXPERIENCE.md` §3, §4,
§5, §8): the active line at 0.40 H with "Every" lit and "echo" mid-sweep with its glow, +1…+3 stacked by
time gap with the depth tables' scale, opacity, blur and ink, the line just sung decaying above, and a
seeded background field outside the reading corridor. The room is a static CSS stand-in for the WebGL
room (M2). Lyrics are original text, using the `accents-word` target: é ñ ø ß ç, Łódź (Latin-Ext), fi fl ffi
ffl, apostrophes, em dashes.

## Measured facts

Measured on 2026-10-23 with Playwright (Chromium 1248, Firefox 157) against the built specimen.

| | Geologica | Mona Sans |
|---|---|---|
| Files (Latin + Latin-Ext woff2, all axes) | 47.4 + 40.7 KB | 95.8 + 32.0 KB |
| Axes | wght 100–900, CRSV, SHRP 0–100, slnt | wdth 75–125, wght 200–900 |
| Renders (`document.fonts`, computed style, both subsets) | yes, Chromium + Firefox | yes, Chromium + Firefox |
| `tnum` (Q-DS-1): 10× "1" vs 10× "0" at 600 / 40px | proportional 180.3 / 273.2 px → tabular 259.2 / 259.2 px | proportional 160.3 / 254.9 px → tabular 240.0 / 240.0 px |
| Active line "Every echo finds its way back home" | 2 rows at 1440, 1024 and 390 | **1 row** at 1440 and 1024; 2 rows at 390 (`wdth` 92) |
| Upcoming lines at 390×844 | 3 rows each (no width axis) | 2 rows each, condensed to `wdth` 84–88 |
| Long-line demos at 1440 and 1024 | 2 rows, at most 2% shrink | 2 rows, no condensing |
| Long-line demos at 390 (measure 250 px, 32 px) | **4–5 rows** after the full 12% shrink | 3 rows at `wdth` 82 and 88% size |

Both faces pass Q-DS-1: no system-ui numeral fallback is needed.

## Observations made before the decision (not a recommendation)

- **Width is the main measurable difference.** Mona Sans is narrower at `wdth` 100 and can condense
  further. That means fewer rows, which matters most at compact widths, where Geologica breaks the
  "at most 3 rows" rule for real lyric lengths. Geologica has no width axis. Its only lever is the 12% shrink.
- **Character:** Geologica with `SHRP 30` is geometric and crisp, with an instrument-panel feel. Mona
  Sans is a warmer grotesk, and condensed lines change its texture line by line (computed once per
  line, never animated).
- **Blurred depth lines (+2/+3):** judge on the stage at 1440×900 in each palette (blur 3.1 px on
  +2; +3 is at background depth at this size, see finding 2). Not measurable: this is the eye test.
- **Lit word and glow:** both faces take the sweep gradient and glow identically (same CSS).

## Decision record

**Choice: Mona Sans**, by the owner on 2026-10-23, after reviewing the specimen. The owner gave the
decision as a whole and no per-criterion scores, so none are recorded here. The measured inputs are
in the table above (tabular digits: both pass).

Applied:

- `DESIGN_SYSTEM.md` §4 rewritten to the single family. `--font: "Mona Sans", system-ui, sans-serif`
  in `DESIGN_SYSTEM.md` §13 and `src/client/tokens.css`.
- `src/client/fonts.css` (imported by the application) declares only Mona Sans. Geologica's
  `@font-face` rules moved to `src/client/specimen/geologica.css`, imported only by the specimen.
- The specimen defaults to Mona Sans, with Geologica one key press away (`F`).
- **Instruction vs DS-10:** the owner asked to keep Geologica for comparison, while DS-10 says the
  unused face is not shipped. Both hold: Geologica stays in the repository and the dev-only
  specimen, and the production image is built without the specimen. The final image contains no
  Geologica file or reference (checked with `find` and `grep` in the image).
- Both licences are kept: `src/client/fonts/OFL-MonaSans.txt` and `OFL-Geologica.txt`, with
  attribution in the CSS headers. Mona Sans' Reserved Font Name "Mona" is respected: the Google
  Fonts files are redistributed unmodified under their own name.

## Findings for later milestones (from building the specimen)

1. **Glow on swept words (M3):** `LYRICS_EXPERIENCE.md` §5.2 specifies `text-shadow`, but a text
   shadow is painted above a `background-clip: text` fill and veils the sweep gradient. The specimen
   uses `filter: drop-shadow()` on the word span. M3 should confirm and update §5.2.
2. **Zone overflow at the primary viewport (M3):** with the documented gaps (`0.04 H · g`, `g` up to 1.5)
   and the 22ch measure, three two-row upcoming lines do not fit above 0.86 H at 1440×900. +3 is
   demoted to background depth there for **both** faces. M3's tuning pass (LYR-03, LYR-27) needs to
   decide whether that is intended.
3. **"Behind +2" for a demoted +3 (M3):** §4.3 can be read as "same position as +2". Placed there,
   +3 veils +2. The specimen keeps +3 at its own slot at background depth instead.
4. **DS-03 wording:** DS-03 mentions "Noto fallbacks", but `DESIGN_SYSTEM.md` §4.1 says no Noto
   webfonts are bundled and the numeral fallback is `system-ui`. DS-03 was tested against the
   design system's reading. The criterion text should be aligned when the face is chosen.
