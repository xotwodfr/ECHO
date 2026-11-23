import Foundation

// ECHO's own routes the apps use (docs/api/openapi.yaml): the device sign-in and sign-out, who is
// signed in, the preferences that follow the user, the health check, signed stream URLs and covers.

extension EchoClient {
    private struct DeviceSignIn: Encodable {
        let username: String
        let password: String
        /// Left out when empty: the server answers `totp_required` to an account with two-factor.
        let code: String?
        let name: String
    }

    private struct DeviceToken: Decodable {
        let token: String
    }

    /// A device token for this device (SETTINGS_AND_SECURITY.md §4.6): the username, the password
    /// and, with two-factor on, the authenticator or recovery code, in one request. The token is
    /// shown once; the device is listed by `deviceName` in Sessions & devices.
    func signIn(username: String, password: String, code: String?, deviceName: String) async throws -> String {
        let code = code.map { $0.filter { !$0.isWhitespace } } ?? ""
        let answer = try await send(
            "POST", Self.signInPath,
            json: DeviceSignIn(
                username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password,
                code: code.isEmpty ? nil : code, name: String(deviceName.prefix(64))),
            as: DeviceToken.self)
        guard answer.token.hasPrefix("echo_dt_") else { throw ApiError.badResponse }
        return answer.token
    }

    /// Ends this device's session on the server: it leaves Settings → Account → Sessions & devices.
    func signOut() async throws {
        _ = try await data("POST", "/auth/logout", body: Data("{}".utf8))
    }

    func me() async throws -> Account {
        try await get("/me")
    }

    /// The preferences that follow the user (SETTINGS_AND_SECURITY.md §7.1).
    func settings() async throws -> UserSettings {
        try await get("/me/settings")
    }

    /// Changes preferences: `patch` holds only the keys that change (UserSettings.patch(from:)).
    /// The server refuses an unknown key or value (400) and answers with everything as saved.
    func updateSettings(_ patch: Data) async throws -> UserSettings {
        let raw = try await data("PUT", "/me/settings", body: patch)
        return try Self.decode(UserSettings.self, from: raw)
    }

    /// ECHO's health check: any answer at all tells the client ECHO is reachable.
    func health() async throws {
        _ = try await data("GET", "/health")
    }

    private struct StreamURL: Decodable {
        let url: String
        let expiresAt: Double
    }

    /// AVPlayer's own formats play as stored (seeking over Range); anything else (Opus, Ogg…) comes
    /// from Navidrome as MP3, 320 kbps (the baseline's rule, README.md).
    static let playableSuffixes: Set<String> = ["mp3", "m4a", "m4b", "aac", "alac", "flac", "wav", "aif", "aiff", "caf"]
    static let playableTypes: Set<String> = [
        "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/flac",
        "audio/x-flac", "audio/wav", "audio/x-wav", "audio/wave", "audio/aiff", "audio/x-aiff", "audio/x-caf",
    ]

    static func playsAsStored(_ track: Track) -> Bool {
        if let suffix = track.suffix?.lowercased(), !suffix.isEmpty { return playableSuffixes.contains(suffix) }
        if let type = track.contentType?.lowercased().split(separator: ";").first {
            return playableTypes.contains(type.trimmingCharacters(in: .whitespaces))
        }
        return false
    }

    /// A signed stream URL for a song (6 h, this song and user only) that AVPlayer opens without a
    /// header (`/navidrome/stream-url/:id`).
    func streamURL(for track: Track) async throws -> SignedStream {
        try await streamURL(for: track, quality: .auto)
    }

    /// What a song is asked for at `quality`: as stored where it plays and the quality is Auto,
    /// else MP3 at the bit rate (320 kbit/s for Auto).
    static func streamFormat(for track: Track, quality: StreamQuality) -> [(String, String)] {
        if quality.bitRate == nil, playsAsStored(track) { return [("format", "raw")] }
        return [
            ("format", "mp3"), ("maxBitRate", String(quality.bitRate ?? 320)), ("estimateContentLength", "true"),
        ]
    }

    func streamURL(for track: Track, quality: StreamQuality) async throws -> SignedStream {
        let answer: StreamURL = try await get("/navidrome/stream-url/\(Self.encode(track.id))")
        let format = Self.streamFormat(for: track, quality: quality)
        let joiner = answer.url.contains("?") ? "&" : "?"
        guard answer.url.hasPrefix("/api/v1/navidrome/stream/"),
              let stream = self.url(answer.url + joiner + Self.formEncoded(format))
        else { throw ApiError.badResponse }
        return SignedStream(url: stream, expiresAt: Date(timeIntervalSince1970: answer.expiresAt / 1000))
    }

    /// A cover's URL (`/navidrome/cover/:id`), which needs the bearer header: load it with
    /// coverData(id:size:) or authorized(_:).
    func coverURL(id: String, size: Int = 600) -> URL? {
        Subsonic.cover(id, size: min(2048, max(16, size))).flatMap { self.url($0) }
    }

    /// A cover's image bytes (raster images only; ECHO caches them privately for a week).
    func coverData(id: String, size: Int = 600) async throws -> Data {
        try await data("GET", "/navidrome/cover/\(Self.encode(id))", query: [("size", String(min(2048, max(16, size))))])
    }
}
