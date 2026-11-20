import Foundation
import Testing

// Frame simulations of the lyric field (LYRICS_EXPERIENCE.md §4–§10) at the web tests' stage
// (1440 × 812, 56 pt type, nominal boxes), against the web's own cases
// (src/client/stage/lyrics/model.test.ts). The apps analyse no audio, so these run without features
// (g 0.6, no beat terms), as the spec has it.

private let W = LyricStage.W
private let H = LyricStage.H
private let frame = LyricStage.frame

@Suite("Lyrics: the field")
struct LyricsFieldTests {
    // MARK: The active line (LYR-02)

    @Test("The active line settles at 0.40 H ± 2 pt and stays still while active", arguments: ["ballad-word", "pop-line"])
    func anchor(_ name: String) {
        let m = lyricModel(name)
        var since: [Int: Double] = [:]
        var checked = 0
        m.play(from: 0, to: 120_000) { t in
            var next: [Int: Double] = [:]
            for inst in m.insts.values where inst.role == .zone && inst.rank == 0 {
                next[inst.i] = since[inst.i] ?? t
            }
            since = next
            for (i, from) in since where t - from >= 800 {
                // Still arriving: 2 pt of a slow hand-over (ζ 1) takes up to 0.8 s.
                #expect(abs((m.insts[i]?.y.x ?? 0) - LyricStage.y0) <= 2, "\(name) line \(i) at \(t)")
                checked += 1
            }
        }
        #expect(checked > 500)
    }

    // MARK: The column (LYR-03)

    @Test("Each line one gap below the one before, on the column's edge, dimmer and blurrier with distance", arguments: ["ballad-word", "duet-word"])
    func column(_ name: String) {
        let m = lyricModel(name)
        var checked = 0
        m.play(from: 0, to: 110_000) { _ in
            let ls = m.ordered
            // Settled frames only: a hand-over's springs carry every line a little behind its target.
            guard ls.count >= 3, ls.allSatisfy({ abs($0.y.x - $0.ty) <= 0.25 }) else { return }
            for k in 1..<ls.count {
                let (u, v) = (ls[k - 1], ls[k])
                #expect(v.i == u.i + 1) // the column skips no line
                let gap = v.y.x - m.boxes[v.i].h / 2 - (u.y.x + m.boxes[u.i].h / 2)
                // One gap, or the dots' empty slot between the last sung line and the next.
                let dots = u.rank < 0 && v.rank > 0
                #expect(abs(gap - (dots ? 2 * LyricStage.gap + LyricStage.row : LyricStage.gap)) < 0.5)
            }
            for v in ls {
                let b = m.boxes[v.i]
                if b.side == .right {
                    #expect(abs(v.x.x + b.w / 2 - (1 + LyricsConfig.maxWidth) / 2 * W) < 1e-6)
                } else {
                    #expect(abs(v.x.x - b.w / 2 - (1 - LyricsConfig.maxWidth) / 2 * W) < 1e-6)
                }
                #expect(abs(v.tz - min(1, Double(abs(v.rank)) * LyricsConfig.Column.dz)) < 1e-9)
                #expect(abs(v.blur - LyricFieldModel.blur(at: v.z.x)) < 1e-9)
                #expect(v.opacity <= LyricFieldModel.opacity(at: v.z.x) + 1e-9) // and fading in when new
            }
            checked += 1
        }
        #expect(checked > 300)
    }

    @Test("Scrolls without two lines ever overlapping, lines entering included", arguments: ["ballad-word", "rap-word"])
    func noOverlap(_ name: String) {
        let m = lyricModel(name)
        var checked = 0
        m.play(from: 0, to: 160_000) { _ in
            let ls = m.ordered
            for k in ls.indices.dropFirst() {
                let (u, v) = (ls[k - 1], ls[k])
                #expect(v.y.x - m.boxes[v.i].h / 2 > u.y.x + m.boxes[u.i].h / 2)
                checked += 1
            }
        }
        #expect(checked > 10_000)
    }

    @Test("Dims and blurs with distance; the active line clear and whole")
    func distance() {
        #expect(LyricFieldModel.opacity(at: 0) == 1 && LyricFieldModel.blur(at: 0) == 0)
        var z = 0.0
        while z < 1 {
            #expect(LyricFieldModel.opacity(at: z + 0.01) <= LyricFieldModel.opacity(at: z))
            #expect(LyricFieldModel.blur(at: z + 0.01) >= LyricFieldModel.blur(at: z))
            z += 0.01
        }
    }

