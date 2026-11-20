#if os(iOS)
import SwiftUI
import UIKit
import WidgetKit

// The home-screen widget's demo screens (`-ECHODemo widgets`, `widgets-tinted`, `widgets-idle`):
// the runner cannot put a widget on the simulator's home screen and screenshot it reliably, so
// these draw the widget's own views (iOS/WidgetViews) at their real sizes, at the home screen's
// places, over a wallpaper like iOS 26's. The full-colour look is the widget's own drawing; the
// tinted and clear looks are drawn as the system draws them (it takes the widget's background away,
// puts its own glass there, and colours the content: WidgetInk), the system not being there to.
// The songs are the web fixtures' (Demo.albums), their covers drawn in code and made small as the app
// makes them for the widget (WidgetCover); nothing reaches a network.

enum WidgetDemo: String {
    /// Small and medium, playing and paused, in full colour.
    case playing = "widgets"
    /// The tinted and clear looks of iOS 26's home screen.
    case tinted = "widgets-tinted"
    /// Nothing playing.
    case idle = "widgets-idle"
}

/// How the home screen draws widgets: as they are, tinted, or on clear glass.
enum WidgetDemoLook {
    case fullColor, tinted, clear

    /// The tint the demo's tinted home screen was given (the user picks it).
    static let tint = Color(hex: 0x8CB6FF)

    var ink: WidgetInk {
        switch self {
        case .fullColor: .fullColor
        case .tinted: .tinted(Self.tint)
        case .clear: .accented
        }
    }
}

struct WidgetDemoScreen: View {
    let demo: WidgetDemo
    @State private var songs = DemoWidgetSongs()

    var body: some View {
        GeometryReader { geometry in
            let size = WidgetDemoSize(width: geometry.size.width)
            ZStack(alignment: .top) {
                switch demo {
                case .playing: playing(size)
                case .tinted: looks(size)
                case .idle: idle(size)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .top)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
    }

    /// The first page: a small widget playing and one paused, a medium one playing and one paused.
    private func playing(_ size: WidgetDemoSize) -> some View {
        ZStack(alignment: .top) {
            HomeWallpaper()
            VStack(spacing: size.rowGap) {
                HStack(spacing: size.gap) {
                    tile(.fullColor, size, songs.harbour)
                    tile(.fullColor, size, songs.glass)
                }
                tile(.fullColor, size, songs.harbour, wide: true)
                tile(.fullColor, size, songs.paper, wide: true)
                Spacer(minLength: 0)
                SearchPill()
                    .padding(.bottom, 108)
            }
            .padding(.top, size.top)
        }
    }

    /// Tinted above (the wallpaper darkened and tinted, as the system does), clear glass below.
    private func looks(_ size: WidgetDemoSize) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: size.rowGap) {
                HStack(spacing: size.gap) {
                    tile(.tinted, size, songs.harbour)
                    tile(.tinted, size, songs.glass)
                }
                tile(.tinted, size, songs.harbour, wide: true)
            }
            .padding(.top, 62)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity)
            .background { HomeWallpaper(tint: WidgetDemoLook.tint) }
            .clipped()
            VStack(spacing: size.rowGap) {
                HStack(spacing: size.gap) {
                    tile(.clear, size, songs.harbour)
                    tile(.clear, size, songs.glass)
                }
                tile(.clear, size, songs.paper, wide: true)
                Spacer(minLength: 0)
            }
            .padding(.top, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { HomeWallpaper(focus: 0.62) }
            .clipped()
        }
    }

    /// Nothing playing, small and medium, in full colour, on clear glass and tinted.
    private func idle(_ size: WidgetDemoSize) -> some View {
        ZStack(alignment: .top) {
            HomeWallpaper()
            VStack(spacing: size.rowGap) {
                HStack(spacing: size.gap) {
                    tile(.fullColor, size, nil)
                    tile(.clear, size, nil)
                }
                tile(.fullColor, size, nil, wide: true)
                tile(.tinted, size, nil, wide: true)
                Spacer(minLength: 0)
                SearchPill()
                    .padding(.bottom, 108)
            }
            .padding(.top, size.top)
        }
    }

    /// A widget at its place on the home screen, its name under it.
    private func tile(_ look: WidgetDemoLook, _ size: WidgetDemoSize, _ song: DemoWidgetSongs.Song?, wide: Bool = false)
        -> some View
    {
        VStack(spacing: 6) {
            DemoWidgetTile(
                look: look, wide: wide, snapshot: song?.snapshot, cover: song?.cover,
                size: CGSize(width: wide ? size.medium : size.small, height: size.small))
            Text("ECHO")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.35), radius: 2, y: 1)
        }
    }
}

/// A widget as the home screen draws it in each look: the widget's own content with the system's
/// margins (16 points), on its own ground in full colour or on the system's glass in the others,
/// in the widget's rounded shape.
struct DemoWidgetTile: View {
    let look: WidgetDemoLook
    let wide: Bool
    let snapshot: WidgetSnapshot?
    let cover: UIImage?
    let size: CGSize

