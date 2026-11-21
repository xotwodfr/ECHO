import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import Synchronization

// Covers through ECHO (`/navidrome/cover/:id`), which needs the bearer header that AsyncImage cannot
// send: loaded once, decoded off the main thread, kept in memory (the least recently used let go
// past a limit) and on disk in Caches (the same, by size), and asked for once however many views
// want the same cover at once. Each cover's colours light the room (AlbumPalette).

/// A decoded cover, and what it weighs in memory.
final class CoverImage: @unchecked Sendable {
    let cgImage: CGImage
    let bytes: Int

    init(_ cgImage: CGImage) {
        self.cgImage = cgImage
        bytes = cgImage.bytesPerRow * cgImage.height
    }

    /// An image file (JPEG, PNG, WebP…) decoded now rather than on its first draw; nil when it is
    /// not one (an error page, a broken answer).
    static func decode(_ data: Data) -> CoverImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(
                source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
        else { return nil }
        return CoverImage(image)
    }
}

/// The covers in memory, the least recently used let go first once they weigh more than `limit`.
struct MemoryCovers {
    let limit: Int
    private var entries: [String: (image: CoverImage, used: UInt64)] = [:]
    private var tick: UInt64 = 0
    private(set) var bytes = 0

    init(limit: Int) {
        self.limit = limit
    }

    var count: Int { entries.count }

    func contains(_ key: String) -> Bool { entries[key] != nil }

    mutating func get(_ key: String) -> CoverImage? {
        guard let entry = entries[key] else { return nil }
        tick += 1
        entries[key] = (entry.image, tick)
        return entry.image
    }

    mutating func put(_ key: String, _ image: CoverImage) {
        tick += 1
        if let old = entries[key] { bytes -= old.image.bytes }
        entries[key] = (image, tick)
        bytes += image.bytes
        while bytes > limit, entries.count > 1, let oldest = entries.min(by: { $0.value.used < $1.value.used }) {
            entries[oldest.key] = nil
            bytes -= oldest.value.image.bytes
        }
    }

    mutating func removeAll() {
        entries = [:]
        bytes = 0
    }
}

/// The covers on disk, in their own folder in Caches (the system may empty it when space runs
/// low), the least recently used deleted first once they weigh more than `limit`.
final class DiskCovers: @unchecked Sendable {
    let directory: URL
    let limit: Int
    private let now: @Sendable () -> Date
    private let lock = NSLock()

    static var defaultDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Covers", isDirectory: true)
    }

    init(directory: URL = DiskCovers.defaultDirectory, limit: Int = 256 << 20, now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory
        self.limit = limit
        self.now = now
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// A cover's file: its key hashed, so any path makes a file name.
    func file(_ key: String) -> URL {
        let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name, isDirectory: false)
    }

    func read(_ key: String) -> Data? {
        let url = file(key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        lock.withLock { touch(url) }
        return data
    }

    func write(_ data: Data, _ key: String) {
        lock.withLock {
            let url = file(key)
            guard (try? data.write(to: url, options: .atomic)) != nil else { return }
            touch(url)
            trim()
        }
    }

    func removeAll() {
        lock.withLock {
            let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            for url in files { try? FileManager.default.removeItem(at: url) }
        }
    }

    /// What the covers on disk weigh.
    var bytes: Int { lock.withLock { files().reduce(0) { $0 + $1.size } } }

    /// Marks a cover used now (its modification date), for the trim's order.
    private func touch(_ url: URL) {
        try? FileManager.default.setAttributes([.modificationDate: now()], ofItemAtPath: url.path(percentEncoded: false))
    }

    private func files() -> [(url: URL, used: Date, size: Int)] {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey]
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))) ?? []
        return urls.map { url in
            let values = try? url.resourceValues(forKeys: keys)
            return (url, values?.contentModificationDate ?? .distantPast, values?.fileSize ?? 0)
        }
    }

    private func trim() {
        var all = files()
        var total = all.reduce(0) { $0 + $1.size }
        guard total > limit else { return }
        all.sort { $0.used < $1.used }
        for file in all where total > limit {
            try? FileManager.default.removeItem(at: file.url)
            total -= file.size
        }
    }
}

/// Loads covers by their server path: from memory, else from disk, else from ECHO through `fetch`.
final class ImageLoader: Sendable {
    typealias Fetch = @Sendable (String) async throws -> Data

    private struct State {
        var memory: MemoryCovers
        var loading: [String: Task<CoverImage?, Never>] = [:]
        var palettes: [String: AlbumPalette] = [:]
    }

    private let fetch: Fetch
    private let disk: DiskCovers?
    private let state: Mutex<State>

    /// - Parameters:
    ///   - memoryLimit: what the decoded covers in memory may weigh, in bytes.
    ///   - disk: where covers are kept between launches; nil keeps them in memory only.
    init(fetch: @escaping Fetch, memoryLimit: Int = 96 << 20, disk: DiskCovers? = nil) {
        self.fetch = fetch
        self.disk = disk
        state = Mutex(State(memory: MemoryCovers(limit: memoryLimit)))
    }

    /// The app's loader: covers from the user's ECHO with its device token, kept in Caches.
    static func live(_ source: any LibrarySource) -> ImageLoader {
        ImageLoader(fetch: { try await source.coverBytes($0) }, disk: DiskCovers())
    }

    /// A cover already in memory, for a view's first frame (no flash of the placeholder).
    func cached(_ path: String) -> CoverImage? {
        state.withLock { $0.memory.get(path) }
    }

    /// Whether a cover is in memory, without counting as a use.
    func inMemory(_ path: String) -> Bool {
        state.withLock { $0.memory.contains(path) }
    }

    /// The cover at a server path; nil when there is none or it could not be loaded (it is asked
    /// for again the next time).
    func image(_ path: String) async -> CoverImage? {
        let task: Task<CoverImage?, Never>? = state.withLock { s in
            if s.memory.get(path) != nil { return nil }
            if let running = s.loading[path] { return running }
            let started = Task { await self.load(path) }
            s.loading[path] = started
            return started
        }
        guard let task else { return cached(path) }
        return await task.value
    }

    private func load(_ path: String) async -> CoverImage? {
        defer { state.withLock { _ = $0.loading.removeValue(forKey: path) } }
        if let data = disk?.read(path), let image = CoverImage.decode(data) {
            state.withLock { $0.memory.put(path, image) }
            return image
        }
        guard let data = try? await fetch(path), let image = CoverImage.decode(data) else { return nil }
        disk?.write(data, path)
        state.withLock { $0.memory.put(path, image) }
        return image
    }

    /// The colours of the cover at `path`, to light the room with (computed once per cover).
    func palette(_ path: String) async -> AlbumPalette? {
        if let known = state.withLock({ $0.palettes[path] }) { return known }
        guard let image = await image(path), let palette = AlbumPalette(image.cgImage) else { return nil }
        state.withLock { $0.palettes[path] = palette }
        return palette
    }

    /// Forgets every cover, here and on disk (signing out: the next account's library is another).
    func clear() {
        state.withLock {
            $0.memory.removeAll()
            $0.palettes = [:]
        }
        disk?.removeAll()
    }
}
