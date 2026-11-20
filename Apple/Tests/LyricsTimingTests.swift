import Foundation
import Testing

// Time → who holds the anchor (LYRICS_EXPERIENCE.md §5.3, §9.8, §9.9), against the web's own cases
// (src/client/stage/lyrics/timing.test.ts): a hand-computed table, and every timed fixture checked
// against the spec's formulas written out directly (LYR-01, LYR-20, LYR-21).

private func docOf(_ lines: [LyricLine], sync: LyricSync = .word) -> LyricsDoc {
    LyricsDoc(trackKey: "test:t", sync: sync, source: "fixture", attribution: LyricsAttribution(text: ""), lines: lines)
}

private func one(_ start: Double, _ end: Double) -> LyricLine {
    LyricLine(text: "x", start: start, end: end, words: [LyricWord(text: "x", start: start, end: end)])
}

/// The spec's formulas, written out: the latest event at or before `t` decides who holds the anchor.
private func expected(_ lines: [LyricLine], _ ends: [Double], _ t: Double) -> (active: Int, next: Int, h: [Double]) {
    let HO = LyricsConfig.Handover.self
    func sung(_ i: Int) -> Double { lines[i].words?.last?.end ?? ends[i] }
    let h = lines.indices.map { i -> Double in
        i == 0
            ? lines[i].start - HO.leadMaxMs
            : lines[i].start - min(HO.leadMaxMs, max(HO.leadMinMs, lines[i].start - sung(i - 1)))
    }
    func coalesced(_ i: Int) -> Bool { i < lines.count - 1 && h[i + 1] - h[i] < HO.coalesceMs }
    func gapBefore(_ i: Int) -> Bool {
        lines[i].start - (i == 0 ? 0 : ends[i - 1]) >= LyricsConfig.Interlude.minGapMs
    }
    var active = -1
    var next = 0
    var at = -Double.infinity
    func event(_ time: Double, _ a: Int, _ n: Int) {
        if time <= t, time >= at {
            at = time
            active = a
            next = n
        }
    }
    for i in lines.indices {
        if i > 0, gapBefore(i) { event(ends[i - 1], -1, i) }
        if !coalesced(i) { event(h[i], i, i + 1) }
    }
    event(ends[ends.count - 1], -1, lines.count)
    return (active, next, h)
}

@Suite("Lyrics: timing")
struct LyricsTimingTests {
    // 0: an 8 s intro (dots) · 1: 500 ms after 0 · 2: a 100 ms line 60 ms before 3 (coalesced) ·
    // 4: after an 8 s gap (dots) · then the outro.
    let tl = LyricTimeline(docOf([one(8000, 9000), one(9500, 10500), one(10600, 10700), one(10760, 12000), one(20000, 21000)]))

    @Test("Hand-overs and coalescing, from §5.3 and §9.9")
    func handovers() {
        #expect(tl.handovers == [7700, 9200, 10480, 10640, 19700])
        #expect(tl.coalesced == [2])
    }

    @Test("Who holds the anchor at each moment of the hand-computed table")
    func table() {
        let rows: [(t: Double, active: Int, next: Int, dots: Bool, at: Double)] = [
            (0, -1, 0, true, 7700), (7199, -1, 0, true, 7700), (7200, -1, 0, false, 7700), (7700, 0, 1, false, 9200),
            (9200, 1, 2, false, 10640), (10600, 1, 2, false, 10640), (10640, 3, 4, false, 12000),
            (12000, -1, 4, true, 19700), (19199, -1, 4, true, 19700), (19200, -1, 4, false, 19700),
            (19700, 4, 5, false, 21000), (30000, -1, 5, false, .infinity),
        ]
        for r in rows {
            let s = tl.field(at: r.t)
            #expect(s.active == r.active, "t = \(r.t)")
            #expect(s.next == r.next, "t = \(r.t)")
            #expect(s.dots == r.dots, "t = \(r.t)")
            #expect(s.handoverAt == r.at, "t = \(r.t)")
        }
    }

    @Test("Ranks shift with the field; a coalesced line sweeps at +1, then −1")
    func ranks() {
        func at(_ t: Double) -> [Int] { tl.lines.indices.map { LyricTimeline.rank(tl.field(at: t), $0) } }
        #expect(at(9500) == [-1, 0, 1, 2, 3])
        #expect(at(10650) == [-3, -2, -1, 0, 1])
        #expect(at(15000) == [-4, -3, -2, -1, 1]) // a gap: nobody at rank 0
        #expect(at(0) == [1, 2, 3, 4, 5])
    }

    @Test("The phase runs from the active line's start to the next hand-over, or across a gap")
    func phase() {
        #expect(tl.field(at: 7800).phase == 0) // before the line starts
        #expect(abs(tl.field(at: 8600).phase - 0.5) < 1e-9)
        #expect(abs(tl.field(at: 15_850).phase - 0.5) < 1e-9)
    }

