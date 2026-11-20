import SwiftUI

// The pieces Now Playing (iPhone) and the player bar (Mac) share: the scrubber, Up next, and the
// glass buttons that light up when on (shuffle, repeat, the queue).

/// Where the song is, and a place to drag to: a thin white line over a faint one (the preview's),
/// thicker while held; the time played and the time left.
struct Scrubber: View {
    enum Layout {
        /// The times under the line (Now Playing).
        case stacked
        /// The times either side of it (the Mac's player bar).
        case inline
    }

    var layout = Layout.stacked

    @Environment(Player.self) private var player
    @State private var held: Double? = nil

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.25, paused: !player.isPlaying || held != nil)) { timeline in
            let duration = player.duration
            let time = held.map { $0 * duration } ?? player.time(at: timeline.date)
            let fraction = duration > 0 ? min(1, max(0, time / duration)) : 0
            let elapsed = NowPlayingDisplay.clock(time)
            let total = NowPlayingDisplay.clock(duration)
            Group {
                switch layout {
                case .stacked:
                    VStack(spacing: 4) {
                        line(fraction, duration: duration)
                        HStack {
                            Text(elapsed)
                            Spacer()
                            Text("-" + NowPlayingDisplay.clock(max(0, duration.rounded(.down) - time.rounded(.down))))
                        }
                        .font(.caption)
                    }
                case .inline:
                    HStack(spacing: 8) {
                        Text(elapsed)
                        line(fraction, duration: duration)
                        Text(total)
                    }
                    .font(.caption2)
                }
            }
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Position")
            .accessibilityValue("\(elapsed) of \(total)")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: player.seek(to: time + 15)
                case .decrement: player.seek(to: time - 15)
                @unknown default: break
                }
            }
        }
    }

    private func line(_ fraction: Double, duration: Double) -> some View {
        GeometryReader { geo in
            let width = max(1, geo.size.width)
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.22))
                Capsule().fill(.white).frame(width: width * fraction)
            }
            .frame(height: held == nil ? thickness : thickness + 4)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in held = min(1, max(0, drag.location.x / width)) }
                    .onEnded { drag in
                        player.seek(to: min(1, max(0, drag.location.x / width)) * duration)
                        held = nil
                    }
            )
            .animation(.smooth(duration: 0.2), value: held == nil)
        }
        .frame(height: layout == .stacked ? 24 : 16)
    }

    private var thickness: CGFloat { layout == .stacked ? 6 : 4 }
}

/// Up next: the songs added to play next, then the rest of the album or playlist; drag to reorder,
/// swipe (or the Mac's menu) to remove, tap to play one now.
struct QueueList: View {
    @Environment(Player.self) private var player

    var body: some View {
        let shown = QueueDisplay(player.queue)
        List {
            HStack(spacing: 10) {
                Text("Up next").font(.title3.bold())
                Spacer()
                Button("Shuffle", systemImage: "shuffle") { player.toggleShuffle() }
                    .glassToggle(player.shuffled)
                Button("Repeat", systemImage: player.repeatIcon) { player.cycleRepeat() }
                    .glassToggle(player.repeatMode != .off)
            }
            .labelStyle(.iconOnly)
            .queueRow()
            if shown.isEmpty {
                Text("Nothing after this song.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .queueRow()
            }
            if !shown.nextUp.isEmpty {
                header("Next up")
                ForEach(Array(shown.nextUp.enumerated()), id: \.offset) { index, track in
                    QueueRow(track: track) { player.jump(to: index) } remove: {
                        player.remove(.nextUp, atOffsets: [index])
                    }
                }
                .onMove { player.move(.nextUp, fromOffsets: $0, toOffset: $1) }
                .onDelete { player.remove(.nextUp, atOffsets: $0) }
            }
            if !shown.rest.isEmpty {
                header(shown.restTitle)
                ForEach(Array(shown.rest.enumerated()), id: \.offset) { index, track in
                    QueueRow(track: track) { player.jump(to: shown.nextUp.count + index) } remove: {
                        player.remove(.context, atOffsets: [index])
                    }
                }
                .onMove { player.move(.context, fromOffsets: $0, toOffset: $1) }
                .onDelete { player.remove(.context, atOffsets: $0) }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .animation(.smooth, value: shown)
    }

    private func header(_ title: String) -> some View {
        Text(title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 8)
            .queueRow()
    }
}

/// A song in Up next: its cover, title and artist, and the handle to drag it by.
struct QueueRow: View {
    let track: Track
    let play: () -> Void
    let remove: () -> Void

    var body: some View {
        Button(action: play) {
            HStack(spacing: 12) {
                Cover(path: track.cover, corner: 6).frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title).font(.body.weight(.medium)).lineLimit(1)
                    Text(track.artist).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "line.3.horizontal")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        #if os(macOS)
        .contextMenu {
            Button("Play Now", systemImage: "play.fill", action: play)
            Button("Remove from Queue", systemImage: "minus.circle", action: remove)
        }
        #endif
        .accessibilityAction(named: "Remove from Queue", remove)
        .queueRow()
    }
}

extension View {
    /// A row of Up next on the room's light: no background, no separator.
    func queueRow() -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 5, leading: 0, bottom: 5, trailing: 0))
    }

    /// A button that is on or off (shuffle, repeat, the queue): amber glass when on.
    @ViewBuilder
    func glassToggle(_ on: Bool) -> some View {
        #if os(macOS)
        buttonStyle(.borderless)
            .foregroundStyle(on ? Color.echoTint : Color.white)
        #else
        if on {
            buttonStyle(.glassProminent).buttonBorderShape(.circle).tint(Color.echoAccent)
        } else {
            buttonStyle(.glass).buttonBorderShape(.circle)
        }
        #endif
    }
}
