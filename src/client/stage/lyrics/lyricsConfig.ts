// Every lyric-field constant (LYRICS_EXPERIENCE.md §15), grouped by spec section. Tuning sessions
// change only this file, and changed values are written back into the spec.

export const LYRICS = {
  anchorY: 0.4, // §3.2
  unlitMix: 0.22, // §5.1: unsung ink at the anchor, 22% toward the room (M3 design review)
  maxWidth: 0.84, // §3.3: of the lyrics view's right side (2026-10-29)
  maxRows: 2,
  shrinkMax: 0.12,
  // §4: one column. The active line (or the dots) sits at the anchor, every other line one gap
  // (× the dots' row, ≈ 0.5 em) above or below its neighbour; lines are kept while their slot is
  // within `margin` H of the stage. Distance z grows by dz per line, 1 from the fourth on.
  column: { gap: 0.45, dz: 0.25, margin: 0.25 },
  depth: {
    // §4.1, of the distance z
    opacity: [
      [0, 1],
      [0.25, 0.5],
      [0.5, 0.42],
      [1, 0.32],
    ],
    blur: [
      [0, 0],
      [0.25, 1.2],
      [0.5, 2.2],
      [0.75, 3.2],
      [1, 4],
    ],
  },
  // §5.1: a sung word rises 0.05em; the word being sung swells to `peak`, and back to 1 after it
  word: { liftEm: 0.05, peak: 1.07, popMs: 140, releaseMs: 300 },
  sweep: { edgeAhead: 0.35, edgeBehind: 0.6, holdGapMs: 300, minWordMs: 60 }, // §5.1
  glow: {
    radius: 0.18, // §5.2
    radiusMax: 0.26,
    alpha: 0.35,
    alphaMax: 0.55,
    decayMs: 220,
    decayFastMs: 120, // words < 150 ms (§9.9)
    riseMs: 90,
    slewPerS: 1.5, // photosensitivity (§12.5): alpha never changes faster
    paused: 0.6, // §9.6: dims to 60% over 600 ms, restores over 300 ms
    pauseMs: 600,
    resumeMs: 300,
  },
  wash: { ms: 420 }, // §9.2 line-timed lines
  handover: { leadMinMs: 120, leadMaxMs: 300, coalesceMs: 350 }, // §5.3, §9.9
  emphasis: { minMs: 1000, minG: 2, maxG: 7, anticipateMs: 400, releaseMs: 250, swellMax: 0.08 }, // §5.5
  springs: {
    normal: [2.0, 2.35, 1.0], // §6.1
    slow: [1.45, 1.0], // critically damped: +1 never drifts back down after a slow hand-over (LYR-05)
    enter: [1.1, 0.95],
    lift: [1.2, 0.75],
    impulse: [2.0, 0.5],
  },
  stagger: { baseMs: 50, decay: 1.05 }, // §6.3
  decay: { tauMs: 520, dropMs: 120 }, // §7: a past line's lit colour dies into ink
  interlude: {
    minGapMs: 7000,
    cycleMs: 4000,
    leaveMs: 500,
    enterMs: 750,
    fadeMs: 250,
    dotEm: 0.22,
    dotStepMs: 80,
  }, // §9.8
  build: { fadeInMs: 400, seekOutMs: 160, recedeMs: 420 }, // §9.5, §9.6, §9.7
  reduced: { crossfadeMs: 180, dotsAlpha: 0.6 }, // §10
  lineTimed: { endGapMs: 100, lastLineMs: 6000 }, // §9.2
  beat: {
    scaleMax: 0.012, // §12.3: 1 + 0.012·g·bassImpulse
    scaleCap: 0.015, // §12.4, after summing
    quietMs: 300, // §12.4: none after a hand-over
    bassForce: 0.022, // per ms: a bass hit (≈ 45 ms of bassImpulse) peaks the spring at its level
    sustainAttackMs: 120,
    sustainReleaseMs: 400,
    intenseAbove: 0.75,
    passageMs: 2000, // intense passages blend in and out
    intenseGlow: 0.05,
  },
} as const;
