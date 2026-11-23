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
    /// queued next, on the screens that show playing (`nowplaying`, `queue`, `mini`, `player`, and
    /// `settings` and `lockcover`, whose lock screen preview shows its album's motion cover); on the
    /// lyrics' screens paused where the screen shows (DemoLyrics.time(for:)).
    static func demo(library: Library, screen: String, motion: MotionCovers? = nil, device: DeviceSettings? = nil) -> Player {
        let device = device ?? DeviceSettings(defaults: nil)
        let karaoke = Karaoke(device: device)
        let player = Player(
            source: DemoPlaybackSource(), engine: DemoEngine(), hearts: library, images: library.images, motion: motion,
            karaoke: karaoke, follows: false, notify: { library.show(Toast(message: $0)) })
        // The karaoke screens: Karaoke on, the vocals at 35 % and the key two semitones up.
        if DemoKaraoke.screens.contains(screen) {
            device.setKaraoke(true)
            device.setVocalLevel(0.35)
            device.setKaraokeKey(2)
            let making = screen == "karaoke-making"
            karaoke.preview(
                status: making ? .preparing : .ready, ahead: making ? 2 : 0,
                progress: screen == "settings-karaoke"
                    ? KaraokeProgress(enabled: true, online: true, ready: 126, queued: 214, failed: 2, skipped: 1, bytes: 843_000_000)
                    : nil)
        }
        if [
            "nowplaying", "queue", "mini", "player", "settings", "settings-playback", "settings-lyrics", "lockcover",
            "karaoke", "karaoke-shelf", "karaoke-making", "settings-karaoke",
        ].contains(screen) || DemoTogether.screens.contains(screen) {
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

/// The karaoke demo screens: `karaoke` (Now Playing, the Mac's player bar), `karaoke-lyrics`, `karaoke-shelf`
/// (Home scrolled to the shelf), `karaoke-making` (Now Playing while the version is made), `settings-karaoke`
/// (Settings' Karaoke group with the server's progress).
enum DemoKaraoke {
    static let screens = ["karaoke", "karaoke-lyrics", "karaoke-shelf", "karaoke-making", "settings-karaoke"]
}
