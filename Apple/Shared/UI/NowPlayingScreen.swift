#if os(iOS)
import AVKit
import SwiftUI

/// Now Playing (the approved preview's): the room lit by the song's cover, where it plays from, the
/// cover, the title with its heart, the scrubber, the transport in one glass capsule, and Lyrics,
/// AirPlay, Karaoke and Up next below. Up next takes the cover's place, the song shrinking to a row
/// above it; Lyrics open over it, growing from their button (swipe down to come back). Swipe down
/// or the chevron closes it.
struct NowPlayingScreen: View {
    /// Up next in the cover's place (the shell's, so it opens either way).
    @Binding var showsQueue: Bool
    /// The lyrics over it (the shell's too).
    @Binding var showsLyrics: Bool

    @Environment(Player.self) private var player
    @Environment(Library.self) private var library
    @Environment(Lyrics.self) private var lyrics
    @Environment(\.dismiss) private var dismiss
    @Environment(\.lyricsMenuOnOpen) private var lyricsMenuOnOpen
    @State private var palette: AlbumPalette? = nil
    @Namespace private var lyricsSpace

    var body: some View {
        ZStack {
            AlbumLight(palette: palette)
            if let track = player.track {
                content(track)
            }
        }
        // A heart or a queue change says so here too, above the buttons.
        .overlay { ToastLayer(bottom: 92) }
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
        .task(id: player.track?.cover) {
            if let cover = player.track?.cover { palette = await library.images.palette(cover) }
        }
        .onChange(of: player.track == nil) {
            if player.track == nil { dismiss() }
        }
        .fullScreenCover(isPresented: $showsLyrics) {
            LyricsScreen()
                .navigationTransition(.zoom(sourceID: "lyrics", in: lyricsSpace))
                .environment(library)
                .environment(player)
                .environment(lyrics)
                .environment(\.lyricsMenuOnOpen, lyricsMenuOnOpen)
        }
    }

    private func content(_ track: Track) -> some View {
        VStack(spacing: 22) {
            header(track)
            if showsQueue {
                HStack(spacing: 14) {
                    Cover(path: track.cover, corner: 10)
                        .frame(width: 64, height: 64)
                        .shadow(color: .black.opacity(0.4), radius: 12, y: 8)
                    titles(track, compact: true)
                    Spacer(minLength: 8)
                    heart(track)
                }
                QueueList()
                    .frame(maxHeight: .infinity)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else {
                Cover(path: track.cover, corner: 22)
                    .shadow(color: .black.opacity(0.45), radius: 34, y: 24)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                HStack {
                    titles(track, compact: false)
                    Spacer(minLength: 12)
                    heart(track)
                }
            }
            Scrubber()
            TransportCapsule()
            if !showsQueue { Spacer(minLength: 0) }
            buttons
        }
        .padding(.horizontal, 26)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    /// The chevron, where the music plays from, and the song's menu.
    private func header(_ track: Track) -> some View {
        HStack {
            Button("Close", systemImage: "chevron.down") { dismiss() }
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
            Spacer()
            let source = NowPlayingDisplay.source(player.context)
            VStack(spacing: 0) {
                if let label = source.label {
                    Text(label).font(.caption2).foregroundStyle(.secondary).textCase(.uppercase)
                }
                if let title = source.title {
                    Text(title).font(.footnote.bold()).lineLimit(1)
                }
            }
            .accessibilityElement(children: .combine)
            Spacer()
            Menu {
                TrackMenu(track: track, queueing: false)
            } label: {
                Label("More", systemImage: "ellipsis")
            }
            .labelStyle(.iconOnly)
            .menuStyle(.button)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
        }
        .controlSize(.large)
    }

    private func titles(_ track: Track, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(track.title)
                .font(compact ? .headline : .title2.bold())
                .lineLimit(1)
            Text(track.artist)
                .font(compact ? .subheadline : .title3)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    private func heart(_ track: Track) -> some View {
        let liked = library.isLiked(track)
        return Button(
            liked ? "Remove from Liked Songs" : "Add to Liked Songs", systemImage: liked ? "heart.fill" : "heart"
        ) {
            Task { await library.setLiked(track, !liked) }
        }
        .labelStyle(.iconOnly)
        .contentTransition(.symbolEffect(.replace))
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .tint(Color.amber)
        .controlSize(.large)
    }

    /// Lyrics, AirPlay, Karaoke (the karaoke task's) and Up next.
    private var buttons: some View {
        HStack {
            Button("Lyrics", systemImage: "quote.bubble") { showsLyrics = true }
                .roundGlass()
                .matchedTransitionSource(id: "lyrics", in: lyricsSpace)
            Spacer()
            // The system's AirPlay picker, invisible over a glass button like the others: it takes
            // the tap and shows the places the sound can go.
            Button("AirPlay", systemImage: "airplay.audio") {}
                .roundGlass()
                .accessibilityHidden(true)
                .overlay { RoutePicker() }
            Spacer()
            Button("Karaoke", systemImage: "music.mic") {}
                .roundGlass()
            Spacer()
            Button("Up next", systemImage: "list.bullet") {
                withAnimation(.smooth) { showsQueue.toggle() }
            }
            .labelStyle(.iconOnly)
            .glassToggle(showsQueue)
            .controlSize(.extraLarge)
        }
    }
}

/// Previous, Play or Pause, Next: white in one glass capsule (the preview's), each at least 60 pt.
struct TransportCapsule: View {
    @Environment(Player.self) private var player

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 22) {
                control("backward.fill", "Previous", size: 60) { player.previous() }
                control(player.isPlaying ? "pause.fill" : "play.fill", player.isPlaying ? "Pause" : "Play", size: 72) {
                    player.toggle()
                }
                control("forward.fill", "Next", size: 60) { player.next() }
                    .disabled(!player.hasNext)
                    .opacity(player.hasNext ? 1 : 0.4)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 6)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
    }

    private func control(_ icon: String, _ label: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: size, height: size)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// AirPlay and the other places the sound can go: the system's picker, its own glyph hidden (the
/// glass button under it shows one in the app's style).
struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView()
        picker.prioritizesVideoDevices = false
        picker.tintColor = .clear
        picker.activeTintColor = .clear
        picker.backgroundColor = .clear
        picker.accessibilityLabel = "AirPlay"
        return picker
    }

    func updateUIView(_ picker: AVRoutePickerView, context: Context) {}
}

extension View {
    /// A round glass button with an amber icon (Now Playing's row).
    func roundGlass() -> some View {
        labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(.extraLarge)
    }
}
#endif
