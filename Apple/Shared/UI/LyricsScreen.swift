import SwiftUI

#if os(iOS)
/// The iPhone's lyrics (the approved preview's; LYRICS_EXPERIENCE.md): the room lit by the song's
/// cover full-bleed, the lyric column over it, the glass chevron and the source's credit at the top,
/// and the song in a glass card at the bottom. It opens from Now Playing's glass Lyrics button;
/// swipe down (or the chevron) goes back.
struct LyricsScreen: View {
    @Environment(Player.self) private var player
    @Environment(Library.self) private var library
    @Environment(Lyrics.self) private var lyrics
    @Environment(\.dismiss) private var dismiss
    @Environment(\.lyricLook) private var look
    @Environment(\.lyricsMenuOnOpen) private var menuOnOpen
    @State private var palette: AlbumPalette? = nil
    @State private var menu = false

    /// The active size (the lyric size setting scales it, §4.3).
    static let size = 30.0

    var body: some View {
        GeometryReader { geo in
            let safe = geo.safeAreaInsets
            let style = look.make(palette, Self.size * lyrics.preferences.lyrics.sizeScale)
            ZStack {
                AlbumLight(palette: palette)
                LyricsStage(top: safe.top + 64, bottom: safe.bottom + 128, style: style)
                    .ignoresSafeArea()
            }
            .overlay(alignment: .top) { header }
            .overlay(alignment: .bottom) {
                LyricsPlayerCard()
                    .padding(.horizontal, 16)
                    .padding(.bottom, 4)
            }
        }
        .overlay { ToastLayer(bottom: 132) }
        .themedDark()
        .task(id: player.track?.cover) {
            if let cover = player.track?.cover { palette = await library.images.palette(cover) }
        }
        .task {
            // `-ECHODemo lyrics-menu`: the menu open with the lyrics.
            guard menuOnOpen else { return }
            try? await Task.sleep(for: .milliseconds(900))
            menu = true
        }
        .onChange(of: player.track == nil) {
            if player.track == nil { dismiss() }
        }
    }

    private var header: some View {
        HStack {
            Button("Close", systemImage: "chevron.down") { dismiss() }
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
            Spacer()
            LyricsCredit(menu: $menu)
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }
}
#endif

#if os(macOS)
/// The Mac's lyrics, over the whole window (the approved preview's): the room lit by the cover, the
/// song on the left (its cover, title, the scrubber and the transport on glass), the lyric column on
/// the right, the source's credit at the top. The player bar's Lyrics button opens it; the chevron
/// or Escape closes it; `[` and `]` move this song's lyrics 50 ms earlier or later.
struct MacLyricsView: View {
    @Environment(Feedback.self) private var feedback: Feedback?
    @Environment(\.theme) private var theme
    @Binding var shown: Bool

    @Environment(Player.self) private var player
    @Environment(Library.self) private var library
    @Environment(Lyrics.self) private var lyrics
    @Environment(\.lyricLook) private var look
    @State private var palette: AlbumPalette? = nil
    @State private var menu = false
    @State private var showsQueue = false

    var body: some View {
        GeometryReader { geo in
            // The active size follows the window, as the web's --ly-active does.
            let size = min(46, max(28, Double(geo.size.height) * 0.052)) * lyrics.preferences.lyrics.sizeScale
            ZStack {
                AlbumLight(palette: palette)
                HStack(spacing: 0) {
                    side
                        .frame(width: min(360, geo.size.width * 0.3))
                        .padding(.leading, 72)
                        .padding(.trailing, 32)
                    LyricsStage(top: 64, bottom: 40, style: look.make(palette, size))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .overlay(alignment: .topTrailing) {
                LyricsCredit(menu: $menu).padding(.top, 18).padding(.trailing, 20)
            }
            .overlay(alignment: .topLeading) {
                Button("Close Lyrics", systemImage: "chevron.down") { shown = false }
                    .labelStyle(.iconOnly)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .contentShape(.circle)
                    .buttonStyle(.plain)
                    .themedGlass(interactive: true)
                    .padding(.top, 46)
                    .padding(.leading, 20)
            }
        }
        .ignoresSafeArea()
        // The timing's toast, and any other, over the lyrics.
        .overlay { ToastLayer(bottom: 28) }
        .background { shortcuts }
        .themedDark()
        .task(id: player.track?.cover) {
            if let cover = player.track?.cover { palette = await library.images.palette(cover) }
        }
        .onChange(of: player.track == nil) {
            if player.track == nil { shown = false }
        }
    }

    @ViewBuilder
    private var side: some View {
        if let track = player.track {
            VStack(alignment: .leading, spacing: 18) {
                Cover(path: track.cover, corner: 20)
                    .shadow(color: .black.opacity(0.45), radius: 34, y: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title).font(.title.bold()).lineLimit(2)
                    Text(track.album.title.isEmpty ? track.artist : "\(track.artist) · \(track.album.title)")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                Scrubber(layout: .inline)
                GlassEffectContainer(spacing: 10) {
                    HStack(spacing: 10) {
                        round("backward.fill", "Previous", 48) { player.previous() }
                        round(player.isPlaying ? "pause.fill" : "play.fill", player.isPlaying ? "Pause" : "Play", 60) {
                            feedback?.toggle(!player.isPlaying)
                            player.toggle()
                        }
                        round("forward.fill", "Next", 48) { player.next() }
                            .disabled(!player.hasNext)
                        round("quote.bubble.fill", "Close Lyrics", 48, tint: theme.forcedDark.tint) { shown = false }
                        round("list.bullet", "Up next", 48) { showsQueue.toggle() }
                            .popover(isPresented: $showsQueue, arrowEdge: .top) {
                                QueueList()
                                    .padding(12)
                                    .frame(width: 380, height: 480)
                                    .environment(player)
                                    .environment(library)
                            }
                    }
                }
            }
        }
    }

    private func round(
        _ icon: String, _ label: String, _ size: CGFloat, tint: Color = .white, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundStyle(tint)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: size, height: size)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .themedGlass(interactive: true)
        .accessibilityLabel(label)
    }

    /// Escape closes; `[` and `]` are the web's lyric timing keys.
    private var shortcuts: some View {
        ZStack {
            Button("Close Lyrics") { shown = false }
                .keyboardShortcut(.cancelAction)
            Button("Lyrics Earlier") { lyrics.nudge(-1) }
                .keyboardShortcut("[", modifiers: [])
            Button("Lyrics Later") { lyrics.nudge(1) }
                .keyboardShortcut("]", modifiers: [])
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}
#endif
