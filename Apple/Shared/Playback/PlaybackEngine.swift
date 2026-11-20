import Foundation

// What plays the sound, behind a small protocol: AVPlaybackEngine (AVQueuePlayer, the audio session)
// in the apps, a fake in the tests and one that never streams in the preview (Preview/DemoPlayback).
// The queue, the gapless hand-over, the saved queue, scrobbling, the lock screen's info and its
// commands are the Player's, so they are tested without sound.

/// A song as the engine plays it: a signed stream URL (`/navidrome/stream-url`), and its ReplayGain.
struct EngineItem: Equatable, Sendable {
    /// The track's key ("navidrome:al-1-t1").
    var key: String
    var url: URL
    /// The ReplayGain as a volume, 0…1 (1: as recorded).
    var gain: Float
    /// When the signed URL stops working.
    var expiresAt: Date
}

/// What the engine is doing.
enum EngineStatus: Equatable, Sendable {
    case paused
    /// Asked to play, waiting for data.
    case buffering
    case playing
}

/// What the engine tells the player.
enum EngineEvent: Equatable, Sendable {
    case status(EngineStatus)
    /// Seconds into the current song (twice a second while it plays, and after a seek).
    case time(Double)
    /// The current song's length as the file has it.
    case duration(Double)
    /// The current song ended and the one preloaded (its key) took over without a gap.
    case advanced(String)
    /// The current song ended with nothing preloaded.
    case ended
    /// The current song (its key) could not be played.
    case failed(String)
    /// The preloaded song (its key) could not be buffered; it loads normally when its turn comes.
    case preloadFailed(String)
    /// The system took the audio (a call, an alarm, Siri) and paused it.
    case interruptionBegan
    /// The interruption is over; `shouldResume` when the system suggests playing on.
    case interruptionEnded(shouldResume: Bool)
    /// The route the sound went to went away (the headphones came out).
    case headphonesOut
}

@MainActor
protocol PlaybackEngine: AnyObject {
    var onEvent: ((EngineEvent) -> Void)? { get set }
    /// The app's own volume, 0…1, under the song's ReplayGain (the Mac's volume slider).
    var volume: Float { get set }
    /// Where the current song is, if one is loaded.
    var currentTime: Double? { get }

    /// Plays `item` from `seconds` (or holds it paused there), in place of anything loaded. The
    /// preloaded item, asked for from its start, takes over at once.
    func load(_ item: EngineItem, at seconds: Double, play: Bool)
    /// Buffers the song that plays next, for a gapless hand-over; nil drops the one buffered.
    func preload(_ item: EngineItem?)
    func play()
    func pause()
    func seek(to seconds: Double)
    /// Everything stops and unloads.
    func stop()
}
