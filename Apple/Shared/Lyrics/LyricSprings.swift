import Foundation

// Damped harmonic springs (LYRICS_EXPERIENCE.md §6.1; src/client/stage/lyrics/springs.ts),
// integrated in closed form: one step is the exact solution for a target held over `dt`, so the
// path does not depend on the frame rate (60 or 120 Hz, a ProMotion screen slowing down) and never
// goes unstable.

struct SpringParams: Equatable, Sendable {
    /// Natural frequency, Hz.
    var f: Double
    /// Damping ratio.
    var zeta: Double
}

struct LyricSpring: Equatable, Sendable {
    var x: Double
    /// Units per second.
    var v: Double = 0

    init(_ x: Double = 0) {
        self.x = x
    }

    /// The longest step: a frame after a long stall never jumps.
    static let maxDtMs = 100.0

    /// Moves towards `target` for `dtMs` (clamped to 100 ms).
    mutating func step(to target: Double, _ p: SpringParams, dtMs: Double) {
        let t = min(Self.maxDtMs, max(0, dtMs)) / 1000
        if t == 0 { return }
        let w = 2 * Double.pi * p.f
        let z = p.zeta
        let u0 = x - target
        let v0 = v
        let u: Double
        let vel: Double
        if abs(z - 1) < 1e-6 {
            // Critically damped: u = (u0 + (v0 + w u0) t) e^(−wt)
            let e = exp(-w * t)
            let b = v0 + w * u0
            u = (u0 + b * t) * e
            vel = (b - w * (u0 + b * t)) * e
        } else if z < 1 {
            let wd = w * (1 - z * z).squareRoot()
            let e = exp(-z * w * t)
            let c = cos(wd * t)
            let sn = sin(wd * t)
            let b = (v0 + z * w * u0) / wd
            u = e * (u0 * c + b * sn)
            vel = e * ((b * wd - z * w * u0) * c - (u0 * wd + z * w * b) * sn)
        } else {
            let r = w * (z * z - 1).squareRoot()
            let r1 = -z * w + r
            let r2 = -z * w - r
            let c2 = (v0 - r1 * u0) / (r2 - r1)
            let c1 = u0 - c2
            let e1 = exp(r1 * t)
            let e2 = exp(r2 * t)
            u = c1 * e1 + c2 * e2
            vel = c1 * r1 * e1 + c2 * r2 * e2
        }
        x = target + u
        v = vel
    }

    /// At `target`, at rest (scrubbing, a still frame, a resize).
    mutating func snap(_ target: Double) {
        x = target
        v = 0
    }
}

enum LyricSprings {
    static let slow = SpringParams(f: LyricsConfig.Springs.slow.f, zeta: LyricsConfig.Springs.slow.zeta)
    static let enter = SpringParams(f: LyricsConfig.Springs.enter.f, zeta: LyricsConfig.Springs.enter.zeta)
    static let lift = SpringParams(f: LyricsConfig.Springs.lift.f, zeta: LyricsConfig.Springs.lift.zeta)
    static let impulse = SpringParams(f: LyricsConfig.Springs.impulse.f, zeta: LyricsConfig.Springs.impulse.zeta)

    /// `line.normal` for a hand-over between lines `gapMs` apart (start to start): faster lyrics get
    /// a stiffer spring, 2.35 Hz at 100 ms down to 2.0 Hz at 800 ms or more (the AMLL mapping).
    static func lineNormal(_ gapMs: Double) -> SpringParams {
        let s = LyricsConfig.Springs.normal
        let n = min(1, max(0, (gapMs - 100) / 700))
        return SpringParams(f: s.fMin + (s.fMax - s.fMin) * pow(1 - n, 0.2), zeta: s.zeta)
    }
}
