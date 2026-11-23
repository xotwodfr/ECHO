import Foundation

// Every lyric-field constant, the web's (src/client/stage/lyrics/lyricsConfig.ts,
// LYRICS_EXPERIENCE.md §15) grouped by the spec's sections, so the three clients move the words
// alike. Change them there first.

enum LyricsConfig {
    /// §3.2: the active line's centre, as a share of the stage's height.
    static let anchorY = 0.4
    /// §5.1: the active line's unsung words, 22% toward the room so the sweep reads.
    static let unlitMix = 0.22
    /// §3.3: the column's width, as a share of the lyric area's.
    static let maxWidth = 0.84
    static let maxRows = 2
    static let shrinkMax = 0.12

    /// §4: one column, every line one gap (× the dots' row) from its neighbour, kept while its slot
    /// is within `margin` of the stage; the distance z grows by `dz` a line.
    enum Column {
        static let gap = 0.45
        static let dz = 0.25
        static let margin = 0.25
    }

    /// §4.1, of the distance z.
    static let opacity: [(Double, Double)] = [(0, 1), (0.25, 0.5), (0.5, 0.42), (1, 0.32)]
    static let blur: [(Double, Double)] = [(0, 0), (0.25, 1.2), (0.5, 2.2), (0.75, 3.2), (1, 4)]

    /// §5.1: a sung word rises 0.05 em; the word being sung swells to `peak`, and back after it.
    enum Word {
        static let liftEm = 0.05
        static let peak = 1.07
        static let popMs = 140.0
        static let releaseMs = 300.0
    }

    /// §5.1: the soft edge, em ahead of and behind it.
    enum Sweep {
        static let edgeAhead = 0.35
        static let edgeBehind = 0.6
        static let holdGapMs = 300.0
        static let minWordMs = 60.0
    }

    /// §5.2, §9.6, §12.5.
    enum Glow {
        static let radius = 0.18
        static let radiusMax = 0.26
        static let alpha = 0.35
        static let alphaMax = 0.55
        static let decayMs = 220.0
        /// Words under 150 ms (§9.9).
        static let decayFastMs = 120.0
        static let riseMs = 90.0
        /// Photosensitivity: the glow's alpha never changes faster.
        static let slewPerS = 1.5
        /// Paused: the glow dims to 60% over 600 ms and comes back over 300 ms.
        static let paused = 0.6
        static let pauseMs = 600.0
        static let resumeMs = 300.0
    }

    /// §9.2: a line-synced line lights as one wash.
    enum Wash {
        static let ms = 420.0
    }

    /// §5.3, §9.9.
    enum Handover {
        static let leadMinMs = 120.0
        static let leadMaxMs = 300.0
        static let coalesceMs = 350.0
    }

    /// §5.5: held words.
    enum Emphasis {
        static let minMs = 1000.0
        static let minG = 2
        static let maxG = 7
        static let anticipateMs = 400.0
        static let releaseMs = 250.0
        static let swellMax = 0.08
    }

    /// §6.1: frequency (Hz) and damping ratio.
    enum Springs {
        static let normal = (fMin: 2.0, fMax: 2.35, zeta: 1.0)
        static let slow = (f: 1.45, zeta: 1.0)
        static let enter = (f: 1.1, zeta: 0.95)
        static let lift = (f: 1.2, zeta: 0.75)
        static let impulse = (f: 2.0, zeta: 0.5)
    }

    /// §6.3.
    enum Stagger {
        static let baseMs = 50.0
        static let decay = 1.05
    }

    /// §7: a sung line's lit colour dies into ink.
    enum Decay {
        static let tauMs = 520.0
        static let dropMs = 120.0
    }

    /// §9.8.
    enum Interlude {
        static let minGapMs = 7000.0
        static let cycleMs = 4000.0
        static let leaveMs = 500.0
        static let enterMs = 750.0
        static let fadeMs = 250.0
        static let dotEm = 0.22
        static let dotStepMs = 80.0
    }

    /// §9.5, §9.6, §9.7.
    enum Build {
        static let fadeInMs = 400.0
        static let seekOutMs = 160.0
        static let recedeMs = 420.0
    }

    /// §10.
    enum Reduced {
        static let crossfadeMs = 180.0
        static let dotsAlpha = 0.6
    }

    /// §9.2.
    enum LineTimed {
        static let endGapMs = 100.0
        static let lastLineMs = 6000.0
    }

    /// §12.
    enum Beat {
        static let scaleMax = 0.012
        static let scaleCap = 0.015
        static let quietMs = 300.0
        static let bassForce = 0.022
        static let sustainAttackMs = 120.0
        static let sustainReleaseMs = 400.0
        static let intenseAbove = 0.75
        static let passageMs = 2000.0
        static let intenseGlow = 0.05
    }
}

@inline(__always)
func lyricClamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double {
    min(hi, max(lo, x))
}
