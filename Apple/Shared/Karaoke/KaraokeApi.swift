import Foundation

// The server's Karaoke calls (docs/KARAOKE.md, docs/api/openapi.yaml): a song's karaoke version (asking
// for it queues it, or moves it up), the server's progress through the library, and the audio, a 5.1
// file with the instrumental in front and the vocals behind. `/karaoke/ready` (Home's shelf) is in
// Feeds.swift. EchoClient makes the calls in the app; the tests and the preview have their own.

/// What the server says about a song's karaoke version.
struct KaraokeAnswer: Equatable, Sendable {
    enum Status: String, Sendable {
        /// No stem service on the server.
        case off
        case queued, working, ready, failed
        /// Longer than the server's limit (`ECHO_STEMS_MAX_MINUTES`).
        case skipped
    }

    var status: Status
    /// Songs before it, while it is queued or working.
    var ahead: Int
    /// The audio, once ready: a server path.
    var url: String?
}

extension KaraokeAnswer: Decodable {
    enum CodingKeys: String, CodingKey { case status, ahead, url }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decode(String.self, forKey: .status)
        // A state from a newer server is one that is not ready yet.
        status = Status(rawValue: raw) ?? .queued
        ahead = max(0, c.number(.ahead) ?? 0)
        url = try? c.decodeIfPresent(String.self, forKey: .url)
    }
}

/// `GET /karaoke`: the server's progress (Settings → Karaoke).
struct KaraokeProgress: Equatable, Sendable {
    /// False when no stem service is configured.
    var enabled: Bool
    /// The stem service answered.
    var online: Bool
    var ready: Int
    var queued: Int
    var failed: Int
    var skipped: Int
    /// What the versions take on the stem service's disk.
    var bytes: Int

    /// Every song the server knows of.
    var total: Int { ready + queued + failed + skipped }
}

extension KaraokeProgress: Decodable {
    enum CodingKeys: String, CodingKey { case enabled, online, ready, queued, failed, skipped, bytes }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
        online = (try? c.decodeIfPresent(Bool.self, forKey: .online)) ?? false
        ready = c.number(.ready) ?? 0
        queued = c.number(.queued) ?? 0
        failed = c.number(.failed) ?? 0
        skipped = c.number(.skipped) ?? 0
        bytes = c.number(.bytes) ?? 0
    }
}

protocol KaraokeSource: Sendable {
    /// The song's karaoke version; asking queues it. `soon`: a song coming up in the queue, which waits
    /// behind those asked for now.
    func karaoke(id: String, soon: Bool) async throws -> KaraokeAnswer
    func karaokeProgress() async throws -> KaraokeProgress
}

extension EchoClient: KaraokeSource {
    func karaoke(id: String, soon: Bool) async throws -> KaraokeAnswer {
        try await get("/karaoke/\(Self.encode(id))", query: soon ? [("soon", "1")] : [])
    }

    func karaokeProgress() async throws -> KaraokeProgress {
        try await get("/karaoke")
    }

    /// The karaoke audio at a server path, in a file of this device's caches (the audio engine plays
    /// files, not URLs): the file is kept for the song's key until `forget` or the next launch.
    func karaokeFile(at path: String, key: String) async throws -> URL {
        let data = try await fetch(path)
        let folder = KaraokeFiles.folder
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(KaraokeFiles.name(key))
        try data.write(to: file, options: .atomic)
        return file
    }
}

/// Where the karaoke files are kept: this device's temporary folder, emptied at launch.
enum KaraokeFiles {
    static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("echo-karaoke", isDirectory: true)
    }

    /// A file name for a track key ("navidrome:al-1-t1"): letters, digits and dashes only.
    static func name(_ key: String) -> String {
        let safe = key.map { $0.isLetter || $0.isNumber || $0 == "-" ? String($0) : "_" }.joined()
        return safe + ".m4a"
    }

    /// Removes every file but those of `keep` (the song playing and the one next).
    static func prune(keeping keep: Set<String>) {
        let names = Set(keep.map(name))
        let files = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        for file in files where !names.contains(file) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(file))
        }
    }
}
