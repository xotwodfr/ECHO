import CoreGraphics
import Foundation
import MediaPlayer
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// The lock screen, Control Center and the Mac's Now Playing (and its media keys): what plays,
// through MPNowPlayingInfoCenter, and the controls, through MPRemoteCommandCenter. The info is built
// in one place, NowPlayingInfo.build, the iPhone's animated lock-screen cover too (MotionCovers);
// the widget starts there.

/// A control pressed outside the app: the lock screen, Control Center, headphones, a car, the Mac's
/// media keys or its Now Playing.
enum RemoteCommand: Equatable, Sendable {
    case play, pause, toggle, next, previous
    case seek(Double)
    /// The heart: on when off, off when on.
    case like
}

enum NowPlayingInfo {
    /// What the system shows for the song playing: its title, artist, album and cover, its length,
    /// where it is and whether it moves on (the rate), and its place in the queue. On the iPhone,
    /// once its album's motion cover is downloaded (`animated`), the lock screen's animated
    /// artwork too, tall (3:4) and square, over the still cover, which stays for everything else
    /// (and for the lock screen should the video not play). The Mac shows none (the owner's
    /// decision: the iPhone's lock screen only).
    static func build(
        track: Track, elapsed: Double, duration: Double, playing: Bool, index: Int, count: Int, artwork: CGImage?,
        animated: AnimatedCover? = nil
    ) -> [String: Any] {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyAlbumTitle: track.album.title,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: index,
            MPNowPlayingInfoPropertyPlaybackQueueCount: count,
            MPNowPlayingInfoPropertyExternalContentIdentifier: track.key,
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = Self.artwork(artwork) }
        #if os(iOS)
        if let tall = animated?.tall { info[MPNowPlayingInfoProperty3x4AnimatedArtwork] = Self.animatedArtwork(tall) }
        if let square = animated?.square { info[MPNowPlayingInfoProperty1x1AnimatedArtwork] = Self.animatedArtwork(square) }
        #endif
        return info
    }

    #if os(iOS)
    /// A motion cover for the lock screen (iOS 26's MPMediaItemAnimatedArtwork): its first frame as
    /// the preview the system shows until the video plays, and the looping video's local file. The
    /// id changes with the files (another version, shape or loop length), so the system takes the
    /// new ones and keeps showing the same ones otherwise.
    static func animatedArtwork(_ frame: AnimatedCover.Frame) -> MPMediaItemAnimatedArtwork {
        let still = frame.still
        let video = frame.video
        return MPMediaItemAnimatedArtwork(
            artworkID: frame.id,
            previewImageRequestHandler: { _ in UIImage(contentsOfFile: still.path(percentEncoded: false)) },
            videoAssetFileURLRequestHandler: { _ in video })
    }
    #endif

    /// A cover for the system, which asks for it at the sizes it draws (from any thread).
    static func artwork(_ image: CGImage) -> MPMediaItemArtwork {
        let size = CGSize(width: image.width, height: image.height)
        #if os(iOS)
        let picture = UIImage(cgImage: image)
        #else
        let picture = NSImage(cgImage: image, size: size)
        #endif
        return MPMediaItemArtwork(boundsSize: size) { _ in picture }
    }
}

/// Where the player tells the system what plays, and hears its controls.
@MainActor
protocol MediaCenter: AnyObject {
    /// A control pressed outside the app; whether there was something to do it to.
    var onCommand: ((RemoteCommand) -> Bool)? { get set }
    /// What plays (nil: nothing).
    func publish(_ info: [String: Any]?, playing: Bool)
    /// The controls' state: the heart, and whether Next has somewhere to go.
    func update(liked: Bool, canGoNext: Bool)
}

/// The system's own: MPNowPlayingInfoCenter and MPRemoteCommandCenter.
@MainActor
final class SystemMediaCenter: MediaCenter {
    var onCommand: ((RemoteCommand) -> Bool)?
    private var targets: [Any] = []

    init() {
        let center = MPRemoteCommandCenter.shared()
        let send: @Sendable (RemoteCommand) -> MPRemoteCommandHandlerStatus = { [weak self] command in
            Self.onMain { self?.onCommand?(command) ?? false }
        }
        targets = [
            Self.add(center.playCommand, send) { _ in .play },
            Self.add(center.pauseCommand, send) { _ in .pause },
            Self.add(center.togglePlayPauseCommand, send) { _ in .toggle },
            Self.add(center.nextTrackCommand, send) { _ in .next },
            Self.add(center.previousTrackCommand, send) { _ in .previous },
            Self.add(center.changePlaybackPositionCommand, send) { event in
                (event as? MPChangePlaybackPositionCommandEvent).map { RemoteCommand.seek($0.positionTime) }
            },
            Self.add(center.likeCommand, send) { _ in .like },
        ]
        center.likeCommand.localizedTitle = "Love"
        center.likeCommand.localizedShortTitle = "Love"
        // Not offered: skipping by seconds, ratings, dislike, bookmarks.
        let unused: [MPRemoteCommand] = [
            center.skipForwardCommand, center.skipBackwardCommand, center.dislikeCommand, center.bookmarkCommand,
            center.ratingCommand, center.seekForwardCommand, center.seekBackwardCommand,
        ]
        for command in unused { command.isEnabled = false }
    }

    func publish(_ info: [String: Any]?, playing: Bool) {
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = info
        #if os(macOS)
        // The Mac's Now Playing and its media keys follow this.
        center.playbackState = info == nil ? .stopped : playing ? .playing : .paused
        #endif
    }

    func update(liked: Bool, canGoNext: Bool) {
        let center = MPRemoteCommandCenter.shared()
        center.likeCommand.isActive = liked
        center.nextTrackCommand.isEnabled = canGoNext
    }

    /// A command's handler, which the system may call from any thread.
    private nonisolated static func add(
        _ command: MPRemoteCommand, _ send: @escaping @Sendable (RemoteCommand) -> MPRemoteCommandHandlerStatus,
        _ map: @escaping @Sendable (MPRemoteCommandEvent) -> RemoteCommand?
    ) -> Any {
        command.isEnabled = true
        return command.addTarget { event in
            guard let mapped = map(event) else { return .commandFailed }
            return send(mapped)
        }
    }

    /// Runs `work` on the main actor: at once when called there (the usual case), else soon.
    private nonisolated static func onMain(_ work: @escaping @MainActor () -> Bool) -> MPRemoteCommandHandlerStatus {
        if Thread.isMainThread {
            return MainActor.assumeIsolated(work) ? .success : .noActionableNowPlayingItem
        }
        Task { @MainActor in _ = work() }
        return .success
    }
}
