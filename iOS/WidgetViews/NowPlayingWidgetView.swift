import AppIntents
import SwiftUI
import UIKit
import WidgetKit

// The home-screen widget's views (task 6), compiled into the widget extension (iOS/Widget) and into
// the app, whose demo screens draw them at their real sizes (Preview/DemoWidgets.swift): the cover,
// the song and the artist, the progress running from the song's start by itself, the album's colours
// as the ground; the small one with play and pause, the medium one with the transport in one capsule,
// as Now Playing has it. A tap anywhere else opens Now Playing (AppLink).

/// One moment of the widget's timeline: what plays (nil: nothing) and its cover.
struct NowPlayingEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let cover: UIImage?
}

/// The widget as WidgetKit draws it: the content for its size and the home screen's look, on the
/// album's colours (the container's background, which the system takes away in the tinted and clear
/// looks and draws its own glass for).
struct NowPlayingWidgetView: View {
    let entry: NowPlayingEntry

    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        NowPlayingContent(
            snapshot: entry.snapshot, cover: entry.cover, wide: family == .systemMedium,
            ink: renderingMode == .fullColor ? .fullColor : .accented)
            .containerBackground(for: .widget) { WidgetGround(palette: entry.snapshot?.palette) }
            .widgetURL(AppLink.nowPlaying.url)
    }
}

/// The colours the content is drawn in. In full colour, white on the album's ground, as the app's
/// glass is; in the accented looks (iOS 26's tinted and clear home screens) the system draws the
/// content in its own colours by their opacity (the parts marked `widgetAccentable` in the tint),
/// so white again. The demo screens, with no system to do it, give the tinted look's colours
/// themselves (`tinted`).
struct WidgetInk {
    var primary: Color
    var secondary: Color
    /// The accent group: the progress, the buttons' glyphs, the mark.
    var accent: Color
    /// The buttons' plates.
    var plate: Color
    var isFullColor = false

    static let fullColor = WidgetInk(
        primary: .white, secondary: .white.opacity(0.72), accent: .white, plate: .white.opacity(0.17), isFullColor: true)
    static let accented = WidgetInk(
        primary: .white, secondary: .white.opacity(0.62), accent: .white, plate: .white.opacity(0.14))

    /// The tinted look as the system draws it: the content in a pale tint, the accent group in the tint.
    static func tinted(_ tint: Color) -> WidgetInk {
        let pale = tint.mix(with: .white, by: 0.62)
        return WidgetInk(primary: pale, secondary: pale.opacity(0.66), accent: tint, plate: tint.opacity(0.2))
    }
}

/// What the widget shows, at either size: the song, or nothing playing.
struct NowPlayingContent: View {
    let snapshot: WidgetSnapshot?
    let cover: UIImage?
    /// The medium widget (else the small one).
    let wide: Bool
    let ink: WidgetInk

    var body: some View {
        Group {
            if let snapshot {
                if wide {
                    MediumNowPlaying(snapshot: snapshot, cover: cover, ink: ink)
                } else {
                    SmallNowPlaying(snapshot: snapshot, cover: cover, ink: ink)
                }
            } else {
                NothingPlaying(wide: wide, ink: ink)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // The system's own parts (the progress bar's track) as on the dark glass.
        .environment(\.colorScheme, .dark)
    }
}

/// The small widget: the cover and play or pause above, the song, the artist and the progress below.
struct SmallNowPlaying: View {
    let snapshot: WidgetSnapshot
    let cover: UIImage?
    let ink: WidgetInk

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                CoverTile(image: cover, side: 62, corner: 13, ink: ink)
                Spacer(minLength: 0)
                PlayPauseButton(playing: snapshot.playing, side: 40, ink: ink)
            }
            Spacer(minLength: 6)
            Text(snapshot.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(ink.primary)
                .lineLimit(1)
            Text(snapshot.artist)
                .font(.system(size: 13))
                .foregroundStyle(ink.secondary)
                .lineLimit(1)
                .padding(.top, 1)
            SongProgress(snapshot: snapshot, ink: ink)
                .padding(.top, 9)
        }
    }
}

