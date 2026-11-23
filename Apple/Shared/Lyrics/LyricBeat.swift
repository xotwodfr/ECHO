import Foundation

// The lyric field's response to the music (LYRICS_EXPERIENCE.md §12;
// src/client/stage/lyrics/beat.ts): one set of terms per frame from the song's features, with the
// readability caps of §12.4 applied after summing. The apps analyse no audio yet, so they pass
// `.silent` (g 0.6, every beat term 0, as the spec has it without analysis); the terms are here so
// the field is the web's and features can come later.

/// The per-frame audio features (VISUALIZER_SPEC.md §3), each 0…1.
struct LyricFeatures: Equatable, Sendable {
    var available = false
    var bass = 0.0
    var mid = 0.0
    var onset = 0.0
    var intensity = 0.6
    var bassImpulse = 0.0

    /// No analysis.
    static let silent = LyricFeatures()
}

struct LyricBeatTerms: Equatable, Sendable {
    /// The motion gain (§12.2).
    var g: Double
    /// The active line's scale, added to 1 (≤ scaleMax).
    var pulse: Double
    /// 0…1: the glow's radius and alpha (§12.3).
    var sustain: Double
    /// Intense passages: +0.05 alpha.
    var glowAdd: Double
}

enum LyricFieldMode: Equatable, Sendable {
    /// Playing or paused: springs, stagger, the lot.
    case run
    /// The scrubber is held: everything at its place for that time, no springs.
    case scrub
    /// One deterministic frame, everything settled.
    case still
}

struct LyricBeatInput {
    var features: LyricFeatures
    var dt: Double
    /// ms since the current hand-over; under quietMs no beat response (§12.4).
    var sinceHandover: Double
    /// 0…1: the sustained-vocal heuristic before smoothing.
    var vocal: Double
    var mode: LyricFieldMode
    /// Reduced motion (§10): no beat response on text at all.
    var reduced: Bool
}

final class LyricBeat {
    private var bass = LyricSpring(0)
    private var sustainV = 0.0
    /// 0…1, blended over 2 s.
    private var intense = 0.0

    /// The kick that makes a unit impulse peak at 1: x(t) = v₀/ω_d · e^(−ζωt) · sin ω_d t.
    static let unitKick: Double = {
        let p = LyricSprings.impulse
        let w0 = 2 * Double.pi * p.f
        let wd = w0 * (1 - p.zeta * p.zeta).squareRoot()
        let tPeak = atan2(wd, p.zeta * w0) / wd
        return wd / (exp(-p.zeta * w0 * tPeak) * sin(wd * tPeak))
    }()

    func update(_ i: LyricBeatInput) -> LyricBeatTerms {
        let B = LyricsConfig.Beat.self
        let ft = i.features
        let dt = i.dt
        let on = ft.available && !i.reduced
        let g = ft.available ? 0.35 + 0.65 * lyricClamp(ft.intensity, 0, 1) : 0.6
        let still = i.mode == .still

        // Bass: the positive derivative of the bass envelope is a force on the impulse spring.
        if still || !on {
            bass.snap(0)
        } else {
            bass.step(to: 0, LyricSprings.impulse, dtMs: dt)
            if i.mode == .run { bass.v += B.bassForce * Self.unitKick * ft.bassImpulse * dt }
        }

        // Sustained vocals: attack 120 ms, release 400 ms.
        let vocal = lyricClamp(i.vocal, 0, 1)
        if still {
            sustainV = vocal
        } else {
            let tau = vocal > sustainV ? B.sustainAttackMs : B.sustainReleaseMs
            sustainV += (vocal - sustainV) * (1 - exp(-dt / tau))
        }

        // Intense passages (> 0.75), blended over 2 s.
        let intenseOn = ft.available && ft.intensity > B.intenseAbove
        intense = still ? (intenseOn ? 1 : 0) : lyricClamp(intense + (intenseOn ? 1 : -1) * dt / B.passageMs, 0, 1)

        // §12.4: nothing for 300 ms after a hand-over, then in over 100 ms; clamped after summing.
        let gate = on ? Self.smoothstep(B.quietMs, B.quietMs + 100, i.sinceHandover) : 0
        return LyricBeatTerms(
            g: g,
            pulse: lyricClamp(B.scaleMax * g * bass.x * gate, -B.scaleCap, B.scaleCap),
            sustain: i.reduced ? 0 : sustainV,
            glowAdd: i.reduced ? 0 : B.intenseGlow * intense)
    }

    static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let k = lyricClamp((x - a) / (b - a), 0, 1)
        return k * k * (3 - 2 * k)
    }

    /// The sustained-vocal heuristic (§12.3) for the active line at `t`.
    static func vocal(_ words: [LyricWord]?, lineActive: Bool, mid: Double, at t: Double) -> Double {
        guard lineActive else { return 0 }
        guard let words, !words.isEmpty else { return mid }
        guard let w = words.first(where: { t >= $0.start && t < $0.end }) else { return 0 }
        return smoothstep(600, 1500, t - w.start) * mid
    }

    /// The glow's alpha and radius for a sustain level (§12.3), capped at alphaMax.
    static func glow(sustain: Double, add: Double) -> (alpha: Double, radius: Double) {
        let G = LyricsConfig.Glow.self
        return (min(G.alphaMax, G.alpha + (G.alphaMax - G.alpha) * sustain + add), G.radius + (G.radiusMax - G.radius) * sustain)
    }
}
