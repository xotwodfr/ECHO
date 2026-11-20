import Foundation

// When a song counts as played, as the web decides it: Navidrome's scrobbles (src/client/playback/
// navidrome.ts, §5.7) and ECHO's own history (src/client/shell/mixes.ts); and ReplayGain as the
// web applies it (src/client/playback/audio.ts).

/// Navidrome's scrobbles for one play of a song: "now playing" once it plays, then "played" once
/// half of it, or four minutes, have played.
struct Scrobbles: Equatable, Sendable {
    enum Stage: Equatable, Sendable { case none, nowPlaying, played }

    /// Played once this much has played, whatever the song's length (Last.fm's rule).
    static let point: Double = 4 * 60

    private(set) var stage = Stage.none

    /// What to send now, while the song plays at `seconds`: `false` for now playing, `true` for
    /// played (both at once for a start past the point).
    mutating func update(at seconds: Double, duration: Double) -> [Bool] {
        var send: [Bool] = []
        if stage == .none {
            stage = .nowPlaying
            send.append(false)
        }
        if stage == .nowPlaying, seconds >= duration / 2 || seconds >= Self.point {
            stage = .played
            send.append(true)
        }
        return send
    }
}

/// ECHO's play history: a Navidrome song of 30 seconds or more, played to Navidrome's scrobble
/// point, is one play; the same song again from its start (repeat, Previous) is another.
struct PlayHistory: Equatable, Sendable {
    /// Shorter songs are not counted (Last.fm's rule too).
    static let shortest: Double = 30
    /// A step back further than this is the song starting again (the web's two 5-second ticks).
    static let restart: Double = 10

    private var key: String? = nil
    private var last: Double = 0
    private var counted = false

    /// Whether to record a play now, as `track` plays at `seconds`.
    mutating func update(track: Track, at seconds: Double, duration: Double) -> Bool {
        if track.key != key || seconds < last - Self.restart {
            key = track.key
            counted = false
        }
        last = seconds
        guard !counted, track.provider == "navidrome", duration >= Self.shortest else { return false }
        guard seconds >= min(duration / 2, Scrobbles.point) else { return false }
        counted = true
        return true
    }
}

extension ReplayGain {
    /// ReplayGain in dB as a linear gain, held so the peak stays under full scale; unknown: unity.
    static func linear(_ db: Double?, peak: Double?) -> Double {
        let gain = db.map { pow(10, $0 / 20) } ?? 1
        if let peak, peak > 0 { return min(gain, 1 / peak) }
        return gain
    }

    /// The volume a song plays at (Settings → Playback → ReplayGain): album gain within an album
    /// (`auto`), which keeps an album's own dynamics, else track gain, which evens out a mix. AVPlayer
    /// can turn a song down, not up past how it was recorded.
    static func volume(_ gain: ReplayGain?, mode: UserSettings.ReplayGainMode, inAlbum: Bool) -> Float {
        let album = mode == .album || (mode == .auto && inAlbum)
        let linear: Double
        switch mode {
        case .off:
            linear = 1
        case .track, .album, .auto:
            if album, let albumGain = gain?.albumGain {
                linear = Self.linear(albumGain, peak: gain?.albumPeak)
            } else {
                linear = Self.linear(gain?.trackGain, peak: gain?.trackPeak)
            }
        }
        return Float(min(1, max(0, linear)))
    }
}
