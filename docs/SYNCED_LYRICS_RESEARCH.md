# Synced lyrics: how the others do it, and what ECHO took

Research of 2026-10-24/25, made for the owner's request "research synced lyrics implementation". Four
open-source players were read at source level (shallow clones, `main` as of that date); two
services were measured live from the OptiPlex. ECHO took ideas and numbers only, no code. Where a
number is quoted it is the project's own constant.

| Project | What it is | Read |
|---|---|---|
| **AMLL** (Steve-xmh/applemusic-like-lyrics) | The reference Apple-Music-style lyric player for the web (DOM + WebGL background), used by many players | `packages/core/src/lyric-player/**` |
| **Spicy Lyrics** (Spikerko/spicy-lyrics) | Spicetify extension; also runs the Spicy Lyrics API ECHO uses (S2) | `src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts` |
| **Beautiful Lyrics** (surfbryce/beautiful-lyrics) | Spicetify extension Spicy grew out of | `Extension/Source/Modules/LyricsRenderer/**` |
| **YouLy+** (ibratabian17/YouLyPlus) | Browser extension for YouTube Music / Apple Music | sources and settings |

## 1. Word sync: how the light moves

| | AMLL | Spicy Lyrics | Beautiful Lyrics | ECHO before | ECHO now |
|---|---|---|---|---|---|
| Fill | `mask-image` gradient per word, fade width 0.5 × word height, stops 1 → 0.4 | One soft edge along the **whole line** (0.55em fade): words laid end to end, the fade spills into the next word | Per-syllable gradient | Per-word `background-clip:text` gradient, 0.35em ahead / 0.60em behind; the light went out at the end of each word box | **One edge along the line** (`lineEdges`): same fade widths, spills both ways, hold gaps (> 300 ms) still pre-light nothing |
| Word rise | `translateY(−0.05em)`, over max(1 s, word length), ease-out, from the word's start; ×2 on background vocals | Same rule ("never quicker than a letter's emphasis", 1 − (1 − x)²) | Spring per syllable: +1% → −1/60 em → 0 (overshoot) | — | 0.05em, over max(1 s, word length), ease-out; swell 1.05 → rest 1.02 (`wordMotion`) |
| Scale pop | Only on emphasised letters | Per letter 0.95 → 1.175 → 1 (spline + spring) | Per syllable 0.95 → 1.025 → 1 | — | — (see §4) |
| Emphasis (held words) | ≥ 1000 ms and 2–7 letters (CJK: duration only); letters staggered across the first 40% of the word; scale 1 + 0.1·a, spread 0.03em·a per letter from the middle, lift 0.025em·a, glow radius ≤ 0.3em; a = grow(du/2000)·0.6, last word ×1.6 | Same numbers ("Refreshed emphasis") | Spring glow per letter | ≥ 1000 ms, 2–7 graphemes, lift + swell ≤ 8%, last word ×1.4 | unchanged (already AMLL's rule; the letter **spread** is not built, §4) |
| Glow | `text-shadow` on emphasised letters | Glow spline 0 → 1 (15%) → hold → 0, per letter | Same spline | `drop-shadow` on the sweeping word, slew-limited (photosensitivity, §12.5) | unchanged |

Why the two changes matter: with a per-word gradient the bright edge vanishes at every word's right
edge and reappears at the next word's left edge, so on fast lines the light visibly "steps"; Spicy
fixed exactly this ("the light stopped at each one"). And a lift shorter than the word made long
words jump and settle while the voice was still on them; tying it to the word's length makes a line
drift up as one, the effect AMLL and Spicy share.

## 2. Line motion and depth

ECHO's own spec (LYRICS_EXPERIENCE.md §3–§9: anchor 0.40 H, z-depth with scale/opacity/blur tables,
springs, stagger, decay, interlude dots) was designed from AMLL and Apple Music in M3 and already
matches or exceeds what the others do (AMLL: springs mass 1, damping 10, stiffness 100 by default;
seek snaps without stagger, as ECHO's scrub does). Nothing here was changed.

## 3. Where word-timed lyrics come from

| Source | Word timing | Access | In ECHO |
|---|---|---|---|
| Your own files via Navidrome (enhanced LRC, TTML) | yes | your server | S1 |
| Spicy Lyrics API | yes (syllable, backing vocals, duets) | key; **Spotify track id** | S2; Navidrome tracks now get Spotify ids from the matching sweep (LYRICS_INTEGRATION.md §4.3) |
| NetEase Cloud Music (YRC) | yes, much of the Western catalogue | keyless, unofficial | S5 (added 2026-10-24) |
| LRCLIB | line (a few entries flag `hasWordSync`, format undocumented) | keyless | S3 |
| AMLL TTML database | yes, community TTML keyed by NetEase/Spotify/Apple ids | public Git repo, CC0 | not yet: ~1% of the owner's library (§4) |
| lyricsplus / KPoe (YouLy+'s backend) | yes: proxies Apple Music, Musixmatch, QQ, Spotify | keyless third-party proxy | **not adopted**: it redistributes catalogue lyrics; ECHO excludes Musixmatch-sourced synced lyrics for licensing (§1 "Not used") |
| Musixmatch richsync | yes | needs a commercial licence | not used (unchanged) |
| QQ Music (QRC), Kugou (KRC) | yes | encrypted formats, unofficial | not used |

Measured for the Spotify-id matching (2026-10-24, owner's library of 22,689 tracks): ListenBrainz's
metadata mapper matched 63% of the whole library in one pass of about four minutes; ISRC →
MusicBrainz → ListenBrainz recovers more of the rest at one request a second; Odesli/song.link's
public API is closed (`PUBLIC_API_ACCESS_DEPRECATED`).

## 4. Not built, ranked

1. **Letter spread in emphasis** (AMLL/Spicy: letters push 0.03em·a apart from the word's middle).
   Small: one more term in the grapheme transform `field.ts` already writes.
2. **Per-word scale pop** (Beautiful Lyrics: 0.95 → 1.025 → 1 on a spring). Changes the look more
   than the others; an owner taste call, and it must pass the §12.5 photosensitivity budget.
3. **LRCLIB word sync** once its `lyricsfile` format is documented.
4. **AMLL TTML database as a source** (amll-dev/amll-ttml-db, CC0; `spotify-lyrics/<id>.ttml`,
   `ncm-lyrics/<id>.ttml`). Measured 2026-10-25: **2 of 150** randomly chosen matched tracks of the
   owner's library have a file (by any of their Spotify ids), so it would add little over Spicy and
   NetEase for this library. Worth it only for a library heavy on what its contributors sync.

## 5. Sources

- AMLL: `packages/core/src/lyric-player/dom/animation/{float,emphasize,mask}`, `base/line.ts`
  (`shouldEmphasize`), `base/index.ts` (`wordFadeWidth = 0.5`), `utils/spring.ts`.
- Spicy Lyrics: `LyricsAnimator.ts` (`RefreshedEmphasis`, `getRefreshedFloat`, `RefreshedSweep`).
- Beautiful Lyrics: `Components/SyllableVocals.ts`, `LineVocals.ts`.
- YouLy+: `src/modules/lyrics/settings.js` (`lyricsSourceOrder: 'apple,lyricsplus,qq,musixmatch,musixmatch-word'`),
  `background/services/kpoeService.js`.
