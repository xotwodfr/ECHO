import SwiftUI
#if os(iOS)
import AVFoundation
import UIKit
#endif

extension EnvironmentValues {
    /// The preview (`-ECHODemo`): the lock screen's preview holds this moment of its loop (seconds)
    /// instead of playing, so a screenshot shows the same frame each time.
    @Entry var motionPreviewFrame: Double? = nil
    /// The preview's `lockcover` screen: the lock screen's preview opens over Settings.
    @Entry var lockPreviewOnOpen: Bool = false
}

#if os(iOS)
/// Settings → Lock screen (the iPhone's): the playing album's animated cover as the lock screen
/// shows it, beside the loop speed (the loop's length asked of the server, kept on this device).
/// The preview opens full screen as the lock screen looks.
struct LockScreenSettings: View {
    @Environment(DeviceSettings.self) private var device
    @Environment(Player.self) private var player
    @Environment(Library.self) private var library
    @Environment(\.motionPreviewFrame) private var frame
    @Environment(\.lockPreviewOnOpen) private var previewOnOpen
    @State private var previewOpen = false

    var body: some View {
        SettingsGroup(
            title: "Lock screen",
            footer: "While ECHO plays, the lock screen shows the album's cover moving. ECHO makes it on the album's first play and keeps it; until then the still cover shows. A video an admin uploaded for the album plays at its own length."
        ) {
            HStack(alignment: .top, spacing: 16) {
                Button {
                    previewOpen = true
                } label: {
                    LockCoverPreview(compact: true)
                        .frame(width: 120)
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(7)
                                .glassEffect(.regular, in: .circle)
                                .padding(6)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Preview the lock screen")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Animated cover").font(.headline)
                    Text("Loop speed").font(.subheadline).foregroundStyle(.secondary)
                        .padding(.bottom, 6)
                    ForEach(LoopSpeed.allCases) { speed in
                        speedRow(speed)
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $previewOpen) {
            LockCoverScreen()
                .environment(device)
                .environment(player)
                .environment(library)
                .environment(\.motionPreviewFrame, frame)
        }
        .task {
            guard previewOnOpen else { return }
            try? await Task.sleep(for: .milliseconds(500))
            previewOpen = true
        }
    }

    private func speedRow(_ speed: LoopSpeed) -> some View {
        let chosen = device.motionLoop == speed
        return Button {
            device.setMotionLoop(speed)
        } label: {
            HStack(spacing: 8) {
                Text(speed.label).font(.body.weight(chosen ? .semibold : .regular))
                Text("\(speed.seconds) s").font(.footnote).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                if chosen {
                    Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(Color.amber)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(chosen ? Color.white.opacity(0.12) : .clear, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(speed.label), a \(speed.seconds)-second loop")
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// The lock screen's animated cover for the playing album, in its tall 3:4 frame: the downloaded
/// video looping at the chosen speed (a cover made at another length plays faster or slower to
/// match), over its still; before ECHO has made one, the still cover filling the frame; with
/// nothing playing, the room's light. A small clock sits on it as the lock screen's does.
struct LockCoverPreview: View {
    var compact = false

    @Environment(Player.self) private var player
    @Environment(DeviceSettings.self) private var device
    @Environment(\.motionPreviewFrame) private var frame

    var body: some View {
        let file = player.motion?.preview(for: player.track)
        Color.clear
            .aspectRatio(0.75, contentMode: .fit)
            .overlay { LockCoverMedia(file: file, rate: rate(file), frame: frame) }
            .overlay(alignment: .top) {
                if compact {
                    Text(clock)
                        .font(.system(size: 26, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.92))
                        .shadow(color: .black.opacity(0.35), radius: 6, y: 1)
                        .padding(.top, 14)
                }
            }
            .clipShape(.rect(cornerRadius: compact ? 18 : 0, style: .continuous))
            .overlay {
                if compact {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.16), lineWidth: 1)
                }
            }
            .accessibilityHidden(true)
    }

    /// The preview's 9:41, as the status bar shows it; the time otherwise.
    private var clock: String {
        frame != nil ? "9:41" : Date.now.formatted(date: .omitted, time: .shortened)
    }

    /// A cover made at another loop length plays at the chosen one; an upload at its own.
    private func rate(_ file: MotionFile?) -> Float {
        guard let file, file.note.source != "upload", let made = file.note.seconds, made > 0 else { return 1 }
        return Float(made / Double(device.motionLoop.seconds))
    }
}

/// The cover itself: the video (or, held, one frame of it) over its still, or the still cover.
struct LockCoverMedia: View {
    let file: MotionFile?
    var rate: Float = 1
    var frame: Double? = nil

    @Environment(Player.self) private var player

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let file {
                    FileImage(url: file.still)
                    if let frame {
                        VideoFrame(url: file.video, at: frame)
                    } else {
                        LoopingVideo(url: file.video, rate: rate)
                    }
                } else if let track = player.track {
                    // Not made yet: the still cover, the square filling the tall frame.
                    Cover(path: track.cover, corner: 0)
                        .scaledToFill()
                } else {
                    AlbumLight()
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
    }
}

/// Below the tall frame, where the screen is longer than 3:4: the cover's own light, its still
/// blurred and dimmed, so the frame's foot fades into it.
struct LockCoverBackdrop: View {
    let file: MotionFile?

    @Environment(Player.self) private var player

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let file {
                    FileImage(url: file.still)
                } else if let track = player.track {
                    Cover(path: track.cover, corner: 0).scaledToFill()
                } else {
                    AlbumLight()
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .blur(radius: 48)
            .overlay(Color.black.opacity(0.3))
            .clipped()
        }
    }
}

/// An image file shown filling its frame.
struct FileImage: View {
    let url: URL

    var body: some View {
        if let image = UIImage(contentsOfFile: url.path(percentEncoded: false)) {
            Image(uiImage: image).resizable().scaledToFill()
        }
    }
}

/// One frame of a video, filling its frame (the preview's held moment).
struct VideoFrame: View {
    let url: URL
    let at: Double
    @State private var image: CGImage? = nil

    var body: some View {
        Group {
            if let image {
                Image(decorative: image, scale: 1).resizable().scaledToFill()
            }
        }
        .task(id: url) {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.requestedTimeToleranceBefore = .zero
            generator.requestedTimeToleranceAfter = .zero
            image = (try? await generator.image(at: CMTime(seconds: at, preferredTimescale: 600)))?.image
        }
    }
}

/// A video looping without a sound, filling its frame, at `rate`.
struct LoopingVideo: UIViewRepresentable {
    let url: URL
    var rate: Float = 1

    func makeUIView(context: Context) -> LoopingVideoView {
        let view = LoopingVideoView()
        view.show(url, rate: rate)
        return view
    }

    func updateUIView(_ view: LoopingVideoView, context: Context) {
        view.show(url, rate: rate)
    }

    static func dismantleUIView(_ view: LoopingVideoView, coordinator: ()) {
        view.stop()
    }
}

final class LoopingVideoView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    private var playerLayer: AVPlayerLayer? { layer as? AVPlayerLayer }
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var url: URL?

    func show(_ url: URL, rate: Float) {
        if url != self.url {
            stop()
            self.url = url
            let player = AVQueuePlayer()
            player.isMuted = true
            player.preventsDisplaySleepDuringVideoPlayback = false
            player.audiovisualBackgroundPlaybackPolicy = .pauses
            looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
            playerLayer?.videoGravity = .resizeAspectFill
            playerLayer?.player = player
            self.player = player
        }
        player?.defaultRate = rate
        player?.rate = rate
    }

    func stop() {
        player?.pause()
        looper?.disableLooping()
        looper = nil
        playerLayer?.player = nil
        player = nil
        url = nil
    }
}

/// The lock screen as it looks while ECHO plays, full screen in the app: the whole tall 3:4 frame
/// moving across the screen's width at the top, its foot fading into its own blurred light below,
/// the date and the time over it, and the player on glass at the bottom. A preview, from Settings;
/// swipe down or Done to go back.
struct LockCoverScreen: View {
    @Environment(Player.self) private var player
    @Environment(DeviceSettings.self) private var device
    @Environment(\.motionPreviewFrame) private var frame
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let file = player.motion?.preview(for: player.track)
        ZStack {
            GeometryReader { geo in
                ZStack(alignment: .top) {
                    LockCoverBackdrop(file: file)
                    LockCoverMedia(file: file, rate: rate(file), frame: frame)
                        .frame(width: geo.size.width, height: geo.size.width * 4 / 3)
                        .mask {
                            LinearGradient(
                                stops: [.init(color: .black, location: 0.8), .init(color: .clear, location: 1)],
                                startPoint: .top, endPoint: .bottom)
                        }
                }
            }
            .ignoresSafeArea()
            LinearGradient(colors: [.black.opacity(0.25), .clear, .clear, .black.opacity(0.2)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    Text(date)
                        .font(.title3.weight(.semibold))
                    Text(clock)
                        .font(.system(size: 92, weight: .bold, design: .rounded))
                        .monospacedDigit()
                }
                .foregroundStyle(.white.opacity(0.94))
                .shadow(color: .black.opacity(0.3), radius: 10, y: 2)
                .padding(.top, 44)
                Spacer()
                nowPlaying
                    .padding(.horizontal, 16)
                Text(caption)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 14)
                    .padding(.bottom, 8)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button("Done") { dismiss() }
                .buttonStyle(.glass)
                .tint(.white)
                .padding(.trailing, 16)
                .padding(.top, 4)
        }
        .gesture(DragGesture(minimumDistance: 30).onEnded { if $0.translation.height > 80 { dismiss() } })
        .preferredColorScheme(.dark)
    }

    /// The player as the lock screen has it, on glass: the song, where it is, and the transport.
    @ViewBuilder private var nowPlaying: some View {
        if let track = player.track {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    Cover(path: track.cover, corner: 8).frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(track.title).font(.headline).lineLimit(1)
                        Text(track.artist).font(.subheadline).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                let total = max(1, player.duration)
                let at = player.time()
                VStack(spacing: 4) {
                    ProgressView(value: min(at, total), total: total)
                        .tint(.white)
                    HStack {
                        Text(mmss(Int(at))).font(.caption2.monospacedDigit())
                        Spacer()
                        Text("-" + mmss(Int(total - at))).font(.caption2.monospacedDigit())
                    }
                    .foregroundStyle(.white.opacity(0.7))
                }
                HStack(spacing: 44) {
                    Button("Previous", systemImage: "backward.fill") { player.previous() }
                    Button(player.isPlaying ? "Pause" : "Play", systemImage: player.isPlaying ? "pause.fill" : "play.fill") {
                        player.toggle()
                    }
                    .font(.system(size: 34))
                    Button("Next", systemImage: "forward.fill") { player.next() }
                }
                .labelStyle(.iconOnly)
                .font(.title2)
                .foregroundStyle(.white)
                .buttonStyle(.plain)
            }
            .padding(18)
            .glassEffect(.regular, in: .rect(cornerRadius: 30))
        }
    }

    private var date: String {
        frame != nil ? "Friday 20 November" : Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    private var clock: String {
        frame != nil ? "9:41" : Date.now.formatted(date: .omitted, time: .shortened)
    }

    private var caption: String {
        guard let track = player.track else { return "Play an album to see its cover here." }
        if file(for: track) != nil {
            return "Preview: \(track.album.title) at \(device.motionLoop.label.lowercased()) speed, as the lock screen shows it."
        }
        return "\(track.album.title) shows its still cover until ECHO has made its animated one."
    }

    private func file(for track: Track) -> MotionFile? {
        player.motion?.preview(for: track)
    }

    private func rate(_ file: MotionFile?) -> Float {
        guard let file, file.note.source != "upload", let made = file.note.seconds, made > 0 else { return 1 }
        return Float(made / Double(device.motionLoop.seconds))
    }
}
#endif