/// The medium widget: the cover at the left; the song, the artist, the progress with its times and
/// the transport (previous, play or pause, next) in one capsule at the right.
struct MediumNowPlaying: View {
    let snapshot: WidgetSnapshot
    let cover: UIImage?
    let ink: WidgetInk

    var body: some View {
        HStack(spacing: 14) {
            CoverTile(image: cover, side: nil, corner: 18, ink: ink)
            VStack(alignment: .leading, spacing: 0) {
                Text(snapshot.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(ink.primary)
                    .lineLimit(1)
                Text(snapshot.artist)
                    .font(.system(size: 14))
                    .foregroundStyle(ink.secondary)
                    .lineLimit(1)
                    .padding(.top, 1)
                Spacer(minLength: 6)
                SongProgress(snapshot: snapshot, ink: ink)
                SongTimes(snapshot: snapshot, ink: ink)
                    .padding(.top, 5)
                Spacer(minLength: 6)
                Transport(playing: snapshot.playing, ink: ink)
            }
        }
    }
}

/// Nothing playing: the ECHO mark and "Play something"; a tap opens the app.
struct NothingPlaying: View {
    let wide: Bool
    let ink: WidgetInk

    var body: some View {
        if wide {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(ink.plate)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay { mark(side: 66) }
                VStack(alignment: .leading, spacing: 2) {
                    words
                    Spacer(minLength: 0)
                }
                .padding(.top, 2)
                Spacer(minLength: 0)
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                mark(side: 50)
                    .padding(.leading, -8)
                Spacer(minLength: 0)
                words
            }
        }
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Play something")
                .font(.system(size: wide ? 17 : 15, weight: .semibold))
                .foregroundStyle(ink.primary)
            Text(wide ? "Tap to open ECHO" : "ECHO")
                .font(.system(size: wide ? 14 : 13))
                .foregroundStyle(ink.secondary)
        }
    }

    /// The app icon's mark, its point of sound lit amber in full colour (as the icon's is).
    private func mark(side: CGFloat) -> some View {
        EchoMark()
            .colorMultiply(ink.accent)
            .frame(width: side, height: side)
            .background(alignment: .leading) {
                if ink.isFullColor {
                    Circle()
                        .fill(RadialGradient(
                            colors: [Color(red: 0.96, green: 0.83, blue: 0.54).opacity(0.75), .clear],
                            center: .center, startRadius: 0, endRadius: side * 0.42))
                        .frame(width: side * 0.84, height: side * 0.84)
                        .offset(x: side * (300.0 / 1024) - side * 0.42)
                }
            }
            .widgetAccentable()
    }
}

/// The album's cover, kept a cover in every look (full colour, not tinted); a note on glass until
/// it has loaded. `side` nil: as tall as there is room for, square.
struct CoverTile: View {
    let image: UIImage?
    let side: CGFloat?
    let corner: CGFloat
    let ink: WidgetInk

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: corner, style: .continuous)
        // A square of the room there is (or `side`), the cover filling it.
        Color.clear
            .frame(width: side, height: side)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .widgetAccentedRenderingMode(.fullColor)
                        .aspectRatio(contentMode: .fill)
                } else {
                    shape.fill(ink.plate)
                        .overlay {
                            Image(systemName: "music.note")
                                .font(.system(size: (side ?? 132) * 0.36, weight: .medium))
                                .foregroundStyle(ink.secondary)
                        }
                }
            }
            .clipShape(shape)
        .shadow(color: .black.opacity(ink.isFullColor ? 0.28 : 0), radius: 8, y: 3)
        .accessibilityHidden(true)
    }
}

/// Where the song is: a thin line that runs from the song's start by itself while it plays
/// (`ProgressView(timerInterval:)`, no timeline reloads), held where it is otherwise.
struct SongProgress: View {
    let snapshot: WidgetSnapshot
    let ink: WidgetInk

