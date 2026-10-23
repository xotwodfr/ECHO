// Every lyric-field constant (LYRICS_EXPERIENCE.md §15), grouped by spec section. Tuning sessions
// change only this file, and changed values are written back into the spec.

export const LYRICS = {
  anchorY: 0.4, // §3.2
  maxWidth: 0.64, // §3.3
  maxRows: 2,
  shrinkMax: 0.12,
  depth: {
    scaleK: 0.3, // §4.1
    opacity: [
      [0, 1],
      [0.22, 0.74],
      [0.44, 0.54],
      [0.66, 0.4],
      [0.8, 0.24],
      [1, 0.12],
    ],
    blur: [
      [0, 0],
      [0.22, 1],
      [0.44, 2],
      [0.66, 3.2],
      [0.8, 4],
      [0.9, 6],
      [1, 8],
    ],
    zoneBlurCap: 4,
  },
  zone: {
    dz: 0.22, // §4.2, §4.3
    zMax: 0.72,
    zBackground: 0.78,
    gapH: 0.04,
    gapRefMs: 3200,
    gapClamp: [0.8, 1.5],
    gapShrinkMin: 0.5,
    bottom: 0.86,
    drift: 0.3,
    approachK: 0.35, // rank +1 closes 35% of its clearance
    clearH: 0.02, // and keeps at least this much
    approachZFloor: 0.65,
  },
  sweep: { edgeAhead: 0.35, edgeBehind: 0.6, holdGapMs: 300, minWordMs: 60 }, // §5.1
  glow: { radius: 0.18, radiusMax: 0.26, alpha: 0.35, alphaMax: 0.55, decayMs: 220 }, // §5.2
  handover: { leadMinMs: 120, leadMaxMs: 300, coalesceMs: 350 }, // §5.3, §9.9
  emphasis: { minMs: 1000, minG: 2, maxG: 7, anticipateMs: 400, releaseMs: 250, swellMax: 0.08 }, // §5.5
  springs: {
    normal: [2.0, 2.35, 1.0], // §6.1
    slow: [1.45, 0.85],
    enter: [1.1, 0.95],
    lift: [1.2, 0.75],
    impulse: [2.0, 0.5],
  },
  stagger: { baseMs: 50, decay: 1.05 }, // §6.3
  decay: { tauMs: 520, rise: 0.05, zEnd: 0.35, blurMax: 6, maxPast: 2 }, // §7
  background: { budget: [24, 12, 6, 0], minDist: 0.16, ampX: 0.022, ampY: 0.018, rise: 0.004 }, // §8
  interlude: { minGapMs: 7000, cycleMs: 4000, leaveMs: 500 }, // §9.8
  lineTimed: { endGapMs: 100, lastLineMs: 6000 }, // §9.2
  beat: { scaleMax: 0.012, zLean: 0.025, kickPx: 2, quietMs: 300 }, // §12
} as const;