    static let corner: CGFloat = 26

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Self.corner, style: .continuous)
        let content = NowPlayingContent(snapshot: snapshot, cover: cover, wide: wide, ink: look.ink)
            .padding(16)
            .frame(width: size.width, height: size.height)
            .environment(\.widgetRenderingMode, look == .fullColor ? .fullColor : .accented)
        switch look {
        case .fullColor:
            content
                .background { WidgetGround(palette: snapshot?.palette) }
                .clipShape(shape)
        case .tinted:
            content
                .background { shape.fill(Color.black.opacity(0.3)) }
                .glassEffect(.regular.tint(WidgetDemoLook.tint.opacity(0.18)), in: shape)
        case .clear:
            content
                .glassEffect(.clear, in: shape)
        }
    }
}

/// The widgets' sizes on the home screen, by the screen's width (Apple's table; 402 points, the
/// runner's iPhone 17 Pro, measured on its home screen: Apple/Screenshots/icon).
struct WidgetDemoSize {
    let small: CGFloat
    let medium: CGFloat
    /// The first row's top, under the status bar.
    let top: CGFloat = 90
    let rowGap: CGFloat = 16

    init(width: CGFloat) {
        let sizes: (small: CGFloat, medium: CGFloat)
        switch width {
        case 428...: sizes = (170, 364)
        case 414..<428: sizes = (169, 360)
        case 402..<414: sizes = (164, 350)
        case 390..<402: sizes = (158, 338)
        default: sizes = (155, 329)
        }
        small = sizes.small
        medium = sizes.medium
    }

    /// Between two small widgets side by side.
    var gap: CGFloat { medium - 2 * small }
}

/// The demo's songs: Harbour Lights playing at 1:24, Glass Weather and Paper Satellites paused.
@MainActor
struct DemoWidgetSongs {
    struct Song {
        let snapshot: WidgetSnapshot
        let cover: UIImage?
    }

    let harbour: Song
    let glass: Song
    let paper: Song

    init() {
        let now = Date()
        harbour = Self.song(Demo.harbour, 0, at: 84, playing: true, now: now)
        glass = Self.song(Demo.albums[2], 2, at: 62, playing: false, now: now)
        paper = Self.song(Demo.albums[1], 1, at: 130, playing: false, now: now)
    }

    /// A song as the app would write it: its cover drawn small (WidgetCover) and its colours.
    private static func song(_ album: DemoAlbum, _ index: Int, at seconds: Double, playing: Bool, now: Date) -> Song {
        let drawn = DemoLibrary.png(album.cover).flatMap { UIImage(data: $0)?.cgImage }
        let small = drawn.flatMap { WidgetCover.jpeg($0, side: WidgetStore.coverSide) }.flatMap { UIImage(data: $0) }
        let song = album.songs[index]
        let snapshot = WidgetSnapshot(
            key: "navidrome:\(song.id)", title: song.title, artist: album.artist, album: album.title,
            palette: drawn.flatMap { AlbumPalette($0) }, playing: playing, advancing: playing, position: seconds,
            positionAt: now, duration: Double(song.seconds), cover: small == nil ? nil : "demo")
        return Song(snapshot: snapshot, cover: small)
    }
}

/// A wallpaper like iOS 26's own: deep blue, a great disc of lighter blue, a teal wave; tinted, it is
/// darkened and takes the tint, as the tinted home screen's is.
struct HomeWallpaper: View {
    var tint: Color? = nil
    /// Where the wave sits, down the screen (0…1).
    var focus: CGFloat = 0.6

    var body: some View {
        GeometryReader { geometry in
            let w = geometry.size.width
            let h = max(geometry.size.height, 600)
            ZStack {
                LinearGradient(
                    colors: [Color(hex: 0x05103A), Color(hex: 0x0A2466), Color(hex: 0x030B24)], startPoint: .top,
                    endPoint: .bottom)
                Circle()
                    .fill(LinearGradient(
                        colors: [Color(hex: 0x4A7BEA), Color(hex: 0x2347B0), Color(hex: 0x0D2470)], startPoint: .top,
                        endPoint: .bottom))
                    .frame(width: w * 1.55, height: w * 1.55)
                    .position(x: w * 1.02, y: h * 0.22)
                Ellipse()
                    .fill(LinearGradient(
                        colors: [Color(hex: 0x12A79C), Color(hex: 0x06555C), Color(hex: 0x021820)],
                        startPoint: .topTrailing, endPoint: .bottomLeading))
                    .frame(width: w * 1.7, height: h * 0.62)
                    .rotationEffect(.degrees(-30))
                    .position(x: w * 0.02, y: h * focus)
                Ellipse()
                    .fill(RadialGradient(
                        colors: [Color(hex: 0x74BCFF).opacity(0.8), .clear], center: .center, startRadius: 0,
                        endRadius: w * 0.62))
                    .frame(width: w * 1.3, height: h * 0.5)
                    .position(x: w * 0.98, y: h * 0.9)
            }
            .saturation(tint == nil ? 1 : 0.2)
            .overlay {
                if let tint {
                    ZStack {
                        Color.black.opacity(0.5)
                        tint.opacity(0.1)
                    }
                }
            }
        }
        .ignoresSafeArea()
    }
}

/// The home screen's Search button, on glass.
struct SearchPill: View {
    var body: some View {
        Label("Search", systemImage: "magnifyingglass")
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(height: 34)
            .glassEffect(.regular, in: .capsule)
            .accessibilityHidden(true)
    }
}
#endif
