import Foundation

// The lyrics calls (docs/api/openapi.yaml): `GET /lyrics` for a track (the cache first, then the
// sources, with the user's override for it; a 404 lists the sources tried) and `PUT
// /me/tracks/{trackKey}/override` for the user's timing offset (±10 s) and source pin.

/// A change to the user's override for a track.
enum LyricsOverrideChange: Equatable, Sendable {
    /// How much later the words show, ms.
    case offset(Int)
    /// Always this source for the track; nil: automatic.
    case pin(String?)
}

/// Where the lyrics come from: ECHO (EchoClient), or the preview's built-in documents.
protocol LyricsSource: Sendable {
    func lyrics(for track: Track) async throws -> LyricsAnswer
    func saveOverride(trackKey: String, _ change: LyricsOverrideChange) async throws
}

extension EchoClient: LyricsSource {
    /// The track as the server looks it up: its key (the provider's id), and the metadata that is
    /// part of the shared cache key; the ISRC lets the server find a Spotify id for Spicy Lyrics.
    static func lyricsQuery(_ track: Track) -> [(String, String)] {
        var query = [
            ("trackKey", track.key), ("title", track.title), ("artist", track.artists.first?.name ?? ""),
            ("album", track.album.title), ("durationMs", String(track.durationMs)),
        ]
        if let isrc = track.isrc, !isrc.isEmpty { query.append(("isrc", isrc)) }
        return query
    }

    func lyrics(for track: Track) async throws -> LyricsAnswer {
        let raw = try await data("GET", "/lyrics", query: Self.lyricsQuery(track), accepting: [404])
        return try Self.decode(LyricsAnswer.self, from: raw)
    }

    func saveOverride(trackKey: String, _ change: LyricsOverrideChange) async throws {
        var body: [String: Any] = [:]
        switch change {
        case .offset(let ms):
            body["offsetMs"] = ms
        case .pin(let source):
            if let source { body["pinnedSource"] = source } else { body["pinnedSource"] = NSNull() }
        }
        let json = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        _ = try await data("PUT", "/me/tracks/\(Self.encode(trackKey))/override", body: json)
    }
}