    @Test("Hand-overs under 350 ms apart coalesce; exactly 350 ms apart do not")
    func coalescing() {
        // Hand-overs at 700 and 1000 (a 120 ms lead after a 70 ms gap): 300 ms apart.
        #expect(LyricTimeline(docOf([one(1000, 1050), one(1120, 2000)])).coalesced == [0])
        // 700 and 1050: 350 ms apart.
        #expect(LyricTimeline(docOf([one(1000, 1050), one(1170, 2000)])).coalesced == [])
    }

    @Test("Line-synced ends: a missing end is the next line's start − 100 ms, the last line's + 6 s")
    func lineEnds() {
        let lt = LyricTimeline(docOf(
            [
                LyricLine(text: "a", start: 1000), LyricLine(text: "b", start: 3000, end: 3500),
                LyricLine(text: " ", start: 5000), LyricLine(text: "c", start: 6000),
            ],
            sync: .line))
        #expect(lt.lines.map(\.text) == ["a", "b", "c"])
        #expect(lt.ends == [2900, 3500, 12_000])
        #expect(lt.handovers == [700, 2880, 5700]) // the lead from the previous end, 120…300 ms
    }

    @Test("Plain lyrics never advance")
    func plain() {
        let st = LyricTimeline(lyricFixture("static"))
        let s = st.field(at: 0)
        #expect(s.active == -1 && s.next == 0 && !s.dots)
        #expect(st.activeIndex(at: 60_000) == -1)
        #expect(st.lines.count == 8)
    }

    @Test("Each fixture: hand-overs, the anchor, rank +1 and the ranks as the formulas say", arguments: timedLyricFixtures)
    func fixture(_ name: String) {
        let doc = lyricFixture(name)
        let tl = LyricTimeline(doc)
        let duration = doc.durationMs ?? 0
        #expect(duration > 0)
        // Hand-overs follow §5.3 exactly (none needed reordering).
        #expect(tl.handovers == expected(tl.lines, tl.ends, 0).h)
        for k in 0..<50 {
            let t = ((Double(k) + 0.5) * duration / 50).rounded()
            let want = expected(tl.lines, tl.ends, t)
            let s = tl.field(at: t)
            #expect(s.active == want.active && s.next == want.next, "\(name) at \(t)")
            if s.active >= 0 { #expect(LyricTimeline.rank(s, s.active) == 0) }
            let ranks = tl.lines.indices.map { LyricTimeline.rank(s, $0) }
            #expect(ranks.filter { $0 == 0 }.count == (s.active >= 0 ? 1 : 0))
            #expect(ranks.indices.dropFirst().allSatisfy { ranks[$0] > ranks[$0 - 1] })
        }
        // No line holds the anchor for less than 350 ms (LYR-20).
        for (i, s) in tl.spans.enumerated() where i + 1 < tl.spans.count && s.line >= 0 && s.line < tl.lines.count - 1 {
            #expect(tl.spans[i + 1].from - s.from >= LyricsConfig.Handover.coalesceMs, "\(name) line \(s.line)")
        }
        // The dots show only in gaps of 7 s or more and leave 500 ms before the next hand-over (LYR-21).
        var t = 0.0
        while t < duration {
            let s = tl.field(at: t)
            if s.dots {
                #expect(s.active == -1)
                let prevEnd = s.next == 0 ? 0 : tl.ends[s.next - 1]
                #expect(tl.lines[s.next].start - prevEnd >= 7000)
                #expect(t < s.handoverAt - 500)
            }
            t += 100
        }
    }

    @Test("Ballad: the dots in the 9 s intro and the 12 s bridge only")
    func balladDots() throws {
        let tl = LyricTimeline(lyricFixture("ballad-word"))
        var gaps: [Int] = []
        var t = 0.0
        while t < 220_000 {
            let s = tl.field(at: t)
            if s.dots, !gaps.contains(s.next) { gaps.append(s.next) }
            t += 100
        }
        let bridge = try #require(tl.lines.firstIndex { $0.text.hasPrefix("Hold on") })
        #expect(gaps == [0, bridge])
        #expect(tl.field(at: 0).dots)
        #expect(!tl.field(at: tl.handovers[0] - 499).dots)
    }

    @Test("Rap: exactly the two interjections coalesce; they sweep at +1 or −1, never at the anchor")
    func rapCoalesces() {
        let tl = LyricTimeline(lyricFixture("rap-word"))
        #expect(tl.coalesced.map { tl.lines[$0].text } == ["Yo", "Go"])
        for i in tl.coalesced {
            for w in tl.lines[i].words ?? [] {
                var t = w.start
                while t < w.end {
                    #expect([1, -1].contains(LyricTimeline.rank(tl.field(at: t), i)))
                    t += 10
                }
            }
        }
    }

    @Test("Pop: the empty LRC line is a gap, never a line of the field")
    func emptyLine() {
        let doc = lyricFixture("pop-line")
        #expect(doc.lines.contains { $0.text.trimmingCharacters(in: .whitespaces).isEmpty })
        #expect(LyricTimeline(doc).lines.allSatisfy { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty })
    }
}
