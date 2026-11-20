import Foundation

// What the mini player, Now Playing and the Mac's player bar show, worked out from the player, so
// the tests check it without drawing a screen (the views in UI/ show these as they are).

struct NowPlayingDisplay: Equatable, Sendable {
    var title: String
    /// "Lowfield", "A, B".
    var artist: String
    var album: String
    /// The cover's server path.
    var cover: String?
    /// "Playing from album" over "Harbour Lights" (nil when the queue came from nowhere in particular).
    var from: String?
    var fromTitle: String?
    /// Pause shows (not Play).
    var playing: Bool
    var playLabel: String
    var playIcon: String
    /// "1:24", "-2:17", "3:41".
    var elapsed: String
    var remaining: String
    var total: String
    /// 0…1.
    var progress: Double
    var canGoNext: Bool

    /// The player's song at `date`; nil when nothing is queued.
    @MainActor
    init?(_ player: Player, at date: Date) {
        guard let track = player.track else { return nil }
        title = track.title
        artist = track.artist
        album = track.album.title
        cover = track.cover
        let source = Self.source(player.context)
        from = source.label
        fromTitle = source.title
        let isPlaying = player.isPlaying
        playing = isPlaying
        playLabel = isPlaying ? "Pause" : "Play"
        playIcon = isPlaying ? "pause.fill" : "play.fill"
        let time = player.time(at: date)
        let duration = player.duration
        elapsed = Self.clock(time)
        remaining = "-" + Self.clock(max(0, duration.rounded(.down) - time.rounded(.down)))
        total = Self.clock(duration)
        progress = duration > 0 ? min(1, max(0, time / duration)) : 0
        canGoNext = player.hasNext
    }

    /// "Playing from album" and its title, by where the queue was started (PlayContext's kinds).
    static func source(_ context: PlayContext?) -> (label: String?, title: String?) {
        guard let context, !context.title.isEmpty else { return (nil, nil) }
        let kind: String
        switch context.kind {
        case "album": kind = "Playing from album"
        case "playlist": kind = "Playing from playlist"
        case "artist": kind = "Playing from artist"
        case "mix": kind = "Playing from Made for you"
        case "search": kind = "Playing from search"
        case "starred": kind = "Playing from your library"
        default: kind = "Playing from"
        }
        return (kind, context.title)
    }

    /// "3:41", "1:02:05".
    static func clock(_ seconds: Double) -> String {
        let s = Int(max(0, seconds.isFinite ? seconds : 0))
        return s >= 3600
            ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
            : String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// Now Playing's Up next: the songs the user added, then the rest of what plays.
struct QueueDisplay: Equatable, Sendable {
    var nextUp: [Track]
    var rest: [Track]
    /// "Continue playing from Harbour Lights".
    var restTitle: String
    var isEmpty: Bool { nextUp.isEmpty && rest.isEmpty }

    init(_ queue: QueueState) {
        nextUp = queue.nextUp
        rest = queue.orderedContext
        let title = queue.contextSource?.title ?? ""
        restTitle = title.isEmpty ? "Continue playing" : "Continue playing from \(title)"
    }
}

extension Player {
    /// The repeat button's symbol.
    var repeatIcon: String { repeatMode == .one ? "repeat.1" : "repeat" }
}
