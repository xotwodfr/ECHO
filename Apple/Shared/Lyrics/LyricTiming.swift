import Foundation

// Time → who holds the anchor (LYRICS_EXPERIENCE.md §5.3, §9.8, §9.9;
// src/client/stage/lyrics/timing.ts): pure functions of the document and the song's time, read
// every frame; springs only smooth what they give (§6.2).

/// Who holds the active anchor from `from` until the next span: a line, or nobody (the intro, an
/// instrumental gap, the outro). `next` is the first line still to come (rank +1).
struct LyricSpan: Equatable, Sendable {
    var from: Double
    /// −1: no active line.
    var line: Int
    var next: Int
    /// The interlude dots show while the time is before this (−∞: none).
    var dotsUntil = -Double.infinity
}

/// Where the field is at a moment.
struct LyricFieldState: Equatable, Sendable {
    /// The line at the anchor (an index into the timeline's lines), −1 when none.
    var active: Int
    /// Rank +1 (`lines.count` once every line has started).
    var next: Int
    /// The next hand-over (∞ when none).
    var handoverAt: Double
    /// Progress through the active line or the gap, 0…1.
    var phase: Double
    /// The interlude dots (§9.8).
    var dots: Bool
    /// When this span began (a hand-over, or the end of the line before a gap).
    var from: Double
}

struct LyricTimeline: Sendable {
    /// The lines shown: empty and blank lines are gaps (§9.9).
    let lines: [LyricLine]
    /// Each line's end, derived when the source left it out (§9.2).
    let ends: [Double]
    /// When each line would take the anchor (§5.3), never decreasing.
    let handovers: [Double]
    /// Lines that never take the anchor (§9.9): they sweep at rank +1.
    let coalesced: [Int]
    let spans: [LyricSpan]

    init(_ doc: LyricsDoc) {
        let LT = LyricsConfig.LineTimed.self
        let HO = LyricsConfig.Handover.self
        let IL = LyricsConfig.Interlude.self
        func shown(_ l: LyricLine) -> Bool { !l.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if doc.sync == .plain {
            lines = doc.lines.filter(shown)
            ends = []
            handovers = []
            coalesced = []
            spans = [LyricSpan(from: 0, line: -1, next: 0)]
            return
        }
        // A line-synced line without an end ends 100 ms before the next timed line, empty ones too.
        let all = doc.lines
        var kept: [LyricLine] = []
        var keptEnds: [Double] = []
        for (i, l) in all.enumerated() {
            let fallback = i + 1 < all.count ? all[i + 1].start - LT.endGapMs : l.start + LT.lastLineMs
            let end = l.end ?? l.words?.last?.end ?? fallback
            if shown(l) {
                kept.append(l)
                keptEnds.append(end)
            }
        }
        lines = kept
        ends = keptEnds
        let n = kept.count
        guard n > 0 else {
            handovers = []
            coalesced = []
            spans = [LyricSpan(from: 0, line: -1, next: 0)]
            return
        }
        func start(_ i: Int) -> Double { kept[i].start }
        func end(_ i: Int) -> Double { keptEnds[i] }
        // The voice of a word-synced line stops at its last word, not at trailing backing vocals.
        func sungEnd(_ i: Int) -> Double { kept[i].words?.last?.end ?? end(i) }

        var h: [Double] = []
        for i in 0..<n {
            let lead = i == 0 ? HO.leadMaxMs : lyricClamp(start(i) - sungEnd(i - 1), HO.leadMinMs, HO.leadMaxMs)
            h.append(max(start(i) - lead, h.last ?? -Double.infinity))
        }
        handovers = h

        func isGap(_ i: Int) -> Bool { start(i) - (i == 0 ? 0 : end(i - 1)) >= IL.minGapMs }
        // A line whose hand-over is followed by the next one within 350 ms never takes the anchor:
        // the field advances two ranks at the later hand-over, so no line is active under 350 ms.
        var c: [Int] = []
        for i in 0..<(n - 1) where h[i + 1] - h[i] < HO.coalesceMs { c.append(i) }
        coalesced = c
        let skipped = Set(c)

        var s = [LyricSpan(from: 0, line: -1, next: 0)]
        if isGap(0) { s[0].dotsUntil = h[0] - IL.leaveMs }
        for i in 0..<n {
            if i > 0, isGap(i) { s.append(LyricSpan(from: end(i - 1), line: -1, next: i, dotsUntil: h[i] - IL.leaveMs)) }
            if !skipped.contains(i) { s.append(LyricSpan(from: h[i], line: i, next: i + 1)) }
        }
        s.append(LyricSpan(from: max(end(n - 1), h[n - 1]), line: -1, next: n))
        spans = s
    }

    func field(at t: Double) -> LyricFieldState {
        var i = 0
        while i + 1 < spans.count, spans[i + 1].from <= t { i += 1 }
        let s = spans[i]
        let handoverAt = i + 1 < spans.count ? spans[i + 1].from : Double.infinity
        let from = s.line >= 0 ? lines[s.line].start : s.from
        let span = handoverAt - from
        let phase = handoverAt == .infinity ? 0 : span > 0 ? lyricClamp((t - from) / span, 0, 1) : 1
        return LyricFieldState(
            active: s.line, next: s.next, handoverAt: handoverAt, phase: phase, dots: t < s.dotsUntil, from: s.from)
    }

    func activeIndex(at t: Double) -> Int { field(at: t).active }

    /// Line `j`'s rank (§2): 0 active, +1… upcoming, −1… past.
    static func rank(_ s: LyricFieldState, _ j: Int) -> Int {
        j >= s.next || s.active >= 0 ? j - s.next + 1 : j - s.next
    }
}
