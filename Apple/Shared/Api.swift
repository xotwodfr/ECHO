import Foundation

// ECHO's API as the Apple clients use it (docs/api/openapi.yaml): a device token from
// POST /auth/device, sent as a bearer header (the server's Origin check exempts it), the
// allow-listed Subsonic proxy for the library, and signed stream URLs for AVPlayer, which sends no
// header of its own. Shared by iOS/ and macOS/.

/// An answer other than 2xx: the status and ECHO's error code (`{ "error": … }`), when it sent one.
struct ApiError: LocalizedError {
    let status: Int
    let code: String?
    /// 401: the token was revoked or expired, or the credentials were wrong.
    var signedOut: Bool { status == 401 }
    var errorDescription: String? { code ?? "HTTP \(status)" }
}

struct Album: Identifiable, Hashable {
    let id: String
    let name: String
    let artist: String
}

struct Song: Identifiable, Hashable {
    let id: String
    let title: String
    let artist: String
    let seconds: Int
    /// The file's type as Navidrome stores it ("flac", "mp3", "opus"…).
    let suffix: String
}

struct Api {
    let base: String
    var token: String?

    private func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: base + "/api/v1" + path) else { throw ApiError(status: 0, code: "bad URL") }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            throw ApiError(status: status, code: (json["error"] ?? json["code"]) as? String)
        }
        return json
    }

    /// A device token for this device: credentials and, with two-factor on, the code, in one go.
    func signIn(user: String, password: String, code: String, name: String) async throws -> String {
        var body: [String: Any] = ["username": user, "password": password, "name": name]
        let code = code.trimmingCharacters(in: .whitespaces)
        if !code.isEmpty { body["code"] = code }
        guard let token = try await send("POST", "/auth/device", body: body)["token"] as? String else {
            throw ApiError(status: 200, code: "no token in the answer")
        }
        return token
    }

    /// Ends this device's session on the server (Settings → Account → Sessions loses it).
    func signOut() async throws {
        _ = try await send("POST", "/auth/logout", body: [:])
    }

    private func subsonic(_ method: String, _ query: String) async throws -> [String: Any] {
        let answer = try await send("GET", "/navidrome/rest/\(method)?\(query)")
        let r = answer["subsonic-response"] as? [String: Any] ?? [:]
        guard r["status"] as? String == "ok" else {
            let message = (r["error"] as? [String: Any])?["message"] as? String
            throw ApiError(status: 502, code: message ?? "Navidrome refused")
        }
        return r
    }

    func albums() async throws -> [Album] {
        let r = try await subsonic("getAlbumList2", "type=alphabeticalByName&size=500")
        let list = (r["albumList2"] as? [String: Any])?["album"] as? [[String: Any]] ?? []
        return list.map { Album(id: text($0["id"]), name: text($0["name"]), artist: text($0["artist"])) }
    }

    func songs(album: String) async throws -> [Song] {
        let r = try await subsonic("getAlbum", "id=\(encoded(album))")
        let list = (r["album"] as? [String: Any])?["song"] as? [[String: Any]] ?? []
        return list.map {
            Song(id: text($0["id"]), title: text($0["title"]), artist: text($0["artist"]),
                 seconds: $0["duration"] as? Int ?? 0, suffix: text($0["suffix"]).lowercased())
        }
    }

    /// AVPlayer's own formats play as stored (seeking over Range); anything else (Opus, Ogg…) comes
    /// from Navidrome as MP3, 320 kbps.
    private static let playable: Set<String> = ["mp3", "m4a", "m4b", "aac", "flac", "wav", "aif", "aiff", "caf"]

    /// A signed stream URL (6 h, this song only) AVPlayer opens without a header.
    func streamURL(song: Song) async throws -> URL {
        let format = Self.playable.contains(song.suffix)
            ? "&format=raw" : "&format=mp3&maxBitRate=320&estimateContentLength=true"
        guard let path = try await send("GET", "/navidrome/stream-url/\(encoded(song.id))")["url"] as? String,
              let url = URL(string: base + path + format)
        else { throw ApiError(status: 200, code: "no stream URL") }
        return url
    }
}

private func text(_ v: Any?) -> String {
    switch v {
    case let s as String: s
    case nil: ""
    case let other?: "\(other)"
    }
}

/// Percent-encodes an id for a path or query (Navidrome ids are usually plain, but need not be).
private func encoded(_ s: String) -> String {
    s.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s
}
