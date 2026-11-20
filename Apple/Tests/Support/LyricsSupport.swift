import Foundation

// Stand-ins for the lyric tests: the web's lyric fixtures (Apple/Shared/Preview/Lyrics, written
// from src/client/fixtures/lyrics.ts by scripts/apple-fixtures.ts), the web tests' nominal line
// boxes, a lyrics source the test answers, and waits the test lets pass one by one.

/// A web lyric fixture by name (ballad-word, rap-word, duet-word, pop-line, static, cjk-word,
/// rtl-line, accents-word, long-lines, intro-outro).
func lyricFixture(_ name: String) -> LyricsDoc {
    guard let doc = try? JSONDecoder().decode(LyricsDoc.self, from: Fixture.data(name)) else {
        fatalError("The lyric fixture \(name).json does not read")
    }
    return doc
}

/// The fixtures with timed lines.
let timedLyricFixtures = [
    "ballad-word", "rap-word", "duet-word", "pop-line", "cjk-word", "rtl-line", "accents-word", "long-lines",
    "intro-outro",
]

/// The web tests' stage (model.test.ts): 1440 × 900 less the dock, 56 pt type.
enum LyricStage {
    static let W = 1440.0
    static let H = 812.0
    static let font = 56.0
    static let row = font * 1.12
    static let y0 = 0.4 * H
    static let gap = LyricsConfig.Column.gap * row
    static let frame = 1000.0 / 60
}

/// The web tests' nominal boxes: 0.5 em a character, wrapped at 0.64 of the width.
func nominalBoxes(_ doc: LyricsDoc, _ tl: LyricTimeline) -> [LyricLineBox] {
    let side = LyricText.sides(doc)
    return tl.lines.map { l in
        let raw = Double(l.text.utf16.count) * 0.5 * LyricStage.font
        let rows = (raw / (0.64 * LyricStage.W)).rounded(.up)
        return LyricLineBox(w: min(raw, 0.64 * LyricStage.W), h: rows * LyricStage.row, side: side(l))
    }
}

/// A field model of fixture `name` on the nominal boxes.
func lyricModel(_ name: String) -> LyricFieldModel {
    let doc = lyricFixture(name)
    let tl = LyricTimeline(doc)
    return LyricFieldModel(tl, boxes: nominalBoxes(doc, tl), dotsH: LyricStage.row)
}

extension LyricFieldModel {
    /// One frame at the web tests' stage.
    func step(_ t: Double, dt: Double = LyricStage.frame, playing: Bool = true, mode: LyricFieldMode = .run, reduced: Bool = false) {
        update(LyricFrameInput(t: t, dt: dt, playing: playing, mode: mode, W: LyricStage.W, H: LyricStage.H, reduced: reduced))
    }

    /// Plays from `from` to `to` (song ms) at `hz`, calling `each` after every frame.
    func play(
        from: Double, to: Double, hz: Double = 60, reduced: Bool = false, _ each: (Double) -> Void = { _ in }
    ) {
        let dt = 1000 / hz
        var t = from
        while t <= to {
            step(t, dt: dt, reduced: reduced)
            each(t)
            t += dt
        }
    }

    /// The lines in the column, in song order.
    var ordered: [LyricInst] { insts.values.sorted { $0.i < $1.i } }
}

/// Lyrics a test answers: per track key, at once or when released; what was asked and saved.
@MainActor
final class FakeLyricsSource: LyricsSource {
    var answers: [String: Result<LyricsAnswer, ApiError>] = [:]
    /// Tracks whose answer waits for release(_:).
    var held: Set<String> = []
    private var waiting: [String: CheckedContinuation<Void, Never>] = [:]
    private(set) var asked: [String] = []
    private(set) var saved: [String] = []

    func lyrics(for track: Track) async throws -> LyricsAnswer {
        asked.append(track.key)
        if held.contains(track.key) {
            await withCheckedContinuation { waiting[track.key] = $0 }
        }
        switch answers[track.key] ?? .success(LyricsAnswer(doc: nil)) {
        case .success(let answer): return answer
        case .failure(let error): throw error
        }
    }

    func release(_ key: String) {
        held.remove(key)
        waiting.removeValue(forKey: key)?.resume()
    }

    func saveOverride(trackKey: String, _ change: LyricsOverrideChange) async throws {
        switch change {
        case .offset(let ms): saved.append("\(trackKey) offset \(ms)")
        case .pin(let source): saved.append("\(trackKey) pin \(source ?? "auto")")
        }
    }
}

/// Waits that end when the test says: each `sleep` is held until `pass` lets waits of its length go.
@MainActor
final class LyricWaits {
    private var waits: [(Duration, CheckedContinuation<Void, Never>)] = []

    var pending: [Duration] { waits.map(\.0) }

    var sleep: @Sendable (Duration) async throws -> Void {
        { [self] duration in
            await self.wait(duration)
            try Task.checkCancellation()
        }
    }

    private func wait(_ duration: Duration) async {
        await withCheckedContinuation { waits.append((duration, $0)) }
    }

    /// Lets every wait of `duration` asked so far end (after one is asked), and lets the work after
    /// them run.
    func pass(_ duration: Duration) async {
        // The work started just now gets to its waits first.
        for _ in 0..<10 { await Task.yield() }
        _ = await eventually { self.waits.contains { $0.0 == duration } }
        let due = waits.filter { $0.0 == duration }
        waits.removeAll { $0.0 == duration }
        for (_, c) in due { c.resume() }
        for _ in 0..<10 { await Task.yield() }
    }

    /// Lets everything still waiting go (the end of a test).
    func passAll() async {
        let due = waits
        waits = []
        for (_, c) in due { c.resume() }
        for _ in 0..<10 { await Task.yield() }
    }
}

/// A word-synced document of one line, for the loader's tests.
func lyricsDoc(_ key: String, sync: LyricSync = .word, source: String = "navidrome") -> LyricsDoc {
    LyricsDoc(
        trackKey: key, sync: sync, source: source, attribution: LyricsAttribution(text: "Lyrics from your library"),
        lines: [
            LyricLine(
                text: "First line here", start: 1000, end: 3600,
                words: [LyricWord(text: "First", start: 1000, end: 1800), LyricWord(text: "line", start: 1900, end: 2700)]),
        ])
}
