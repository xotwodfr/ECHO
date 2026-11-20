import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import os

/// The widget's folder in the App Group container: what plays (`now-playing.json`) and the playing
/// album's cover, small (a JPEG at most 400 px a side). Every file is written whole (atomically), so
/// the widget never reads half of one. Signing out empties it.
///
/// Without an App Group container (`directory` nil: a build whose entitlements the system did not
/// take, iOS/README.md) nothing is written and nothing is read: the widget shows nothing playing,
/// and the app plays on as before.
final class WidgetStore: @unchecked Sendable {
    let directory: URL?
    private let lock = NSLock()

    static let snapshotName = "now-playing.json"
    /// The cover's longest side, in pixels: the medium widget draws it 132 points wide, at 3x.
    static let coverSide = 400
    static let log = Logger(subsystem: "com.folk3s.echo", category: "widget")

    init(directory: URL?) {
        self.directory = directory
        if let directory { try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
    }

    /// The App Group's own folder, or none when the system gives the app no container for it.
    static func appGroup(
        _ group: String = WidgetShared.appGroup,
        container: (String) -> URL? = { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }
    ) -> WidgetStore {
        WidgetStore(directory: container(group)?.appendingPathComponent("Widget", isDirectory: true))
    }

    /// Whether there is a folder to write to: the App Group's container was given.
    var isAvailable: Bool { directory != nil }

    /// What plays, as the app last wrote it; nil when nothing plays, nothing was written, or there is
    /// no container.
    func read() -> WidgetSnapshot? {
        guard let file = file(Self.snapshotName) else { return nil }
        return lock.withLock {
            guard let data = try? Data(contentsOf: file) else { return nil }
            return try? Self.decoder.decode(WidgetSnapshot.self, from: data)
        }
    }

    /// Writes what plays (whole, in place of what was there); false when it could not be written.
    @discardableResult
    func write(_ snapshot: WidgetSnapshot) -> Bool {
        guard let file = file(Self.snapshotName), let data = try? Self.encoder.encode(snapshot) else { return false }
        return lock.withLock {
            do {
                try data.write(to: file, options: .atomic)
                return true
            } catch {
                Self.log.error("The widget's snapshot was not written: \(error.localizedDescription, privacy: .public)")
                return false
            }
        }
    }

    /// Nothing plays: the snapshot and the cover go.
    func clear() {
        guard let directory else { return }
        lock.withLock {
            let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            for url in files { try? FileManager.default.removeItem(at: url) }
        }
    }

    /// The cover for `id` (its server path), drawn small and kept as the only one; its file's name,
    /// or nil when there is no container or it could not be written.
    func storeCover(_ image: CGImage, for id: String) -> String? {
        guard let directory, let jpeg = WidgetCover.jpeg(image, side: Self.coverSide) else { return nil }
        let name = Self.coverName(id)
        return lock.withLock {
            guard (try? jpeg.write(to: directory.appendingPathComponent(name), options: .atomic)) != nil else { return nil }
            let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            for url in files where url.lastPathComponent.hasPrefix("cover-") && url.lastPathComponent != name {
                try? FileManager.default.removeItem(at: url)
            }
            return name
        }
    }

    /// A kept cover's file, if it is there.
    func coverURL(_ name: String) -> URL? {
        guard let url = file(name), FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return nil }
        return url
    }

    /// The files in the folder, by name (the tests').
    var fileNames: [String] {
        guard let directory else { return [] }
        return ((try? FileManager.default.contentsOfDirectory(atPath: directory.path(percentEncoded: false))) ?? []).sorted()
    }

    /// A cover's file name: its server path hashed, so any path makes one.
    static func coverName(_ id: String) -> String {
        "cover-" + SHA256.hash(data: Data(id.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined() + ".jpg"
    }

    private func file(_ name: String) -> URL? {
        directory?.appendingPathComponent(name, isDirectory: false)
    }

    private static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970
        return e
    }

    private static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return d
    }

    /// What this process is given for the App Group, for the log: its container and whether a file
    /// can be written, read back and removed there. Unsigned builds may get no container, or one
    /// the widget extension does not share (iOS/README.md says what the runner showed).
    static func describeAppGroup(
        _ group: String = WidgetShared.appGroup,
        container: (String) -> URL? = { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }
    ) -> String {
        guard let url = container(group) else { return "App Group \(group): no container" }
        let probe = url.appendingPathComponent("echo-probe-\(UUID().uuidString)")
        let written = (try? Data("probe".utf8).write(to: probe, options: .atomic)) != nil
        let read = written && (try? Data(contentsOf: probe)) == Data("probe".utf8)
        try? FileManager.default.removeItem(at: probe)
        return "App Group \(group): \(url.path(percentEncoded: false)) (\(read ? "writable" : "not writable"))"
    }
}

/// A cover drawn small for the widget: its longest side at most `side` pixels, as a JPEG.
enum WidgetCover {
    static func jpeg(_ image: CGImage, side: Int, quality: Double = 0.85) -> Data? {
        let scale = min(1, Double(side) / Double(max(1, max(image.width, image.height))))
        let width = max(1, Int((Double(image.width) * scale).rounded()))
        let height = max(1, Int((Double(image.height) * scale).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let small = context.makeImage() else { return nil }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, "public.jpeg" as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(
            destination, small, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }
}
