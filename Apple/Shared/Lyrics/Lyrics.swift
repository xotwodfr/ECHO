import Foundation
import Observation

/// The playing track's lyrics, as the web's loader keeps them (src/client/lyrics/loader.ts;
/// LYRICS_INTEGRATION.md §6, LYRICS_EXPERIENCE.md §9.5, §9.13) and Android's Lyrics.kt: it follows
/// the track, asks the server 250 ms after a change (skipping through songs costs nothing), drops an
/// answer for any track but the one playing, says "no lyrics" at 6 s while still taking a late
/// answer, and warms the server's cache for the next song. The user's offset (±50 ms a step) and
/// source pin are the track's own, saved on the server.
@MainActor @Observable
final class Lyrics {
    enum Phase: Equatable, Sendable {
        /// Nothing playing.
        case idle
        /// Asked; nothing yet.
        case waiting(since: Date)
        case ready(LyricsDoc)
        /// No source had them (the sources tried), or none answered in 6 s (none listed).
        case missing(tried: [LyricsTried])
        /// ECHO could not be asked (offline, not answering) or answered with an error.
        case failed(ApiError)
    }

    private(set) var trackKey: String? = nil
    private(set) var phase = Phase.idle
    /// The user's offset for this track, ms (how much later the words show).
    private(set) var offsetMs = 0
    /// The source the user pinned for this track, if any.
    private(set) var pinnedSource: String? = nil

    static let debounce: Duration = .milliseconds(250)
    static let giveUp: Duration = .seconds(6)
    static let prefetchAfter: Duration = .seconds(2)
    static let saveAfter: Duration = .milliseconds(500)
    static let offsetStep = 50
    static let offsetMax = 10_000

    /// The sources' names (the web's Settings → Lyrics → Sources).
    nonisolated static let sourceNames: [(id: String, name: String)] = [
        ("navidrome", "Your library"), ("spicy", "Spicy Lyrics"), ("netease", "NetEase Cloud Music"),
        ("lrclib", "LRCLIB"), ("navidrome-plain", "Your library (plain text)"),
    ]

    /// What the sources said, in words (the web's `strings.stage.outcomes`).
    nonisolated static let outcomes: [String: String] = [
        "notFound": "not found", "instrumental": "instrumental", "mismatch": "a different song",
        "invalid": "unusable", "error": "failed", "timeout": "too slow", "skipped": "paused for now",
        "found": "found",
    ]

    @ObservationIgnored private let source: any LyricsSource
    @ObservationIgnored private let settings: @MainActor () -> UserSettings
    @ObservationIgnored private let upcoming: @MainActor () -> Track?
    @ObservationIgnored private let notify: @MainActor (String) -> Void
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var track: Track? = nil
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    /// Offset saves waiting, one per track: a save for one track never cancels another's.
    @ObservationIgnored private var saves: [String: Task<Void, Never>] = [:]

    /// - Parameters:
    ///   - settings: the preferences that follow the user (the global offset, motion, size).
    ///   - upcoming: the song that plays next, whose lyrics are asked for ahead.
    ///   - notify: a short message (the offset's toast).
    init(
        source: any LyricsSource,
        settings: @escaping @MainActor () -> UserSettings = { UserSettings() },
        upcoming: @escaping @MainActor () -> Track? = { nil },
        notify: @escaping @MainActor (String) -> Void = { _ in },
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> Date = { Date() }
    ) {
        self.source = source
        self.settings = settings
        self.upcoming = upcoming
        self.notify = notify
        self.sleep = sleep
        self.now = now
    }

    var doc: LyricsDoc? {
        if case .ready(let doc) = phase { return doc }
        return nil
    }

    /// Settings → Lyrics → timing, for every song.
    var globalOffsetMs: Int { settings().lyrics.globalOffsetMs }
    /// How much later the words show: the track's offset and the global one (§9.13).
    var totalOffsetMs: Int { offsetMs + globalOffsetMs }
    var preferences: UserSettings { settings() }

