import Foundation

// Animated lock-screen covers (docs/MOTION.md; docs/api/openapi.yaml, `/motion`): ECHO makes a short
// looping video of an album's cover the first time it is asked for (or converts the video an admin
// uploaded for the album), tall (3:4) and square, each with its first frame as a still. Asking
// queues it: the answer is 202 with Retry-After until it is ready, then the video's and the still's
// paths. The server picks the motion (Depth for photographs, Living light for flat art); the app
// picks only the shape and the loop's length (Settings → Lock screen).

/// The two frames the lock screen takes.
enum MotionShape: String, CaseIterable, Codable, Sendable {
    /// 3:4, 1080 × 1440: the lock screen's full-screen artwork (the whole tall frame moves).
    case tall
    /// 1:1, 1080 × 1080: the whole cover.
    case square
}

/// The loop's length, the lock screen's speed in Settings: the server's lengths (LOOPS in
/// src/server/motion.ts, `loops` in GET /motion), 8 s by default. Each is its own cover on the
/// server and here; an admin's uploaded video plays at its own length whatever this says.
enum LoopSpeed: Int, CaseIterable, Codable, Identifiable, Sendable {
    case fast = 5
    case normal = 8
    case slow = 12
    case slower = 15

    static let standard = LoopSpeed.normal

    var id: Int { rawValue }
    var seconds: Int { rawValue }

    var label: String {
        switch self {
        case .fast: "Fast"
        case .normal: "Normal"
        case .slow: "Slow"
        case .slower: "Very slow"
        }
    }
}

/// A motion cover the server has ready (200 `status: ready`): its files' server paths, and the
/// version they are (it changes when the cover is made again or replaced, an upload say).
struct MotionReady: Decodable, Equatable, Sendable {
    /// "upload" (an admin's video) or "generated".
    var source: String?
    /// "depth", "light" (Living light) or "video" (an upload).
    var style: String?
    /// The loop's length; an upload's own.
    var seconds: Double?
    var version: String
    /// `/api/v1/motion/{album}/video?shape=…&loop=…`: the MP4.
    var video: String
    /// Its first frame, a JPEG.
    var still: String
}

/// What `GET /motion/{album}?shape&loop` answers.
enum MotionAnswer: Equatable, Sendable {
    case ready(MotionReady)
    /// Queued or being made (202): ask again after `retryAfter` seconds; `ahead` covers come first.
    case pending(retryAfter: Int, ahead: Int)
    /// Too many of this user's covers are waiting, or the API budget is spent (429): ask again
    /// after `retryAfter` seconds.
    case busy(retryAfter: Int)
    /// It could not be made (no cover, an upload the service refused): the still cover stays.
    case failed
    /// This ECHO has no motion service: the still cover stays.
    case off
}

/// A ready cover's file was asked for and the server is making it again (evicted since): 202.
struct MotionNotReady: Error, Equatable {
    let retryAfter: Int
}

/// The calls the motion covers make; EchoClient in the apps, a stand-in in the tests and the preview.
protocol MotionSource: Sendable {
    /// The album's motion cover at this shape and loop length (asking queues it).
    func motion(album: String, shape: MotionShape, loop: Int) async throws -> MotionAnswer
    /// A ready cover's video or still, by the server path the ready answer gave.
    func motionFile(_ path: String) async throws -> Data
}

extension EchoClient: MotionSource {
    private struct Status: Decodable {
        var status: String?
        var ahead: Int?
        var retryAfter: Int?
    }

    /// When nothing says how long to wait.
    static let motionDefaultWait = 15

    func motion(album: String, shape: MotionShape, loop: Int) async throws -> MotionAnswer {
        // A 429 here is an answer too (too many covers waiting): the scheduler waits it out, so the
        // client does not wait inside the call.
        let (data, res) = try await answer(
            "GET", "/motion/\(Self.encode(album))", query: [("shape", shape.rawValue), ("loop", String(loop))],
            retries: 0, accepting: [429])
        let body = try? JSONDecoder().decode(Status.self, from: data)
        let wait = Self.retryAfter(res) ?? body?.retryAfter ?? Self.motionDefaultWait
        if res.statusCode == 429 { return .busy(retryAfter: wait) }
        switch body?.status {
        case "ready":
            return try .ready(Self.decode(MotionReady.self, from: data))
        case "queued", "working":
            return .pending(retryAfter: wait, ahead: body?.ahead ?? 0)
        case "failed": return .failed
        case "off": return .off
        default: throw ApiError.badResponse
        }
    }

    func motionFile(_ path: String) async throws -> Data {
        // Only ECHO's own motion files, which go with the bearer header.
        guard path.hasPrefix("/api/v1/motion/") else { throw ApiError.badResponse }
        let (data, res) = try await fetchAnswer(path)
        switch res.statusCode {
        case 200: return data
        case 202:
            let body = try? JSONDecoder().decode(Status.self, from: data)
            throw MotionNotReady(retryAfter: Self.retryAfter(res) ?? body?.retryAfter ?? Self.motionDefaultWait)
        default: throw ApiError(status: res.statusCode, code: nil, message: nil, signingIn: false)
        }
    }

    /// The Retry-After header in seconds, if it is one.
    static func retryAfter(_ res: HTTPURLResponse) -> Int? {
        res.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    }
}
