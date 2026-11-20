import Foundation

// The calls the player makes (docs/api/openapi.yaml): a signed stream URL for each song, Navidrome's
// scrobbles, ECHO's own play history, and the queue that follows the user (`/me/queue`). EchoClient
// makes them in the apps; the tests and the preview have their own.

protocol PlaybackSource: Sendable {
    /// A stream URL AVPlayer opens without a header, signed for this song for 6 hours.
    func streamURL(for track: Track) async throws -> SignedStream
    /// The same at the quality chosen in Settings → Playback; a source that has one quality ignores it.
    func streamURL(for track: Track, quality: StreamQuality) async throws -> SignedStream
    /// Tells Navidrome a song is playing (`submission` false) or was played.
    func scrobble(id: String, submission: Bool) async throws
    /// A play for ECHO's history (Made For You, Jump back in, Wrapped).
    func recordPlay(_ track: Track, context: PlayContext?) async throws
    /// The queue as last saved, from any device.
    func savedQueue() async throws -> SavedQueue
    /// Saves the queue over the one last read (`base`, its `updatedAt`); the new `updatedAt`. A newer
    /// queue saved meanwhile by another device refuses it: `.server(status: 409, code: "changed_elsewhere")`.
    func saveQueue(_ queue: QueueState, positionMs: Double, base: Int) async throws -> Int
}

extension PlaybackSource {
    func streamURL(for track: Track, quality: StreamQuality) async throws -> SignedStream {
        try await streamURL(for: track)
    }
}

/// `GET /me/queue`: the queue (none yet: nil), where in its song, and when it was saved.
struct SavedQueue: Sendable, Equatable {
    var queue: QueueState?
    var positionMs: Double
    var updatedAt: Int
}

extension SavedQueue: Decodable {
    enum CodingKeys: String, CodingKey { case queue, positionMs, updatedAt }

    /// What another client saved is read as far as it can be: a queue that is not one is none.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        queue = try? c.decodeIfPresent(QueueState.self, forKey: .queue)
        // Any JSON number: the web saves a fraction of a millisecond.
        positionMs = max(0, (try? c.decodeIfPresent(Double.self, forKey: .positionMs)) ?? 0)
        updatedAt = c.number(.updatedAt) ?? 0
    }
}

extension EchoClient: PlaybackSource {
    /// At sign-in many requests go at once and the API budget may refuse the queue's: it is asked
    /// again after the server's Retry-After, more often and for longer waits than other reads (the
    /// web's queueSync gave up at the first 429, and that device's queue stopped following the user).
    static let queueRetries = 5
    static let queueWaitMax = 30

    func savedQueue() async throws -> SavedQueue {
        let raw = try await data("GET", "/me/queue", retries: Self.queueRetries, waitMax: Self.queueWaitMax)
        return try Self.decode(SavedQueue.self, from: raw)
    }

    private struct QueueBody: Encodable {
        let queue: QueueState
        let positionMs: Double
        let baseUpdatedAt: Int
    }

    private struct Updated: Decodable {
        let updatedAt: Int
    }

    func saveQueue(_ queue: QueueState, positionMs: Double, base: Int) async throws -> Int {
        let body = QueueBody(queue: queue, positionMs: max(0, positionMs.rounded()), baseUpdatedAt: base)
        return try await send("PUT", "/me/queue", json: body, as: Updated.self).updatedAt
    }

    private struct Play: Encodable {
        let track: Track
        let context: PlayContext?
    }

    func recordPlay(_ track: Track, context: PlayContext?) async throws {
        let body: Data
        do { body = try JSONEncoder().encode(Play(track: track, context: context)) } catch { throw ApiError.badResponse }
        _ = try await data("POST", "/me/plays", body: body)
    }
}
