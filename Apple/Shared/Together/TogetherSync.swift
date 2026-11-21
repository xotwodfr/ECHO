import Foundation

// Listen together's arithmetic (src/client/together/sync.ts, Android's together/Sync.kt;
// docs/TOGETHER.md), apart from the network and the player so it is tested on its own: the server's
// clock as seen from here, where the song should be, and what the local player has to do to be there.
// Times are milliseconds.

enum TogetherTiming {
    /// Further apart than this, the player seeks back into step.
    static let drift = 300.0
    /// After a correction, the player gets this long to settle before the next one.
    static let settle = 2500.0
    /// This close to the end, a player that stopped is not started again.
    static let endSlack = 2000.0
    /// Time to load a song before it has to play (a cue ahead of the session).
    static let lead = 1500.0
}

/// The server's clock from this device: offset = server time − local time. An answer to a request
/// sent at `sentAt` and received at `receivedAt` was stamped within that window, so the midpoint is
/// right to within half the round trip; the sample with the shortest round trip of the recent ones
/// wins. A pushed event (no request) only says the offset is at least `serverTime − receivedAt` (it
/// took some time to arrive), which corrects an estimate that was too low.
struct ClockSync: Equatable, Sendable {
    private var samples: [(offset: Double, rtt: Double)] = []
    private(set) var offset: Double? = nil
    let keep: Int

    init(keep: Int = 8) { self.keep = keep }

    static func == (a: ClockSync, b: ClockSync) -> Bool { a.offset == b.offset && a.samples.count == b.samples.count }

    /// An answer to a request (the first fetch, polling).
    mutating func request(serverTime: Double, sentAt: Double, receivedAt: Double) {
        let rtt = max(0, receivedAt - sentAt)
        samples.append((serverTime - (sentAt + receivedAt) / 2, rtt))
        if samples.count > keep { samples.removeFirst(samples.count - keep) }
        offset = samples.min { $0.rtt < $1.rtt }?.offset
    }

    /// A pushed event: the offset is at least `serverTime − receivedAt`.
    mutating func pushed(serverTime: Double, receivedAt: Double) {
        let low = serverTime - receivedAt
        if let offset, low <= offset { return }
        offset = low
    }

    /// Server time for a local time (the offset is 0 until the first sample).
    func toServer(_ local: Double) -> Double { local + (offset ?? 0) }
}

extension TogetherState {
    /// Where the song should be at server time `serverNow`: from when it started while playing, where
    /// it stays while paused; never past the song.
    func expectedPosition(at serverNow: Double) -> Double {
        let duration = Double(now?.track.durationMs ?? 0)
        let raw: Double
        if playing, let startedAt {
            raw = serverNow - startedAt
        } else if playing {
            raw = positionMs + (serverNow - serverTime)
        } else {
            raw = positionMs
        }
        let top = duration > 0 ? duration : Double.infinity
        return max(0, min(raw, top))
    }
}

/// Where the session is: the song, whether it plays, and where.
struct TogetherTarget: Equatable, Sendable {
    var trackId: String?
    var playing: Bool
    var positionMs: Double
    var durationMs: Double
}

/// Where this player is.
struct TogetherLocal: Equatable, Sendable {
    /// The song loaded here (its Navidrome id), or nil.
    var trackId: String?
    /// Playing or about to (loading, buffering).
    var active: Bool
    /// Still loading: no position to compare yet.
    var loading: Bool
    /// What is heard (the audio's latency taken off).
    var positionMs: Double
}

/// What the local player does to follow the session.
enum TogetherStep: Equatable, Sendable {
    case load(positionMs: Double, play: Bool)
    case seek(positionMs: Double)
    case play
    case pause(positionMs: Double)
    case stop
}

enum TogetherPlan {
    /// Close enough while paused: within the drift.
    private static func near(_ local: Double, _ target: Double) -> Bool {
        abs(local - target) <= TogetherTiming.drift
    }

    /// What the local player does to follow the session: load the session's song at its position, play
    /// or pause with it, or seek when it has drifted more than 300 ms. `settling`: a correction is
    /// still taking effect (no seek on top of a seek).
    static func step(_ target: TogetherTarget, _ local: TogetherLocal, settling: Bool = false) -> TogetherStep? {
        guard target.trackId != nil else { return local.trackId != nil && local.active ? .stop : nil }
        if local.trackId != target.trackId { return .load(positionMs: target.positionMs, play: target.playing) }
        if local.loading { return nil }
        if !target.playing {
            return local.active || !near(local.positionMs, target.positionMs) ? .pause(positionMs: target.positionMs) : nil
        }
        // The song ended here a moment early (or is about to): wait for the session to move on, rather
        // than start it again.
        let ending = target.durationMs > 0 && target.positionMs >= target.durationMs - TogetherTiming.endSlack
        let far = abs(local.positionMs - target.positionMs) > TogetherTiming.drift
        // Stopped somewhere else (paused, say): moved first, then played.
        if !local.active {
            if ending { return nil }
            return far ? .seek(positionMs: target.positionMs) : .play
        }
        if ending && target.positionMs >= target.durationMs { return nil }
        if settling { return nil }
        return far ? .seek(positionMs: target.positionMs) : nil
    }

    /// Where to cue the song so it starts in step: `lead` ahead of `positionMs`, and how long to wait
    /// before playing it. Near the end there is no room: the song starts where it is.
    static func cue(positionMs: Double, durationMs: Double) -> (atMs: Double, waitMs: Double) {
        let at = positionMs + TogetherTiming.lead
        if durationMs > 0, at >= durationMs - 1000 { return (positionMs, 0) }
        return (at, TogetherTiming.lead)
    }
}

/// The session a scanned code or an opened link names: `<origin>/together/<id>` for this server, or
/// `echo://together/<id>` (also `echo://together#<id>`).
enum TogetherLink {
    /// The ids the server makes (18 random bytes, base64url) and accepts.
    static func isId(_ s: String) -> Bool {
        (16...64).contains(s.count) && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    /// The id in an https link for this server, or in the app's own link; nil for anything else.
    static func id(in text: String, server: URL) -> String? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased() else { return nil }
        if scheme == "echo" {
            let parts = ((url.host().map { [$0] } ?? []) + url.path(percentEncoded: false).split(separator: "/").map(String.init))
            guard parts.first?.lowercased() == "together" else { return nil }
            let id = url.fragment(percentEncoded: false) ?? parts.dropFirst().first
            return id.flatMap { isId($0) ? $0 : nil }
        }
        guard scheme == "https" || scheme == "http", let host = url.host()?.lowercased() else { return nil }
        let same = host == server.host()?.lowercased() && scheme == server.scheme?.lowercased()
            && (url.port ?? (scheme == "https" ? 443 : 80)) == (server.port ?? (server.scheme == "https" ? 443 : 80))
        guard same else { return nil }
        let path = url.path(percentEncoded: false).split(separator: "/").map(String.init)
        guard path.count == 2, path[0] == "together", isId(path[1]) else { return nil }
        return path[1]
    }

    /// Whether the text is a Listen together link of any server (for the right note: "another ECHO").
    static func host(of text: String) -> String? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""), let host = url.host()?.lowercased()
        else { return nil }
        let path = url.path(percentEncoded: false).split(separator: "/").map(String.init)
        return path.count == 2 && path[0] == "together" && isId(path[1]) ? host : nil
    }

    /// The app's own link for a session.
    static func url(id: String) -> URL { URL(string: "echo://together/\(id)")! }
}
