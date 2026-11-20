import CryptoKit
import Foundation

// The motion covers on disk, in their own folder in Caches (the system may empty it when space runs
// low), so an album's next play shows its cover at once: for each album, shape and loop length its
// video (an MP4 the lock screen plays from its file URL), its still (the first frame, a JPEG) and a
// note of the version they are. The least recently used go first once they weigh more than the
// limit; signing out empties the folder, as it does the covers' (ImageLoader).

/// Which cover: an album (its Navidrome id), a shape and a loop length.
struct MotionKey: Hashable, Sendable {
    let album: String
    let shape: MotionShape
    let loop: Int

    /// The files' name: the key hashed, so any album id makes a file name.
    var name: String {
        SHA256.hash(data: Data("\(album)|\(shape.rawValue)|\(loop)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// What is known of a downloaded cover.
struct MotionNote: Codable, Equatable, Sendable {
    /// The server's version of it (MotionReady.version).
    var version: String
    var seconds: Double?
    var style: String?
    var source: String?
    /// When the server last said this was its version.
    var checkedAt: Date
}

/// A downloaded cover: its note, and its files.
struct MotionFile: Equatable, Sendable {
    let note: MotionNote
    let video: URL
    let still: URL
}

final class MotionFiles: @unchecked Sendable {
    let directory: URL
    let limit: Int
    private let now: @Sendable () -> Date
    private let lock = NSLock()

    static var defaultDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MotionCovers", isDirectory: true)
    }

    /// - Parameter limit: what the covers may weigh together, in bytes. A generated cover is about
    ///   0.3 MB a shape; an admin's upload, converted, a few MB.
    init(directory: URL = MotionFiles.defaultDirectory, limit: Int = 64 << 20, now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory
        self.limit = limit
        self.now = now
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func url(_ key: MotionKey, _ ext: String) -> URL {
        directory.appendingPathComponent("\(key.name).\(ext)", isDirectory: false)
    }

    /// The cover, if its video, still and note are all here.
    func file(_ key: MotionKey) -> MotionFile? {
        lock.withLock {
            let video = url(key, "mp4"), still = url(key, "jpg")
            let manager = FileManager.default
            guard manager.fileExists(atPath: video.path(percentEncoded: false)),
                  manager.fileExists(atPath: still.path(percentEncoded: false)),
                  let data = try? Data(contentsOf: url(key, "json")),
                  let note = try? JSONDecoder().decode(MotionNote.self, from: data)
            else { return nil }
            return MotionFile(note: note, video: video, still: still)
        }
    }

    /// Keeps a cover (in place of the one before it), then lets the least recently used go past the
    /// limit, never this one.
    @discardableResult
    func store(_ key: MotionKey, video: Data, still: Data, note: MotionNote) -> MotionFile? {
        lock.withLock {
            let json = url(key, "json")
            guard let encoded = try? JSONEncoder().encode(note),
                  (try? video.write(to: url(key, "mp4"), options: .atomic)) != nil,
                  (try? still.write(to: url(key, "jpg"), options: .atomic)) != nil,
                  (try? encoded.write(to: json, options: .atomic)) != nil
            else {
                remove(key)
                return nil
            }
            touch(json)
            trim(keeping: key.name)
            return MotionFile(note: note, video: url(key, "mp4"), still: url(key, "jpg"))
        }
    }

    /// The server said again that this is its version.
    func checked(_ key: MotionKey) {
        lock.withLock {
            let json = url(key, "json")
            guard let data = try? Data(contentsOf: json), var note = try? JSONDecoder().decode(MotionNote.self, from: data)
            else { return }
            note.checkedAt = now()
            if let encoded = try? JSONEncoder().encode(note) { try? encoded.write(to: json, options: .atomic) }
            touch(json)
        }
    }

    /// Marks a cover used now, for the order the trim lets them go in.
    func used(_ key: MotionKey) {
        lock.withLock { touch(url(key, "json")) }
    }

    func removeAll() {
        lock.withLock {
            let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            for url in files { try? FileManager.default.removeItem(at: url) }
        }
    }

    /// What the covers on disk weigh.
    var bytes: Int { lock.withLock { groups().reduce(0) { $0 + $1.size } } }

    /// The covers on disk (their names).
    var names: Set<String> { lock.withLock { Set(groups().map(\.name)) } }

    private func remove(_ key: MotionKey) {
        for ext in ["mp4", "jpg", "json"] { try? FileManager.default.removeItem(at: url(key, ext)) }
    }

    private func touch(_ url: URL) {
        try? FileManager.default.setAttributes([.modificationDate: now()], ofItemAtPath: url.path(percentEncoded: false))
    }

    /// Each cover's files together: its name, when its note was last touched, and its size.
    private func groups() -> [(name: String, used: Date, size: Int, urls: [URL])] {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey]
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))) ?? []
        var by: [String: (used: Date, size: Int, urls: [URL])] = [:]
        for url in urls {
            let name = url.deletingPathExtension().lastPathComponent
            let values = try? url.resourceValues(forKeys: keys)
            var group = by[name] ?? (used: Date.distantPast, size: 0, urls: [URL]())
            group.size += values?.fileSize ?? 0
            group.urls.append(url)
            if url.pathExtension == "json" { group.used = values?.contentModificationDate ?? .distantPast }
            by[name] = group
        }
        return by.map { (name: $0.key, used: $0.value.used, size: $0.value.size, urls: $0.value.urls) }
    }

    private func trim(keeping name: String) {
        var all = groups()
        var total = all.reduce(0) { $0 + $1.size }
        guard total > limit else { return }
        all.sort { $0.used < $1.used }
        for group in all where total > limit && group.name != name {
            for url in group.urls { try? FileManager.default.removeItem(at: url) }
            total -= group.size
        }
    }
}
