import Foundation

// The iPhone's home-screen widget (task 6): the app writes what plays into the App Group both it
// and its widget extension belong to (iOS/project.yml), and the widget reads it there. Plain Swift,
// compiled into the app, the extension (iOS/Widget) and the tests: what is shared (this file), the
// folder it lives in (WidgetStore), the widget's timeline (WidgetTimeline) and its buttons
// (WidgetCommand, WidgetIntents). The app's side, which writes it as the player publishes, is
// Playback/WidgetFeed.swift.

enum WidgetShared {
    /// The App Group the app and its widget extension share (ECHO.entitlements, ECHOWidget.entitlements).
    static let appGroup = "group.com.folk3s.echo"
    /// The widget's kind, which the app names to reload its timelines.
    static let kind = "NowPlaying"
}

/// What plays, as the widget shows it: written by the app from the same values the lock screen and
/// Control Center are given (Player.publish), so the three never disagree.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    /// The track's key (`navidrome:<id>`).
    var key: String
    var title: String
    var artist: String
    var album: String
    /// The album's colours, from its cover; nil until the cover has loaded.
    var palette: AlbumPalette?
    /// It plays, or is about to: Pause shows.
    var playing: Bool
    /// The song moves on (playing, not waiting for data): the progress runs.
    var advancing: Bool
    /// Seconds into the song at `positionAt`.
    var position: Double
    var positionAt: Date
    /// The song's length in seconds (0: not known).
    var duration: Double
    /// The cover's file name in the widget's folder (a small JPEG), nil without one.
    var cover: String?

    /// When the song started, had it played straight through to `positionAt`: the progress runs
    /// from here.
    var startedAt: Date { positionAt.addingTimeInterval(-position) }
    /// When it ends, played on from `positionAt`.
    var endsAt: Date { startedAt.addingTimeInterval(max(0, duration)) }

    /// Where the song is at `date`.
    func time(at date: Date) -> Double {
        let live = advancing ? position + date.timeIntervalSince(positionAt) : position
        return duration > 0 ? min(max(0, live), duration) : max(0, live)
    }

    /// The span `ProgressView(timerInterval:)` runs over while the song moves on: from its start to
    /// its end. Nil when it is held (paused, waiting for data) or its length is not known: the
    /// widget then shows `fraction`, still (iOS 26's timer progress cannot be held).
    var progressRange: ClosedRange<Date>? {
        guard advancing, duration > 0 else { return nil }
        return startedAt...endsAt
    }

    /// How far through the song it is (0…1) where it is held.
    var fraction: Double {
        duration > 0 ? min(1, max(0, position / duration)) : 0
    }

    /// The song stopped at its end: what the widget shows once a playing song should have ended and
    /// the app has said nothing since (it was closed).
    var ended: WidgetSnapshot {
        var s = self
        s.playing = false
        s.advancing = false
        s.position = max(0, duration)
        s.positionAt = endsAt
        return s
    }

    /// Whether the widget would show `other` as it shows this: the same song, cover and colours, play
    /// state and length, and the progress where it would be (a song playing on is the same; a seek,
    /// or a pause at another place, is not). The app writes and reloads only when this changes.
    func showsSame(as other: WidgetSnapshot) -> Bool {
        guard key == other.key, title == other.title, artist == other.artist, album == other.album,
              palette == other.palette, cover == other.cover, playing == other.playing,
              advancing == other.advancing, abs(duration - other.duration) < 0.5
        else { return false }
        let tolerance = WidgetSnapshot.drift
        if advancing { return abs(startedAt.timeIntervalSince(other.startedAt)) < tolerance }
        return abs(position - other.position) < tolerance
    }

    /// How far the progress may be off before the widget is told again (a seek is more).
    static let drift: TimeInterval = 1
}