    @Test("Ballad mid-song: the column runs past both ends of the stage, sung lines above")
    func columnLength() {
        let m = lyricModel("ballad-word")
        m.play(from: 0, to: 60_000)
        let ls = m.ordered
        let top = ls.map { $0.y.x - m.boxes[$0.i].h / 2 }.min() ?? 0
        let bottom = ls.map { $0.y.x + m.boxes[$0.i].h / 2 }.max() ?? 0
        #expect(top < 0)
        #expect(bottom > H)
        let past = ls.filter { $0.role == .past }
        #expect(past.count >= 3)
        #expect(past.allSatisfy { $0.y.x < LyricStage.y0 })
    }

    // MARK: Hand-overs (LYR-06, §6.3)

    @Test("No line in sight jumps more than 0.08 H between frames", arguments: ["ballad-word", "rap-word", "duet-word"])
    func noJumps(_ name: String) {
        let m = lyricModel(name)
        var last: [Int: (x: Double, y: Double, o: Double)] = [:]
        var worst = 0.0
        m.play(from: 0, to: 160_000) { _ in
            var now: [Int: (x: Double, y: Double, o: Double)] = [:]
            for v in m.insts.values {
                now[v.serial] = (v.x.x, v.y.x, v.opacity)
                guard let u = last[v.serial], u.o >= 0.01 || v.opacity >= 0.01 else { continue }
                worst = max(worst, hypot(v.x.x - u.x, v.y.x - u.y))
            }
            last = now
        }
        #expect(worst < 0.08 * H)
    }

    @Test("At 30, 60 and 144 Hz the same motion as at 1 kHz (closed-form springs)")
    func frameRates() {
        let ref = lyricModel("ballad-word")
        var refAt: [Int: [Int: Double]] = [:]
        ref.play(from: 9000, to: 12_000, hz: 1000) { t in
            refAt[Int(t.rounded())] = Dictionary(uniqueKeysWithValues: ref.insts.map { ($0.key, $0.value.y.x) })
        }
        for hz in [30.0, 60, 144] {
            let m = lyricModel("ballad-word")
            var lastT = 0.0
            m.play(from: 9000, to: 12_000, hz: hz) { t in lastT = t }
            guard let want = refAt[Int(lastT.rounded())] else {
                Issue.record("no reference frame at \(lastT)")
                continue
            }
            for (i, v) in m.insts {
                guard let y = want[i] else { continue }
                #expect(abs(v.y.x - y) < 0.5, "\(hz) Hz, line \(i)")
            }
        }
    }

    @Test("Staggers new targets: the new active at once, +1 50 ms later, +3 ≈ 143 ms later")
    func stagger() throws {
        let m = lyricModel("ballad-word")
        let h = m.tl.handovers[3] // line 3 takes the anchor
        m.play(from: h - 2000, to: h - 1)
        func ty(_ i: Int) -> Double { m.insts[i]?.ty ?? .nan }
        let (t3, t4, t6) = (ty(3), ty(4), ty(6))
        var t = h - 1
        func step(_ ms: Double) {
            t += ms
            m.step(t, dt: ms)
        }
        step(2)
        #expect(ty(3) != t3)
        #expect(ty(4) == t4)
        #expect(m.insts[6]?.role == .zone)
        step(40)
        #expect(ty(4) == t4)
        step(12)
        #expect(ty(4) != t4)
        #expect(ty(6) == t6)
        step(95)
        #expect(ty(6) != t6)
    }

    // MARK: The sweep and the glow (LYR-07, LYR-08)

    @Test("The sweep follows time inside the word: before it 0, after it 1", arguments: ["ballad-word", "rap-word", "cjk-word"])
    func sweep(_ name: String) {
        let m = lyricModel(name)
        var inside = 0
        m.play(from: 0, to: 90_000) { t in
            for v in m.insts.values where v.rank == 0 && v.role == .zone {
                for (k, w) in (m.lines[v.i].words ?? []).enumerated() {
                    let p = v.p[k]
                    if t <= w.start {
                        #expect(p == 0)
                    } else if t >= w.end {
                        #expect(p == 1)
                    } else {
                        let want = min(1, (t - w.start) / max(60, w.end - w.start))
                        #expect(abs(p - want) <= 0.01)
                        inside += 1
                    }
                }
            }
        }
        #expect(inside > 200)
    }

