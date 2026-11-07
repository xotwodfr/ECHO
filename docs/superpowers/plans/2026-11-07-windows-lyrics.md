# ECHO for Windows — Cider, better: the lyrics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The owner (2026-11-07, after 3.0.0): "the lyric experience should be WAY better, right now its very stale and ugly" — "restyle it as cider, but better, and the lyrics". Keep Cider 1's look; make the lyrics the Apple Music kind that Cider 4 shows, and polish the rest.

**Architecture:** A new lyrics engine in `App/Lyrics`: a pure timeline (what is sung when, word sweep, interludes) and a stage control with one visual per line, moved by closed-form springs on the frame clock. It replaces the drawer's lyrics and the fullscreen view (which becomes Cider 4's immersive view: artwork left, the lyrics card right, a fluid background, a floating player).

**Tech Stack:** Avalonia 12 (custom Render, BlurEffect per line, RequestAnimationFrame), Pretendard Bold (Cider's lyric face).

## Global Constraints

Reference values from `docs/DESIGN_RESEARCH.md` §3.2 (AMLL, Spicy Lyrics; numbers only, no code):
- The current line's top at 35 % of the stage's height; lines left-aligned (a duet's other voice right).
- Line springs ≈ 2.2 Hz, ζ 1 (no overshoot); stagger 50 ms per line from the current, ÷1.05 per step; snap on seek (backwards, or > 1 s off).
- Blur by distance d (lines): 1 + d px, cap 5 px; none while the pointer is over the lyrics. Other lines at 35 %, slightly smaller (96 %).
- Word sweep: sung white, unsung at 35 %, a soft edge 0.5 × font size wide, one continuous edge per line; each word lifts 0.05 em as it is sung.
- Emphasis: a word held ≥ 1 s of 2–12 letters grows up to 8 % and lifts further while held.
- Interludes: three breathing dots at gaps ≥ 7 s (and before the first line), lighting one by one.
- Background vocals at 60 % size under their line; line-timed lyrics light a whole line; untimed lyrics just list.
- Click a line to seek there; the wheel scrolls freely, following resumes 3 s later.
- No live blur outside the lyrics (owner rule): backgrounds are a cover blurred once, moved by transforms only.

## Review Focus

- A seek or a song change mid-line: lines snap, no stagger crawl, no stale sweep.
- Pause: everything holds still; nothing animates while paused and settled (no CPU use).
- A long line that wraps: the sweep runs row by row.
- Lyrics arrive late (after the 250 ms debounce): the stage builds then, at the current time.
- A tiny window (the drawer, 300 px): wrapping and font size still read.

---

### Task 1: The timeline and springs (pure) — `App/Lyrics/Timeline.cs`, `App/Lyrics/Springs.cs`; tests `Tests/LyricsTests.cs`
### Task 2: The stage control — `App/Lyrics/LyricsStage.cs`; screenshot checks
### Task 3: The drawer's lyrics and the immersive view — `App/Ui/FluidBackground.cs`, `App/Ui/ImmersiveView.cs`; replaces `LyricsPanel`, `FullscreenView`
### Task 4: Cider, better — page tint from the album's colours (Play/Shuffle, header), hover and page transitions
### Task 5: Docs, CI, release (the owner's word first)
