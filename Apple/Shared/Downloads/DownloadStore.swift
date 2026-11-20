import CryptoKit
import Foundation

// The downloads on disk, in the app's container and not in Caches (the system may empty Caches, and
// a download is the user's choice): Application Support/Downloads, marked as excluded from backups
// (the songs can be fetched again). Songs in `tracks/`, covers in `covers/`, the index as
// `index.json`, and `staging/` where the system's finished downloads wait to be moved into place.
// Files go in whole (moved, never written in place), so a file that is here is a finished one.

final class DownloadStore: @unchecked Sendable {
    let directory: URL
    private let lock = NSLock()

    static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Downloads", isDirectory: true)
    }

    init(directory: URL = DownloadStore.defaultDirectory) {
        self.directory = directory
        let manager = FileManager.default
        for folder in [directory, tracksDirectory, coversDirectory, stagingDirectory] {
            try? manager.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        var root = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? root.setResourceValues(values)
    }

    var tracksDirectory: URL { directory.appendingPathComponent("tracks", isDirectory: true) }
    var coversDirectory: URL { directory.appendingPathComponent("covers", isDirectory: true) }
    var stagingDirectory: URL { directory.appendingPathComponent("staging", isDirectory: true) }
    private var indexFile: URL { directory.appendingPathComponent("index.json", isDirectory: false) }

    /// A file name for any id: the id hashed.
    private static func name(_ id: String) -> String {
        SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func trackFile(_ id: String) -> URL {
        tracksDirectory.appendingPathComponent(Self.name(id) + ".mp3", isDirectory: false)
    }

    func coverFile(_ id: String) -> URL {
        coversDirectory.appendingPathComponent(Self.name(id) + ".jpg", isDirectory: false)
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    /// The song's file, if it is here.
    func existingTrack(_ id: String) -> URL? {
        let url = trackFile(id)
        return exists(url) ? url : nil
    }

    /// A cover's bytes by its server path ("/api/v1/navidrome/cover/al-1?size=300"), if it is here.
    func coverData(path: String) -> Data? {
        guard let id = DownloadIndex.coverId(path) else { return nil }
        return try? Data(contentsOf: coverFile(id))
    }

    func size(of url: URL) -> Int {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        return values?.fileSize ?? 0
    }

    // MARK: - The index

    func readIndex() -> DownloadIndex {
        lock.withLock {
            guard let data = try? Data(contentsOf: indexFile),
                  let index = try? JSONDecoder().decode(DownloadIndex.self, from: data)
            else { return DownloadIndex() }
            return index
        }
    }

    func writeIndex(_ index: DownloadIndex) {
        lock.withLock {
            guard let data = try? JSONEncoder().encode(index) else { return }
            try? data.write(to: indexFile, options: .atomic)
        }
    }

    // MARK: - Files

    /// Moves a finished download into place (in place of one that was there); its size, or nil when
    /// it could not be moved.
    func install(_ staged: URL, track id: String) -> Int? { place(staged, at: trackFile(id)) }
    func install(_ staged: URL, cover id: String) -> Int? { place(staged, at: coverFile(id)) }

    private func place(_ staged: URL, at url: URL) -> Int? {
        lock.withLock {
            let manager = FileManager.default
            let size = self.size(of: staged)
            try? manager.removeItem(at: url)
            do {
                try manager.moveItem(at: staged, to: url)
                return size
            } catch {
                return nil
            }
        }
    }

    func discard(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    func remove(tracks: [String], covers: [String]) {
        lock.withLock {
            for id in tracks { try? FileManager.default.removeItem(at: trackFile(id)) }
            for id in covers { try? FileManager.default.removeItem(at: coverFile(id)) }
        }
    }

    /// Everything: the files, the index, whatever was waiting in staging.
    func removeAll() {
        lock.withLock {
            let manager = FileManager.default
            for folder in [tracksDirectory, coversDirectory, stagingDirectory] {
                for url in (try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] {
                    try? manager.removeItem(at: url)
                }
            }
            try? manager.removeItem(at: indexFile)
        }
    }

    /// What the song and cover files on disk weigh.
    var bytes: Int {
        lock.withLock {
            var total = 0
            for folder in [tracksDirectory, coversDirectory] {
                for url in (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey])) ?? [] {
                    total += size(of: url)
                }
            }
            return total
        }
    }

    /// The finished songs and covers on disk, by id, with their sizes, for the ones given: what the
    /// index can be made right with after a crash between a file's move and the index's write.
    func present(tracks: Set<String>, covers: Set<String>) -> (tracks: [String: Int], covers: [String: Int]) {
        lock.withLock {
            var t: [String: Int] = [:], c: [String: Int] = [:]
            for id in tracks where exists(trackFile(id)) { t[id] = size(of: trackFile(id)) }
            for id in covers where exists(coverFile(id)) { c[id] = size(of: coverFile(id)) }
            return (t, c)
        }
    }
}