    /// No lyrics because there are no words: a source said so, or the title does (§9.4: the cover
    /// with no message).
    var isInstrumental: Bool {
        if case .missing(let tried) = phase, tried.contains(where: { $0.outcome == "instrumental" }) { return true }
        return track?.title.range(of: #"\binstrumental\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// A short key for the phase, for animating between them (cheaper than comparing documents).
    var phaseKey: String {
        switch phase {
        case .idle: "idle"
        case .waiting: "waiting \(trackKey ?? "")"
        case .ready(let doc): "ready \(doc.id)"
        case .missing: "missing \(trackKey ?? "")"
        case .failed: "failed \(trackKey ?? "")"
        }
    }

    // MARK: - Following the track

    /// The playing track changed (or stopped): its lyrics are asked for.
    func follow(_ track: Track?) {
        if track?.key == trackKey, track != nil, phase != .idle { return }
        start(track)
    }

    /// Asks again (Try Again, a new source pin).
    func reload() {
        start(track)
    }

    private func start(_ track: Track?) {
        for task in tasks { task.cancel() }
        tasks = []
        self.track = track
        trackKey = track?.key
        // The offset and pin are the track's own: none until its answer brings them.
        offsetMs = 0
        pinnedSource = nil
        guard let track else {
            phase = .idle
            return
        }
        phase = .waiting(since: now())
        let key = track.key
        let source = self.source
        tasks.append(Task { [weak self] in
            guard let self else { return }
            do { try await self.sleep(Self.debounce) } catch { return }
            let result: Result<LyricsAnswer, ApiError>
            do {
                result = .success(try await source.lyrics(for: track))
            } catch is CancellationError {
                return
            } catch {
                result = .failure(error as? ApiError ?? .badResponse)
            }
            // A late answer for a track that no longer plays is dropped (the server cached it).
            guard self.trackKey == key else { return }
            self.answered(result)
        })
        tasks.append(Task { [weak self] in
            guard let self else { return }
            do { try await self.sleep(Self.giveUp) } catch { return }
            guard self.trackKey == key, case .waiting = self.phase else { return }
            self.phase = .missing(tried: [])
        })
        // The next song's lyrics, in the background, so its own request is a cache hit.
        tasks.append(Task { [weak self] in
            guard let self else { return }
            do { try await self.sleep(Self.prefetchAfter) } catch { return }
            guard self.trackKey == key, let next = self.upcoming(), track.durationMs - 2000 >= 20_000 else { return }
            _ = try? await source.lyrics(for: next)
        })
    }

    private func answered(_ result: Result<LyricsAnswer, ApiError>) {
        switch result {
        case .success(let answer):
            offsetMs = answer.override.offsetMs
            pinnedSource = answer.override.pinnedSource
            if let doc = answer.doc {
                phase = .ready(doc)
            } else {
                phase = .missing(tried: answer.tried)
            }
        case .failure(let error):
            phase = .failed(error)
        }
    }

    // MARK: - The user's timing and source

    /// This track's lyrics 50 ms later (+1) or earlier (−1), saved half a second after the last
    /// step, with a toast saying the total.
    func nudge(_ direction: Int) {
        setOffset(offsetMs + direction * Self.offsetStep)
    }

    /// Back to the track's own timing.
    func resetOffset() {
        setOffset(0)
    }

    private func setOffset(_ value: Int) {
        // Until the track's answer comes its saved offset is unknown: a change would overwrite it.
        guard let key = trackKey else { return }
        if case .waiting = phase { return }
        offsetMs = max(-Self.offsetMax, min(Self.offsetMax, value))
        notify(Self.offsetMessage(totalOffsetMs))
        let offset = offsetMs
        let source = self.source
        saves[key]?.cancel()
        saves[key] = Task { [weak self] in
            do { try await self?.sleep(Self.saveAfter) } catch { return }
            self?.saves[key] = nil
            try? await source.saveOverride(trackKey: key, .offset(offset))
        }
    }

    /// "Use this source for this track" (nil: choose automatically), then the lyrics again.
    func pin(_ id: String?) async {
        guard let key = trackKey else { return }
        try? await source.saveOverride(trackKey: key, .pin(id))
        guard trackKey == key else { return }
        reload()
    }

    /// The toast's words for a total offset: "Lyrics +150 ms", "Lyrics on time".
    nonisolated static func offsetMessage(_ total: Int) -> String {
        total == 0 ? "Lyrics on time" : "Lyrics \(total > 0 ? "+" : "−")\(abs(total)) ms"
    }

    /// A source's name, as the credit and the menu say it.
    nonisolated static func sourceName(_ id: String) -> String {
        if id == "fixture" { return "ECHO's demo" }
        return sourceNames.first { $0.id == id }?.name ?? id
    }

    /// The sources tried, in words: "Your library: not found · LRCLIB: too slow".
    nonisolated static func triedText(_ tried: [LyricsTried]) -> String {
        if tried.isEmpty { return "No source answered in time." }
        return tried.map { "\(sourceName($0.source)): \(outcomes[$0.outcome] ?? $0.outcome)" }.joined(separator: " · ")
    }
}
