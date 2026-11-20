import Foundation
import Observation

// The playing album's animated lock-screen cover, as the iPhone asks for it (docs/MOTION.md, the
// spec's "Animated lock-screen covers"): on the album's first play the server is asked for it,
// tall and square at the loop length in Settings; while it answers 202 the still cover stays and
// the app asks again after its Retry-After (never sooner, the waits growing, up to ten minutes in
// all); once it is ready its still and video are downloaded and kept (MotionFiles), and the player
// tells the lock screen again. The next play of the album shows it at once. Another album playing,
// or another loop length chosen, stops the asking for the one before. The Mac has none.

/// An animated cover as the lock screen takes it (NowPlayingInfo.build): for each shape its video's
/// and still's files, and an id that changes whenever either does.
struct AnimatedCover: Equatable, Sendable {
    struct Frame: Equatable, Sendable {
        let id: String
        let video: URL
        let still: URL
    }

    var tall: Frame?
    var square: Frame?
}

@MainActor @Observable
final class MotionCovers {
    /// While the server makes a cover, each wait is at least its Retry-After and at least this,
    /// half as long again each time, up to `longestWait`.
    static let firstWait: Double = 5
    static let longestWait: Double = 60
    /// The asking stops once the waits would pass this (an album's first songs); the album's next
    /// play asks again.
    static let giveUpAfter: Double = 600
    /// How long an album is left alone after the server could not make its cover, after giving up,
    /// and after an error (no network, an answer that could not be read).
    static let restAfterFailure: TimeInterval = 3600
    static let restAfterGivingUp: TimeInterval = 600
    static let restAfterError: TimeInterval = 300
    /// A downloaded cover is checked against the server's version once a day, as long as the
    /// server lets clients keep it (an admin may have uploaded a video for the album since).
    static let checkAfter: TimeInterval = 86_400

    /// Counts the covers kept and forgotten, so a view showing one (Settings' preview) follows.
    private(set) var revision = 0

    let files: MotionFiles
    private let source: any MotionSource
    private let loop: @MainActor () -> Int
    private let sleep: @Sendable (Duration) async throws -> Void
    private let now: () -> Date

    private struct Asking: Hashable {
        let album: String
        let loop: Int
    }

    /// The album and loop length followed now (asked for, waiting, done or resting).
    @ObservationIgnored private var current: Asking?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var resting: [Asking: Date] = [:]
    @ObservationIgnored private var offUntil: Date?

    /// - Parameters:
    ///   - loop: the loop length chosen in Settings, in seconds (LoopSpeed).
    ///   - sleep: the waits between asks (the tests' pass at once).
    init(
        source: any MotionSource,
        files: MotionFiles,
        loop: @escaping @MainActor () -> Int = { LoopSpeed.standard.seconds },
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> Date = { Date() }
    ) {
        self.source = source
        self.files = files
        self.loop = loop
        self.sleep = sleep
        self.now = now
    }

    /// The Navidrome album a track's album key names ("navidrome:al-1"); nil for anything else:
    /// the server makes motion covers for Navidrome's albums.
    static func album(of track: Track) -> String? {
        let key = track.album.key
        guard key.hasPrefix("navidrome:") else { return nil }
        let id = String(key.dropFirst("navidrome:".count))
        return id.isEmpty ? nil : id
    }

    // MARK: - What the lock screen shows

    /// The track's album's cover as downloaded, at the loop length in Settings: nil until ready.
    func cover(for track: Track) -> AnimatedCover? {
        guard let album = Self.album(of: track) else { return nil }
        let loop = loop()
        var cover = AnimatedCover()
        for shape in MotionShape.allCases {
            guard let file = files.file(MotionKey(album: album, shape: shape, loop: loop)) else { continue }
            let frame = AnimatedCover.Frame(
                id: "\(track.album.key)|\(shape.rawValue)|\(loop)|\(file.note.version)", video: file.video,
                still: file.still)
            switch shape {
            case .tall: cover.tall = frame
            case .square: cover.square = frame
            }
        }
        return cover.tall == nil && cover.square == nil ? nil : cover
    }

    /// The tall cover downloaded for the track's album, at the loop length in Settings when there
    /// is one, else at another (Settings' preview plays it at the chosen speed).
    func preview(for track: Track?) -> MotionFile? {
        _ = revision
        guard let track, let album = Self.album(of: track) else { return nil }
        let chosen = loop()
        for length in [chosen] + LoopSpeed.allCases.map(\.seconds).filter({ $0 != chosen }) {
            if let file = files.file(MotionKey(album: album, shape: .tall, loop: length)) { return file }
        }
        return nil
    }