    var body: some View {
        Group {
            if let range = snapshot.progressRange {
                ProgressView(timerInterval: range, countsDown: false) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
            } else {
                ProgressView(value: snapshot.fraction)
            }
        }
        .progressViewStyle(.linear)
        .tint(ink.accent)
        .widgetAccentable()
        .accessibilityLabel("Position")
    }
}

/// The time played (running by itself while it plays) and the song's length.
struct SongTimes: View {
    let snapshot: WidgetSnapshot
    let ink: WidgetInk

    var body: some View {
        HStack(spacing: 6) {
            Group {
                if let range = snapshot.progressRange {
                    Text(timerInterval: range, countsDown: false, showsHours: false)
                } else {
                    Text(WidgetClock.text(snapshot.position))
                }
            }
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(WidgetClock.text(snapshot.duration))
        }
        .font(.system(size: 11, weight: .medium))
        .monospacedDigit()
        .foregroundStyle(ink.secondary)
    }
}

/// Play or pause, on a round plate (the small widget).
struct PlayPauseButton: View {
    let playing: Bool
    let side: CGFloat
    let ink: WidgetInk

    var body: some View {
        Button(intent: PlayPauseIntent()) {
            TransportGlyph(symbol: playing ? "pause.fill" : "play.fill", size: side * 0.42, ink: ink)
                .frame(width: side, height: side)
                .background(Circle().fill(ink.plate))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playing ? "Pause" : "Play")
    }
}

/// Previous, play or pause, and next in one capsule (the medium widget), as Now Playing's transport.
struct Transport: View {
    let playing: Bool
    let ink: WidgetInk

    var body: some View {
        HStack(spacing: 0) {
            control(PreviousSongIntent(), "backward.fill", 15, "Previous")
            control(PlayPauseIntent(), playing ? "pause.fill" : "play.fill", 19, playing ? "Pause" : "Play")
            control(NextSongIntent(), "forward.fill", 15, "Next")
        }
        .frame(height: 40)
        .background(Capsule().fill(ink.plate))
    }

    private func control(_ intent: some AppIntent, _ symbol: String, _ size: CGFloat, _ label: String) -> some View {
        Button(intent: intent) {
            TransportGlyph(symbol: symbol, size: size, ink: ink)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A transport symbol in the accent group; Play's triangle nudged right to sit centred to the eye.
struct TransportGlyph: View {
    let symbol: String
    let size: CGFloat
    let ink: WidgetInk

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(ink.accent)
            .offset(x: symbol == "play.fill" ? size * 0.08 : 0)
            .widgetAccentable()
    }
}

/// The ground under the widget: the album's light, as the app's room has it (its colours dark above,
/// its vivid colour glowing in the middle, the floor nearly black); ECHO's own Harbour light without
/// a cover.
struct WidgetGround: View {
    let palette: AlbumPalette?

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.42, 0.55], [1, 0.45],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: colors
        )
        .background(floor)
    }

    private var colors: [Color] {
        guard let palette else {
            return [
                Self.hex(0x1C4F7A), Self.hex(0x173450), Self.hex(0x2A5D8C),
                Self.hex(0x6B5322), Self.hex(0xC4964A).opacity(0.9), Self.hex(0x163A5A),
                Self.hex(0x081620), Self.hex(0x0B1B2B), Self.hex(0x081620),
            ]
        }
        return palette.mesh.enumerated().map { i, rgb in i == 4 ? Self.color(rgb).opacity(0.9) : Self.color(rgb) }
    }

    private var floor: Color {
        palette.map { Self.color($0.mesh[7]) } ?? Self.hex(0x10283E)
    }

    private static func color(_ rgb: RGB) -> Color {
        Color(red: rgb.r, green: rgb.g, blue: rgb.b)
    }

    private static func hex(_ value: UInt32) -> Color {
        Color(
            red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255)
    }
}

/// "1:24": minutes and seconds.
enum WidgetClock {
    static func text(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded(.down)))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
