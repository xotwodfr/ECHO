import Foundation

/// The widget's timeline, from what the app last wrote (the extension's TimelineProvider hands
/// these to WidgetKit as they are). The progress runs by itself from the song's start
/// (`ProgressView(timerInterval:)`), so the timeline never has to move it; the app reloads it when
/// what plays changes (WidgetFeed), so it never asks to be reloaded itself.
enum WidgetTimeline {
    /// What the widget shows from `date` on.
    struct Moment: Equatable, Sendable {
        let date: Date
        let snapshot: WidgetSnapshot?
    }

    /// Nothing playing: one moment, nothing playing. Paused: one, held where it is. Playing: one
    /// now, running from the song's start, and one at the song's end, stopped there, for when the
    /// app has said nothing more by then (it was closed). A playing song that should have ended
    /// already shows stopped at its end.
    static func moments(for snapshot: WidgetSnapshot?, now: Date) -> [Moment] {
        guard let snapshot else { return [Moment(date: now, snapshot: nil)] }
        guard snapshot.advancing, snapshot.duration > 0 else { return [Moment(date: now, snapshot: snapshot)] }
        let end = snapshot.endsAt
        guard end > now else { return [Moment(date: now, snapshot: snapshot.ended)] }
        return [Moment(date: now, snapshot: snapshot), Moment(date: end, snapshot: snapshot.ended)]
    }

    /// The widget gallery's example, when nothing has played yet: a song of the web's fixture albums
    /// (Harbour Lights), paused, in its colours.
    static let sample = WidgetSnapshot(
        key: "sample", title: "Ferry at Six", artist: "Lowfield", album: "Harbour Lights",
        palette: AlbumPalette(base: RGB(0.07, 0.15, 0.22), accent: RGB(0.96, 0.83, 0.54)),
        playing: false, advancing: false, position: 84, positionAt: Date(timeIntervalSince1970: 0), duration: 221,
        cover: nil)
}