    // MARK: - Asking for it

    /// Follows the track playing: its album's cover is asked for unless it is downloaded already
    /// (and checked within the day); `ready` runs each time a shape has come, for the player to
    /// tell the lock screen. Another album or loop length stops the asking for the one before; the
    /// same album's next song changes nothing. Nil (nothing plays) stops it.
    func want(_ track: Track?, ready: @escaping @MainActor () -> Void) {
        guard let track, let album = Self.album(of: track) else {
            cancel()
            return
        }
        let asking = Asking(album: album, loop: loop())
        guard asking != current else { return }
        cancel()
        current = asking
        var wanted: [MotionShape] = []
        for shape in MotionShape.allCases {
            let key = key(asking, shape)
            if let file = files.file(key) {
                files.used(key)
                if now().timeIntervalSince(file.note.checkedAt) < Self.checkAfter { continue }
            }
            wanted.append(shape)
        }
        guard !wanted.isEmpty else { return }
        if let until = resting[asking], until > now() { return }
        if let offUntil, offUntil > now() { return }
        task = Task { [weak self] in
            await self?.fetch(asking, wanted, ready: ready)
        }
    }

    /// Stops asking (nothing plays).
    func cancel() {
        task?.cancel()
        task = nil
        current = nil
    }

    /// Forgets every downloaded cover (signing out: the next account's server is another).
    func clear() {
        cancel()
        resting = [:]
        offUntil = nil
        files.removeAll()
        revision += 1
    }

    private func key(_ asking: Asking, _ shape: MotionShape) -> MotionKey {
        MotionKey(album: asking.album, shape: shape, loop: asking.loop)
    }

    private func fetch(_ asking: Asking, _ shapes: [MotionShape], ready: @escaping @MainActor () -> Void) async {
        var waited = 0.0
        var attempt = 0
        for shape in shapes {
            let key = key(asking, shape)
            let known = files.file(key)
            ask: while true {
                if Task.isCancelled { return }
                do {
                    switch try await source.motion(album: asking.album, shape: shape, loop: asking.loop) {
                    case .ready(let cover):
                        if let known, known.note.version == cover.version {
                            files.checked(key)
                            break ask
                        }
                        let still = try await source.motionFile(cover.still)
                        let video = try await source.motionFile(cover.video)
                        if Task.isCancelled { return }
                        let note = MotionNote(
                            version: cover.version, seconds: cover.seconds, style: cover.style, source: cover.source,
                            checkedAt: now())
                        guard files.store(key, video: video, still: still, note: note) != nil else {
                            rest(asking, Self.restAfterError)
                            return
                        }
                        revision += 1
                        ready()
                        break ask
                    case .pending(let retryAfter, _), .busy(let retryAfter):
                        guard try await wait(retryAfter, attempt: &attempt, waited: &waited) else {
                            if !Task.isCancelled { rest(asking, Self.restAfterGivingUp) }
                            return
                        }
                    case .failed:
                        rest(asking, Self.restAfterFailure)
                        return
                    case .off:
                        offUntil = now().addingTimeInterval(Self.restAfterFailure)
                        return
                    }
                } catch let notReady as MotionNotReady {
                    // Made again since the server said it was ready (its cache let it go): wait.
                    guard (try? await wait(notReady.retryAfter, attempt: &attempt, waited: &waited)) == true else {
                        if !Task.isCancelled { rest(asking, Self.restAfterGivingUp) }
                        return
                    }
                } catch {
                    if !Task.isCancelled, !(error is CancellationError) { rest(asking, Self.restAfterError) }
                    return
                }
            }
        }
    }

    /// The wait before asking again (seconds): what the server said, at least the growing floor.
    static func delay(retryAfter: Int, attempt: Int) -> Double {
        max(Double(retryAfter), min(longestWait, firstWait * pow(1.5, Double(attempt))))
    }

    /// Waits before asking again; false (without waiting) when that would pass `giveUpAfter`.
    private func wait(_ retryAfter: Int, attempt: inout Int, waited: inout Double) async throws -> Bool {
        let seconds = Self.delay(retryAfter: retryAfter, attempt: attempt)
        guard waited + seconds <= Self.giveUpAfter else { return false }
        try await sleep(.milliseconds(Int((seconds * 1000).rounded())))
        waited += seconds
        attempt += 1
        return !Task.isCancelled
    }

    private func rest(_ asking: Asking, _ seconds: TimeInterval) {
        resting[asking] = now().addingTimeInterval(seconds)
    }
}
