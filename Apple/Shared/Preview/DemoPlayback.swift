import Foundation

// The preview's player (`-ECHODemo`): the real Player on an engine that never streams and calls
// that never reach the network, its song paused at a fixed place, so Now Playing, Up next, the mini
// player and the Mac's player bar draw as they would with music.

/// Calls that answer at once and send nothing anywhere.
struct DemoPlaybackSource: PlaybackSource {
    func streamURL(for track: Track) async throws -> SignedStream {
        SignedStream(url: URL(fileURLWithPath: "/dev/null"), expiresAt: .distantFuture)
    }

    func scrobble(id: String, submission: Bool) async throws {}
    func recordPlay(_ track: Track, context: PlayContext?) async throws {}

    func savedQueue() async throws -> SavedQueue {
        SavedQueue(queue: nil, positionMs: 0, updatedAt: 0)
    }

    func saveQueue(_ queue: QueueState, positionMs: Double, base: Int) async throws -> Int { base }
}

/// An engine that plays nothing: Play shows Pause, and the song stays where it is.
@MainActor
final class DemoEngine: PlaybackEngine {
    var onEvent: ((EngineEvent) -> Void)?
    var volume: Float = 1
    private(set) var currentTime: Double? = nil

    func load(_ item: EngineItem, at seconds: Double, play: Bool) {
        currentTime = seconds
        onEvent?(.status(play ? .playing : .paused))
    }

    func preload(_ item: EngineItem?) {}

    func play() {
        onEvent?(.status(.playing))
    }

    func pause() {
        onEvent?(.status(.paused))
    }

    func seek(to seconds: Double) {
        currentTime = seconds
    }

    func stop() {
        currentTime = nil
    }
}

extension Player {
    /// The preview's player: Ferry at Six paused at 1:24, Harbour Lights after it and two songs
    /// queued next, on the screens that show playing (`nowplaying`, `queue`, `mini`, `player`); on
    /// the lyrics' screens paused where the screen shows (DemoLyrics.time(for:)).
    static func demo(library: Library, screen: String) -> Player {
        let player = Player(
            source: DemoPlaybackSource(), engine: DemoEngine(), hearts: library, images: library.images, follows: false,
            notify: { library.show(Toast(message: $0)) })
        if ["nowplaying", "queue", "mini", "player"].contains(screen) {
            player.cue(DemoLibrary.nowPlaying, at: 84)
        } else if let time = DemoLyrics.time(for: screen) {
            player.cue(DemoLibrary.nowPlaying, at: time)
        }
        return player
    }
}

extension DemoLibrary {
    /// Harbour Lights from its first song, with two songs added to play next.
    static var nowPlaying: QueueState {
        let album = Demo.harbour
        return QueueState(
            provider: "navidrome", now: track(album, 0), nextUp: songs(["glass-2", "paper-1"]),
            context: album.songs.indices.dropFirst().map { track(album, $0) },
            contextSource: PlayContext(kind: "album", id: album.id, title: album.title))
    }
}
