#if os(iOS)
import SwiftUI

/// The song playing, in the tab bar's bottom accessory (the approved preview's mini player): its
/// cover, title and artist, which open Now Playing, and Play or Pause and Next in white. With the tab
/// bar minimized it sits beside it, Play or Pause alone.
struct MiniPlayer: View {
    @Environment(Feedback.self) private var feedback: Feedback?
    let open: () -> Void

    @Environment(Player.self) private var player
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        if let track = player.track {
            HStack(spacing: 10) {
                Button(action: open) {
                    HStack(spacing: 10) {
                        Cover(path: track.cover, corner: 8).frame(width: 34, height: 34)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(track.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(track.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Now Playing, \(track.title), \(track.artist)")
                .accessibilityHint("Opens Now Playing")
                Button(player.isPlaying ? "Pause" : "Play", systemImage: player.isPlaying ? "pause.fill" : "play.fill") {
                    feedback?.toggle(!player.isPlaying)
                    player.toggle()
                }
                .contentTransition(.symbolEffect(.replace))
                if placement != .inline {
                    Button("Next", systemImage: "forward.fill") { player.next() }
                        .disabled(!player.hasNext)
                }
            }
            .labelStyle(.iconOnly)
            .font(.title3)
            .foregroundStyle(Color.primary)
            .tint(Color.primary)
            .padding(.horizontal, 14)
        } else {
            // Only on iOS 26.0, which shows the accessory always (26.1 hides it with nothing queued).
            HStack(spacing: 10) {
                Image(systemName: "music.note")
                    .frame(width: 34, height: 34)
                    .background(Color.primary.opacity(0.1), in: .rect(cornerRadius: 8))
                Text("Not Playing").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
        }
    }
}

/// The mini player in the tab bar's accessory: hidden while nothing is queued where the system can
/// hide it (iOS 26.1).
struct PlayerAccessory<Accessory: View>: ViewModifier {
    let shown: Bool
    @ViewBuilder let accessory: () -> Accessory

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: shown) { accessory() }
        } else {
            content.tabViewBottomAccessory { accessory() }
        }
    }
}
#endif
