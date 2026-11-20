import Foundation

// Stand-ins for playback: an engine that records what it is asked and plays to its end when told,
// the player's calls answered at once and recorded, a media center that keeps what the lock screen
// would show, Liked Songs, a clock the test moves, and the web's seeded random (queue.ts).

/// An engine that plays nothing: it records each call and says what a real one would (playing on
/// play, paused on pause) at once.
@MainActor
final class FakeEngine: PlaybackEngine {
    enum Call: Equatable {
        case load(String, at: Double, play: Bool)
        case preload(String?)
        case play, pause, stop
        case seek(Double)
    }

    var onEvent: ((EngineEvent) -> Void)?
    var volume: Float = 1
    var currentTime: Double? = nil
    /// Whether a load says it plays (off: a stream that never gets going).
    var reportsLoads = true
    private(set) var calls: [Call] = []
    /// What was loaded, in order (each with its URL and gain).
    private(set) var loads: [EngineItem] = []
    private(set) var current: EngineItem?
    private(set) var preloaded: EngineItem?

    var loadedKeys: [String] {
        calls.compactMap { call -> String? in
            guard case .load(let key, _, _) = call else { return nil }
            return key
        }
    }

    func load(_ item: EngineItem, at seconds: Double, play: Bool) {
        calls.append(.load(item.key, at: seconds, play: play))
        loads.append(item)
        if preloaded?.key == item.key, seconds <= 0 { preloaded = nil }
        current = item
        currentTime = seconds
        if reportsLoads { onEvent?(.status(play ? .playing : .paused)) }
    }

    func preload(_ item: EngineItem?) {
        calls.append(.preload(item?.key))
        preloaded = item
    }

    func play() {
        calls.append(.play)
        onEvent?(.status(.playing))
    }

    func pause() {
        calls.append(.pause)
        onEvent?(.status(.paused))
    }

    func seek(to seconds: Double) {
        calls.append(.seek(seconds))
        currentTime = seconds
    }

    func stop() {
        calls.append(.stop)
        current = nil
        preloaded = nil
        currentTime = nil
    }

    /// The song plays on to `seconds`.
    func play(to seconds: Double) {
        currentTime = seconds
        onEvent?(.time(seconds))
    }

    /// The song ends: the engine goes on to the one it buffered (without a gap), or stops.
    func finish() {
        if let next = preloaded {
            current = next
            preloaded = nil
            currentTime = 0
            onEvent?(.advanced(next.key))
        } else {
            current = nil
            currentTime = nil
            onEvent?(.ended)
        }
    }

    func send(_ event: EngineEvent) {
        onEvent?(event)
    }

    func forget() {
        calls = []
        loads = []
    }
}

/// The player's calls, answered at once: signed URLs that last `lifetime` from the clock's now.
final class FakeSource: PlaybackSource, @unchecked Sendable {
    private let lock = NSLock()
    private let clock: TestClock
    var lifetime: TimeInterval = 6 * 3600
    var streamError: ApiError? = nil
    private var _streams: [String] = []
    private var _qualities: [StreamQuality] = []
    private var _scrobbles: [String] = []
    private var _plays: [(String, PlayContext?)] = []

    init(clock: TestClock) {
        self.clock = clock
    }

    /// The songs (ids) whose stream URLs were asked for.
    var streams: [String] { lock.withLock { _streams } }
    /// "al-1-t1 now", "al-1-t1 played".
    var scrobbles: [String] { lock.withLock { _scrobbles } }
    var plays: [(String, PlayContext?)] { lock.withLock { _plays } }
    /// The quality each stream URL was asked at.
    var qualities: [StreamQuality] { lock.withLock { _qualities } }

    func streamURL(for track: Track, quality: StreamQuality) async throws -> SignedStream {
        lock.withLock { _qualities.append(quality) }
        return try await streamURL(for: track)
    }

    func streamURL(for track: Track) async throws -> SignedStream {
        let (error, count) = lock.withLock { () -> (ApiError?, Int) in
            _streams.append(track.id)
            return (streamError, _streams.count)
        }
        if let error { throw error }
        return SignedStream(
            url: URL(string: "https://echo.test/api/v1/navidrome/stream/\(track.id)?sig=\(count)")!,
            expiresAt: clock.now.addingTimeInterval(lifetime))
    }

    func scrobble(id: String, submission: Bool) async throws {
        lock.withLock { _scrobbles.append("\(id) \(submission ? "played" : "now")") }
    }

    func recordPlay(_ track: Track, context: PlayContext?) async throws {
        lock.withLock { _plays.append((track.id, context)) }
    }

    func savedQueue() async throws -> SavedQueue {
        SavedQueue(queue: nil, positionMs: 0, updatedAt: 0)
    }

    func saveQueue(_ queue: QueueState, positionMs: Double, base: Int) async throws -> Int { base + 1 }
}

/// What the lock screen and Control Center were told.
@MainActor
final class FakeMedia: MediaCenter {
    var onCommand: ((RemoteCommand) -> Bool)?
    private(set) var info: [String: Any]? = nil
    private(set) var playing = false
    private(set) var liked = false
    private(set) var canGoNext = false
    private(set) var publishes = 0

    func publish(_ info: [String: Any]?, playing: Bool) {
        self.info = info
        self.playing = playing
        publishes += 1
    }

    func update(liked: Bool, canGoNext: Bool) {
        self.liked = liked
        self.canGoNext = canGoNext
    }
}

/// Liked Songs.
@MainActor
final class FakeHearts: Hearts {
    var liked: Set<String> = []

    func isLiked(_ track: Track) -> Bool { liked.contains(track.id) }

    func setLiked(_ track: Track, _ on: Bool) async {
        if on { liked.insert(track.id) } else { liked.remove(track.id) }
    }
}

/// A clock the test moves.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var date = Date(timeIntervalSince1970: 1_800_000_000)

    var now: Date { lock.withLock { date } }

    func advance(_ seconds: TimeInterval) {
        lock.withLock { date = date.addingTimeInterval(seconds) }
    }
}

/// The web's seeded random (mulberry32, src/client/playback/queue.ts), so shuffles repeat.
final class SeededRandom: @unchecked Sendable {
    private var a: UInt32

    init(_ seed: UInt32) {
        a = seed
    }

    func next() -> Double {
        a = a &+ 0x6D2B_79F5
        var t = a
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }
}

/// Songs for the queue tests: "Song 1" … of album "al-1", 200 s each unless said.
func song(_ n: Int, album: String = "al-1", seconds: Int = 200) -> Track {
    Track(
        id: "\(album)-t\(n)", title: "Song \(n)", artists: [ArtistRef(id: "ar-1", name: "Lowfield")],
        album: AlbumRef(id: album, title: "Harbour Lights", key: "navidrome:\(album)"), durationMs: seconds * 1000,
        artwork: [Artwork(url: "/api/v1/navidrome/cover/\(album)?size=600")])
}

func songs(_ range: ClosedRange<Int>, album: String = "al-1", seconds: Int = 200) -> [Track] {
    range.map { song($0, album: album, seconds: seconds) }
}

let albumContext = PlayContext(kind: "album", id: "al-1", title: "Harbour Lights")