    @Test("The glow only on the word being sung and the one fading after it, within the caps", arguments: ["ballad-word", "rap-word", "duet-word"])
    func glow(_ name: String) {
        let m = lyricModel(name)
        var lit = 0
        var prev: [Int: [Double]] = [:]
        m.play(from: 0, to: 90_000) { t in
            var next: [Int: [Double]] = [:]
            for v in m.insts.values {
                next[v.serial] = v.glow
                let glowing = v.glow.indices.filter { v.glow[$0] > 0 }
                // A line that has just left the anchor keeps only the tail of its last glow, fading.
                if v.rank != 0 && v.rank != 1 {
                    for k in glowing { #expect(v.glow[k] < (prev[v.serial]?[k] ?? 0)) }
                }
                #expect(glowing.count <= 2)
                let words = m.lines[v.i].words ?? []
                let sweeping = words.firstIndex { t >= $0.start && t < $0.end } ?? -1
                for k in glowing {
                    #expect(v.glow[k] <= LyricsConfig.Glow.alphaMax + 1e-9)
                    // The sweeping word, or an earlier one whose glow is fading.
                    #expect(sweeping < 0 || k <= sweeping)
                    if k == sweeping { lit += 1 }
                }
            }
            prev = next
        }
        #expect(lit > 100)
    }

    @Test("The glow's alpha changes no faster than 1.5/s (§12.5)", arguments: ["ballad-word", "rap-word"])
    func slew(_ name: String) {
        let m = lyricModel(name)
        var prev: [Int: [Double]] = [:]
        var worst = 0.0
        m.play(from: 0, to: 60_000) { _ in
            var next: [Int: [Double]] = [:]
            for v in m.insts.values {
                next[v.serial] = v.glow
                guard let u = prev[v.serial] else { continue }
                for (k, a) in v.glow.enumerated() where k < u.count { worst = max(worst, abs(a - u[k])) }
            }
            prev = next
        }
        #expect(worst <= 1.5 * frame / 1000 + 1e-9)
        #expect(worst > 0.02) // the limit is what shapes the rise
    }

    @Test("Paused, the glow dims to 60% over 600 ms; playing again, it comes back within 300 ms (LYR-17)")
    func pauseDims() throws {
        let m = lyricModel("ballad-word")
        let w = try #require(m.lines.flatMap { $0.words ?? [] }.first { $0.end - $0.start >= 1400 })
        let t = w.start + 600
        m.play(from: t - 1500, to: t)
        let i = try #require(m.insts.values.first { $0.rank == 0 }?.i)
        func glow() -> Double { m.insts[i]?.glow.max() ?? 0 }
        #expect(abs(glow() - LyricsConfig.Glow.alpha) < 0.005)
        for _ in 0..<36 { m.step(t, playing: false) }
        #expect(abs(glow() - LyricsConfig.Glow.alpha * 0.6) < 0.005)
        for k in 0..<18 { m.step(t + Double(k) * frame) }
        #expect(abs(glow() - LyricsConfig.Glow.alpha) < 0.005)
    }

    // MARK: Sung lines (LYR-10)

    @Test("Sung lines stay above, their lit colour dying into ink by e^(−Δt/520 ms)", arguments: ["ballad-word", "pop-line"])
    func pastLines(_ name: String) {
        let m = lyricModel(name)
        var checked = 0
        m.play(from: 20_000, to: 100_000) { t in
            for v in m.insts.values where v.role == .past {
                let dt = t - m.leftAt[v.i]
                #expect(dt >= 0)
                #expect(abs(v.fade - (1 - exp(-dt / LyricsConfig.Decay.tauMs))) < 1e-9)
                #expect(v.rank < 0)
                checked += 1
            }
        }
        #expect(checked > 1000)
    }

    // MARK: Pacing (LYR-20, LYR-21)

    @Test("Rap: no line is active under 350 ms, and the coalesced lines still sweep")
    func pacing() {
        let m = lyricModel("rap-word")
        #expect(!m.tl.coalesced.isEmpty)
        var dwell: [Int: Double] = [:]
        // A coalesced line's sweep in the first frame past the middle of each of its words.
        var mid: [String: Double] = [:]
        let words = Dictionary(uniqueKeysWithValues: m.tl.coalesced.map { ($0, m.lines[$0].words ?? []) })
        m.play(from: 0, to: 170_000) { t in
            for v in m.insts.values where v.role == .zone && v.rank == 0 { dwell[v.i, default: 0] += frame }
            for (c, ws) in words {
                for (k, w) in ws.enumerated() where t >= (w.start + w.end) / 2 && mid["\(c) \(k)"] == nil {
                    mid["\(c) \(k)"] = m.insts[c].map { k < $0.p.count ? $0.p[k] : -1 } ?? -1
                }
            }
        }
        for (i, ms) in dwell { #expect(ms >= 350 - frame, "line \(i)") }
        for c in m.tl.coalesced {
            #expect(dwell[c] == nil)
            for k in (words[c] ?? []).indices {
                let p = mid["\(c) \(k)"] ?? -1
                #expect(p > 0 && p < 1, "line \(c) word \(k): \(p)")
            }
        }
    }

    @Test("The dots only in gaps of 7 s or more, gone 250 ms before the hand-over", arguments: ["intro-outro", "ballad-word"])
    func dots(_ name: String) {
        let m = lyricModel(name)
        let tl = m.tl
        let gaps = tl.spans.filter { $0.dotsUntil > -.infinity }
        #expect(!gaps.isEmpty)
        m.play(from: 0, to: 200_000) { t in
            let gap = gaps.first { t >= $0.from && t < ($0.next < tl.handovers.count ? tl.handovers[$0.next] : .infinity) }
            guard let gap else {
                #expect(m.dots.opacity == 0, "\(name) at \(t)")
                return
            }
            let h = gap.next < tl.handovers.count ? tl.handovers[gap.next] : .infinity
            if t >= h - LyricsConfig.Interlude.leaveMs + LyricsConfig.Interlude.fadeMs { #expect(m.dots.opacity == 0) }
            if t > gap.from + 750, t < gap.dotsUntil { #expect(m.dots.opacity == 1) }
        }
    }

    // MARK: Seek, scrub and still frames (§9.6)

    @Test("A seek: the slow spring, no stagger; old sung lines fade out in 160 ms; settled in 900 ms")
    func seek() throws {
        let m = lyricModel("ballad-word")
        m.play(from: 40_000, to: 45_000)
        let old = Set(m.insts.values.filter { $0.role == .past }.map(\.i))
        #expect(!old.isEmpty)
        m.step(90_000)
        #expect(m.insts.values.allSatisfy { $0.delay == 0 })
        #expect(old.isSubset(of: Set(m.leaving.map(\.i))))
        #expect(m.insts.values.allSatisfy { $0.params == LyricSprings.slow })
        let fading = m.leaving.filter { old.contains($0.i) }
        let from = fading.map(\.opacity)
        var t = 90_000.0
        for _ in 0..<10 {
            t += frame
            m.step(t)
        }
        #expect(m.leaving.filter { old.contains($0.i) }.isEmpty)
        for (k, x) in fading.enumerated() { #expect(x.opacity < from[k] * 0.2) }
        for _ in 0..<45 {
            t += frame
            m.step(t)
        }
        let a = try #require(m.insts.values.first { $0.role == .zone && $0.rank == 0 })
        #expect(abs(a.y.x - LyricStage.y0) < 2)
    }

    @Test("A short seek (one line on): the lines that stay change rank on the slow spring, unstaggered")
    func shortSeek() {
        let m = lyricModel("ballad-word")
        let h = m.tl.handovers
        m.play(from: h[4] - 2000, to: h[4] - 1500)
        let kept = [5, 6, 7].compactMap { m.insts[$0] }
        #expect(kept.count == 3)
        m.step(h[5] + 200)
        for v in kept {
            #expect(m.insts[v.i] === v) // the same instance, a new rank
            #expect(v.params == LyricSprings.slow)
            #expect(v.delay == 0)
        }
        #expect(kept.first?.rank == 0)
    }

    @Test("Scrubbing: every line sits exactly on its target, frame by frame")
    func scrub() {
        let m = lyricModel("ballad-word")
        var t = 20_000.0
        while t < 60_000 {
            m.step(t, playing: false, mode: .scrub)
            for v in m.insts.values {
                #expect(v.y.x == v.ty)
                #expect(v.z.x == v.tz)
            }
            t += 731
        }
    }

    @Test("A still frame at t is settled and the same every time")
    func still() throws {
        func once() -> [Int: [Double]] {
            let m = lyricModel("ballad-word")
            m.step(60_000, dt: 0, playing: false, mode: .still)
            return Dictionary(uniqueKeysWithValues: m.insts.map { ($0.key, [$0.value.x.x, $0.value.y.x, $0.value.opacity, $0.value.blur] + $0.value.p + $0.value.glow) })
        }
        let a = once()
        #expect(a == once())
        let m = lyricModel("ballad-word")
        m.step(60_000, dt: 0, playing: false, mode: .still)
        let active = try #require(m.insts.values.first { $0.role == .zone && $0.rank == 0 })
        #expect(abs(active.y.x - LyricStage.y0) < 1e-9)
        #expect(active.opacity == 1)
    }

    // MARK: Reduced motion (§10, A11Y-05)

    @Test("Reduced motion: slots are static, no travel, no pulse, words at rest")
    func reducedSlots() {
        let m = lyricModel("pop-line")
        var activeZ: Set<Double> = []
        m.play(from: 0, to: 90_000, reduced: true) { _ in
            for v in m.insts.values {
                #expect(v.y.x == v.ty) // placed at the slot, never travelling to it
                #expect(v.z.x == v.tz)
                #expect(v.scale == 1)
                if v.role == .zone && v.rank == 0 { activeZ.insert(v.z.x) }
            }
        }
        #expect(activeZ.count == 1)
        for inst in m.insts.values {
            #expect(inst.wy.allSatisfy { $0 == 0 })
            #expect(inst.ws.allSatisfy { $0 == 1 })
        }
    }

    @Test("Reduced motion: a hand-over is a crossfade in place over 180 ms")
    func reducedCrossfade() {
        let m = lyricModel("pop-line")
        let steps = Int((LyricsConfig.Reduced.crossfadeMs / frame).rounded(.up))
        // Each line that takes the anchor: from that frame its opacity rises at a fixed rate to its
        // slot's in about 180 ms, never past it, at a place it never travels to.
        var watching: [Int: (left: Int, ys: Double)] = [:]
        var wasRank: [Int: Int] = [:]
        var checked = 0
        m.play(from: 0, to: 60_000, reduced: true) { _ in
            for v in m.insts.values {
                let target = LyricFieldModel.opacity(at: v.z.x)
                if v.role == .zone, v.rank == 0, let r = wasRank[v.serial], r > 0 {
                    watching[v.serial] = (steps + 2, v.y.x)
                    #expect(v.y.x == v.ty)
                }
                if let w = watching[v.serial] {
                    #expect(v.opacity <= target + 1e-9)
                    #expect(v.y.x == w.ys)
                    if w.left == 0 {
                        if v.rank == 0 {
                            #expect(abs(v.opacity - target) < 0.005)
                            checked += 1
                        }
                        watching[v.serial] = nil
                    } else {
                        watching[v.serial] = (w.left - 1, w.ys)
                    }
                }
                wasRank[v.serial] = v.rank
            }
        }
        #expect(checked > 10)
    }

    @Test("Reduced motion: a constant glow on the word being sung, no emphasis, still interlude dots")
    func reducedGlow() {
        let m = lyricModel("accents-word")
        var glowed = 0
        m.play(from: 0, to: 60_000, reduced: true) { _ in
            for v in m.insts.values {
                glowed += v.glow.filter { $0 > 0 }.count
                #expect(v.emph.allSatisfy { row in row.allSatisfy { $0.x == 0 } })
                #expect(v.glowR == LyricsConfig.Glow.radius)
                #expect(v.glow.allSatisfy { $0 <= LyricsConfig.Glow.alpha + 1e-9 })
            }
            if m.dots.opacity > 0 {
                #expect(m.dots.scale == [1, 1, 1])
                #expect(m.dots.alpha == [0.6, 0.6, 0.6])
            }
        }
        #expect(glowed > 100)
    }

    @Test("Reduced motion: the word sweep still runs (it carries timing, not motion)")
    func reducedSweep() {
        let m = lyricModel("ballad-word")
        var swept = false
        m.play(from: 0, to: 20_000, reduced: true) { _ in
            if m.insts.values.contains(where: { $0.p.contains { $0 > 0 && $0 < 1 } }) { swept = true }
        }
        #expect(swept)
    }

    // MARK: The sweep along the line (§5.1)

    private static let words = [
        LyricWord(text: "x", start: 0, end: 400), LyricWord(text: "x", start: 400, end: 800),
        LyricWord(text: "x", start: 1500, end: 2000), // a 700 ms hold before the third
    ]
    private static let widths = [100.0, 50, 100]

    @Test("One edge crosses the words in their time: behind it past 1, ahead below 0")
    func oneEdge() {
        let e = LyricFieldModel.lineEdges(Self.words, Self.widths, 300)
        #expect(abs(e[0] - 0.75) < 1e-9) // the edge, 75% through the first word
        #expect(abs(e[1] + 0.5) < 1e-9) // 25 pt before the second: its fade may already touch it
        #expect(e[2] < -1000) // across the hold: not lit early
        let f = LyricFieldModel.lineEdges(Self.words, Self.widths, 500)
        #expect(abs(f[0] - 1.125) < 1e-9) // 12.5 pt past its end: the trailing fade still on it
        #expect(abs(f[1] - 0.25) < 1e-9)
    }

    @Test("At a hold the edge rests, and the last word's fade clears on its own")
    func hold() {
        func at(_ t: Double) -> [Double] { LyricFieldModel.lineEdges(Self.words, Self.widths, t) }
        #expect(abs(at(800)[1] - 1) < 1e-9)
        #expect(at(1050)[1] >= 5)
        #expect(at(1000)[2] < -1000)
        #expect(abs(at(1750)[2] - 0.5) < 1e-9)
        #expect(at(2300)[2] >= 5)
        #expect(at(-10).allSatisfy { $0 < -1000 }) // before the line, every word unreached
    }

    // MARK: Seeking

    @Test("Seeking back and forward mid-line moves every line continuously")
    func seeking() {
        let m = lyricModel("ballad-word")
        let tl = m.tl
        func mid(_ j: Int) -> Double { (tl.lines[j].start + tl.ends[j]) / 2 }
        var last: [Int: (x: Double, y: Double, o: Double)] = [:]
        func check(_ t: Double) {
            var now: [Int: (x: Double, y: Double, o: Double)] = [:]
            for v in m.insts.values {
                now[v.serial] = (v.x.x, v.y.x, v.opacity)
                guard let u = last[v.serial], v.opacity >= 0.01, u.o >= 0.01 else { continue }
                #expect(abs(v.y.x - u.y) < 0.08 * H, "at \(t)")
                #expect(abs(v.x.x - u.x) < 0.08 * W, "at \(t)")
            }
            last = now
        }
        m.play(from: 0, to: mid(4), check)
        m.play(from: mid(1), to: mid(1) + 3000, check) // back
        m.play(from: mid(6), to: mid(6) + 3000, check) // forward
    }

    // MARK: Word lift and swell (§5.1)

    @Test("The word being sung is the largest; unsung and sung words sit at scale 1")
    func wordMotion() {
        let WM = LyricsConfig.Word.self
        let w = LyricWord(text: "light", start: 1000, end: 1600)
        let rest = LyricFieldModel.wordMotion(w, 0, emphasised: false)
        #expect(rest.y == WM.liftEm && rest.s == 1)
        #expect(abs(LyricFieldModel.wordMotion(w, w.start + WM.popMs, emphasised: false).s - WM.peak) < 1e-6)
        #expect(abs(LyricFieldModel.wordMotion(w, w.end, emphasised: false).s - WM.peak) < 1e-6)
        #expect(LyricFieldModel.wordMotion(w, w.end + WM.releaseMs, emphasised: false).s == 1)
        let after = LyricFieldModel.wordMotion(w, 99_000, emphasised: false)
        #expect(after.y == 0 && after.s == 1)
        // Continuous in time, so the frame loop never steps it.
        var t = 900.0
        while t < 2800 {
            let a = LyricFieldModel.wordMotion(w, t, emphasised: false)
            let b = LyricFieldModel.wordMotion(w, t + 1, emphasised: false)
            #expect(abs(b.s - a.s) < 0.002 && abs(b.y - a.y) < 0.001)
            t += 1
        }
        // Held words swell per letter instead (§5.5): the word itself stays at 1.
        var u = 0.0
        while u < 3000 {
            #expect(LyricFieldModel.wordMotion(w, u, emphasised: true).s == 1)
            u += 10
        }
    }

    @Test("The stagger by rank: 0, 50, ≈ 98, ≈ 143 ms")
    func staggerTable() {
        #expect(LyricFieldModel.staggerMs(-1) == 0)
        #expect(LyricFieldModel.staggerMs(0) == 0)
        #expect(abs(LyricFieldModel.staggerMs(1) - 50) < 1e-9)
        #expect(abs(LyricFieldModel.staggerMs(2) - (50 + 50 / 1.05)) < 1e-9)
        #expect(abs(LyricFieldModel.staggerMs(3) - 142.97) < 0.01)
    }
}
