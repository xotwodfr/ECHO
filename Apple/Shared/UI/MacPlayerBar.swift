#if os(macOS)
import SwiftUI

/// The Mac's player at the bottom of the window (the approved preview's glass bar): the song and
/// where it is from, shuffle, previous, play or pause, next and repeat over the scrubber, then
/// Lyrics (over the window), Up next and the volume.
struct MacPlayerBar: View {
    @Environment(Feedback.self) private var feedback: Feedback?
    /// The lyrics over the window (the shell's).
    @Binding var showsLyrics: Bool

    @Environment(Player.self) private var player
    @Environment(Library.self) private var library
    @State private var showsQueue = false
    @State private var showsVolume = false

    var body: some View {
        if let track = player.track {
            HStack(spacing: 16) {
                HStack(spacing: 12) {
                    Cover(path: track.cover, corner: 8).frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title).font(.callout.weight(.semibold)).lineLimit(1)
                        Text(track.album.title.isEmpty ? track.artist : "\(track.artist) · \(track.album.title)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(width: 250, alignment: .leading)
                .accessibilityElement(children: .combine)

                VStack(spacing: 6) {
                    HStack(spacing: 14) {
                        Button("Shuffle", systemImage: "shuffle") { player.toggleShuffle() }
                            .glassToggle(player.shuffled)
                        Button("Previous", systemImage: "backward.fill") { player.previous() }
                        Button(player.isPlaying ? "Pause" : "Play", systemImage: player.isPlaying ? "pause.fill" : "play.fill") {
                            feedback?.toggle(!player.isPlaying)
                            player.toggle()
                        }
                        .font(.title2)
                        .contentTransition(.symbolEffect(.replace))
                        Button("Next", systemImage: "forward.fill") { player.next() }
                            .disabled(!player.hasNext)
                        Button("Repeat", systemImage: player.repeatIcon) { player.cycleRepeat() }
                            .glassToggle(player.repeatMode != .off)
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .foregroundStyle(Color.primary)
                    Scrubber(layout: .inline)
                        .frame(maxWidth: 440)
                }
                .frame(maxWidth: .infinity)

                HStack(spacing: 10) {
                    Button("Lyrics", systemImage: "quote.bubble") { showsLyrics.toggle() }
                        .glassToggle(showsLyrics)
                    Button("Up next", systemImage: "list.bullet") { showsQueue.toggle() }
                        .popover(isPresented: $showsQueue, arrowEdge: .top) {
                            QueueList()
                                .padding(12)
                                .frame(width: 380, height: 480)
                                .environment(player)
                                .environment(library)
                        }
                    Button("Volume", systemImage: volumeIcon) { showsVolume.toggle() }
                        .popover(isPresented: $showsVolume, arrowEdge: .top) {
                            HStack(spacing: 10) {
                                Image(systemName: "speaker.fill").foregroundStyle(.secondary)
                                Slider(
                                    value: Binding(get: { player.volume }, set: { player.setVolume($0) }), in: 0...1
                                )
                                .frame(width: 160)
                                Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
                            }
                            .padding(14)
                        }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .foregroundStyle(Color.primary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .themedGlass(22)
        }
    }

    private var volumeIcon: String {
        player.volume == 0 ? "speaker.slash.fill" : player.volume < 0.5 ? "speaker.wave.1.fill" : "speaker.wave.2.fill"
    }
}
#endif
