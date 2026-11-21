import Foundation
import Testing

// The lyric field's springs (LYRICS_EXPERIENCE.md §6.1), against the web's own cases
// (src/client/stage/lyrics/springs.test.ts): the same path at any frame rate, the settle times of
// the spec's table, a fine RK4 integration, no overshoot where ζ forbids it.

/// Runs a spring from `from` to 0 at `hz` for `ms`.
private func run(_ p: SpringParams, hz: Double, ms: Double, from: Double = 1) -> LyricSpring {
    var s = LyricSpring(from)
    let dt = 1000 / hz
    var t = 0.0
    while t + 1e-9 < ms {
        s.step(to: 0, p, dtMs: min(dt, ms - t))
        t += dt
    }
    return s
}

/// Time until |x| stays below 2% (sampled at 1 kHz), seconds.
private func settle(_ p: SpringParams) -> Double {
    var s = LyricSpring(1)
    var last = 0
    for t in 1...5000 {
        s.step(to: 0, p, dtMs: 1)
        if abs(s.x) >= 0.02 { last = t }
    }
    return Double(last) / 1000
}

private let all: [(String, SpringParams)] = [
    ("normal (slow lines)", LyricSprings.lineNormal(800)), ("normal (fast lines)", LyricSprings.lineNormal(100)),
    ("slow", LyricSprings.slow), ("enter", LyricSprings.enter), ("lift", LyricSprings.lift),
    ("impulse", LyricSprings.impulse), ("overdamped", SpringParams(f: 2, zeta: 1.4)),
]

@Suite("Lyrics: springs")
struct LyricsSpringTests {
    @Test("The same path at 30, 60, 120 and 144 Hz")
    func frameRate() {
        for (name, p) in all {
            for ms in [150.0, 400, 1000] {
                let ref = run(p, hz: 1000, ms: ms)
                for hz in [30.0, 60, 120, 144] {
                    let s = run(p, hz: hz, ms: ms)
                    #expect(abs(s.x - ref.x) < 5e-10, "\(name) at \(hz) Hz, \(ms) ms")
                    #expect(abs(s.v - ref.v) < 5e-8, "\(name) at \(hz) Hz, \(ms) ms")
                }
            }
        }
    }

    @Test("Converges to the target and stays bounded")
    func converges() {
        for (name, p) in all {
            #expect(abs(run(p, hz: 60, ms: 4000).x) < 1e-3, "\(name)")
            for ms in stride(from: 0.0, to: 2000, by: 50) {
                #expect(abs(run(p, hz: 60, ms: ms).x) <= 1, "\(name) at \(ms) ms")
            }
        }
    }

    @Test("Settle times (2%) of the spec's table")
    func settleTimes() {
        let rows: [(String, SpringParams, Double)] = [
            ("line.normal at 2.0 Hz", LyricSprings.lineNormal(800), 0.46),
            ("line.normal at 2.35 Hz", LyricSprings.lineNormal(100), 0.39),
            ("line.slow", LyricSprings.slow, 0.64), ("line.enter", LyricSprings.enter, 0.76),
        ]
        for (name, p, s) in rows {
            #expect(abs(settle(p) - s) < 0.05, "\(name): \(settle(p)) s")
        }
    }

    @Test("Matches a fine RK4 integration of x″ = −ω²x − 2ζωx′")
    func rk4() {
        for (name, p) in all {
            let w = 2 * Double.pi * p.f
            func acc(_ x: Double, _ v: Double) -> Double { -w * w * x - 2 * p.zeta * w * v }
            var x = 1.0
            var v = 0.0
            let h = 1e-5
            for _ in 0..<Int((0.3 / h).rounded()) {
                let (ax, av) = (v, acc(x, v))
                let (bx, bv) = (v + h / 2 * av, acc(x + h / 2 * ax, v + h / 2 * av))
                let (cx, cv) = (v + h / 2 * bv, acc(x + h / 2 * bx, v + h / 2 * bv))
                let (dx, dv) = (v + h * cv, acc(x + h * cx, v + h * cv))
                x += h / 6 * (ax + 2 * bx + 2 * cx + dx)
                v += h / 6 * (av + 2 * bv + 2 * cv + dv)
            }
            let s = run(p, hz: 60, ms: 300)
            #expect(abs(s.x - x) < 5e-6, "\(name)")
            #expect(abs(s.v - v) < 5e-4, "\(name)")
        }
    }

    @Test("Critically damped at 2.0 Hz covers ~90% of the way in 300 ms (the hand-over's lead)")
    func handoverLead() {
        #expect(1 - run(LyricSprings.lineNormal(800), hz: 60, ms: 300).x > 0.88)
    }

    @Test("No overshoot where ζ = 1; a little at ζ 0.95")
    func overshoot() {
        func lowest(_ p: SpringParams) -> Double {
            var m = 1.0
            for ms in stride(from: 0.0, to: 3000, by: 10) { m = min(m, run(p, hz: 100, ms: ms).x) }
            return m
        }
        #expect(lowest(LyricSprings.lineNormal(800)) > -1e-9)
        #expect(lowest(LyricSprings.slow) > -1e-9)
        #expect(lowest(LyricSprings.enter) < 0)
        #expect(lowest(LyricSprings.enter) > -0.02)
    }

    @Test("A step is at most 100 ms: a 10 s stall moves no further than one 100 ms step")
    func clamp() {
        let p = LyricSprings.lineNormal(800)
        var big = LyricSpring(1)
        big.step(to: 0, p, dtMs: 10_000)
        var one = LyricSpring(1)
        one.step(to: 0, p, dtMs: LyricSpring.maxDtMs)
        #expect(big == one)
        var none = LyricSpring(1)
        none.step(to: 0, p, dtMs: 0)
        none.step(to: 0, p, dtMs: -5)
        #expect(none == LyricSpring(1))
    }

    @Test("Velocity carries across a change of target; a snap is at rest")
    func velocity() {
        var s = LyricSpring(0)
        s.step(to: 1, LyricSprings.slow, dtMs: 100)
        let v = s.v
        s.step(to: 2, LyricSprings.slow, dtMs: 0.001)
        #expect(abs(s.v - v) < 0.5)
        s.snap(5)
        #expect(s == LyricSpring(5))
    }

    @Test("line.normal stiffens for fast lyrics: 2.35 Hz at 100 ms, 2.0 Hz from 800 ms")
    func lineNormal() {
        #expect(abs(LyricSprings.lineNormal(0).f - 2.35) < 1e-9)
        #expect(abs(LyricSprings.lineNormal(100).f - 2.35) < 1e-9)
        #expect(abs(LyricSprings.lineNormal(800).f - 2.0) < 1e-9)
        #expect(abs(LyricSprings.lineNormal(5000).f - 2.0) < 1e-9)
        #expect(LyricSprings.lineNormal(450).f > 2.0 && LyricSprings.lineNormal(450).f < 2.35)
        #expect(LyricSprings.lineNormal(450).zeta == 1)
        #expect(LyricSprings.lineNormal(.infinity).f == 2.0)
    }
}
