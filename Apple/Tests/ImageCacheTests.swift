import CoreGraphics
import Foundation
import ImageIO
import Testing

// Covers through ECHO (`/navidrome/cover/:id`), which needs the bearer header: asked for once
// however many views want one, kept in memory and on disk (each letting the least recently used go
// past its limit), an answer that is not an image never kept; and the colours a cover lights its
// page with.

/// A square image of `side` pixels, one colour (or `pixel` by index), as an image file.
func pngData(_ side: Int, _ rgb: [UInt8] = [16, 40, 62], pixel: ((Int) -> [UInt8])? = nil) -> Data {
    let image = cgImage(side, rgb, pixel: pixel)
    let data = NSMutableData()
    let destination = CGImageDestinationCreateWithData(data as CFMutableData, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    _ = CGImageDestinationFinalize(destination)
    return data as Data
}

func cgImage(_ side: Int, _ rgb: [UInt8], pixel: ((Int) -> [UInt8])? = nil) -> CGImage {
    var pixels: [UInt8] = []
    for i in 0..<(side * side) { pixels += (pixel?(i) ?? rgb) + [255] }
    return pixels.withUnsafeMutableBytes { buffer in
        let context = CGContext(
            data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        return context.makeImage()!
    }
}

/// A clock a second further on each time it is read, for the disk's order of use.
final class TickingClock: @unchecked Sendable {
    private let lock = NSLock()
    private var t = Date(timeIntervalSince1970: 1_800_000_000)

    var now: @Sendable () -> Date {
        { [self] in
            lock.withLock {
                t = t.addingTimeInterval(1)
                return t
            }
        }
    }
}

@Suite("Covers")
struct ImageCacheTests {
    let stub = Stub()

    var client: EchoClient { EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session) }

    func loader(memoryLimit: Int = 96 << 20, disk: DiskCovers? = nil) -> ImageLoader {
        let client = self.client
        return ImageLoader(fetch: { try await client.fetch($0) }, memoryLimit: memoryLimit, disk: disk)
    }

    func cover(_ id: String) -> String { "/api/v1/navidrome/cover/\(id)?size=300" }

    func serve(_ ids: String...) {
        for id in ids {
            stub.on("GET", "/navidrome/cover/\(id)", .json(200, pngData(4), headers: ["Content-Type": "image/png"]))
        }
    }

    func asked(_ id: String) -> Int { stub.requests("GET", "/navidrome/cover/\(id)").count }

    func folder() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("covers-\(UUID().uuidString)", isDirectory: true)
    }

    @Test("A cover comes once from ECHO with the bearer header, then from memory")
    func memoryHit() async throws {
        serve("al-1")
        let images = loader()
        #expect(images.cached(cover("al-1")) == nil)
        let first = try #require(await images.image(cover("al-1")))
        #expect(first.cgImage.width == 4)
        let again = await images.image(cover("al-1"))
        #expect(again === first)
        #expect(images.cached(cover("al-1")) === first)
        let sent = stub.requests("GET", "/navidrome/cover/al-1")
        #expect(sent.count == 1)
        #expect(sent.first?.bearer == "echo_dt_test")
        #expect(sent.first?.query == ["size": "300"])
    }

    @Test("Views asking for one cover at once make one request")
    func coalesced() async {
        serve("al-1")
        let images = loader()
        async let a = images.image(cover("al-1"))
        async let b = images.image(cover("al-1"))
        async let c = images.image(cover("al-1"))
        let all = await [a, b, c]
        #expect(all.allSatisfy { $0 != nil })
        #expect(asked("al-1") == 1)
    }

    @Test("Past the memory limit the least recently used cover goes first")
    func memoryEviction() async throws {
        serve("a", "b", "c")
        let weight = try #require(CoverImage.decode(pngData(4))).bytes
        let images = loader(memoryLimit: weight * 2)
        _ = await images.image(cover("a"))
        _ = await images.image(cover("b"))
        _ = images.cached(cover("a")) // a used since b
        _ = await images.image(cover("c"))
        #expect(images.inMemory(cover("a")))
        #expect(!images.inMemory(cover("b")))
        #expect(images.inMemory(cover("c")))
        // Let go, it is asked for again.
        _ = await images.image(cover("b"))
        #expect(asked("b") == 2)
        #expect(asked("a") == 1)
    }

    @Test("On disk: kept for the next launch, the least recently used deleted past the limit")
    func disk() async throws {
        serve("a", "b", "c")
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let clock = TickingClock()
        let limit = pngData(4).count * 2
        func disk() -> DiskCovers { DiskCovers(directory: dir, limit: limit, now: clock.now) }

        let first = loader(disk: disk())
        _ = await first.image(cover("a"))
        _ = await first.image(cover("b"))
        #expect(disk().bytes == limit)

        // The next launch: from disk, without asking ECHO.
        let second = loader(disk: disk())
        #expect(await second.image(cover("a")) != nil)
        #expect(asked("a") == 1)
        _ = await second.image(cover("c")) // three is too many: b, used longest ago, goes
        #expect(disk().bytes <= limit)

        let third = loader(disk: disk())
        #expect(await third.image(cover("a")) != nil)
        #expect(await third.image(cover("c")) != nil)
        #expect(asked("a") == 1)
        #expect(asked("c") == 1)
        #expect(await third.image(cover("b")) != nil)
        #expect(asked("b") == 2)
    }

    @Test("An answer that is not an image, or an error, is not kept and is asked for again")
    func notAnImage() async {
        stub.on("GET", "/navidrome/cover/x", .body(#"{"error":"not_found"}"#, status: 404))
        stub.on("GET", "/navidrome/cover/y", .body(#"{"ok":true}"#))
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let images = loader(disk: DiskCovers(directory: dir, limit: 1 << 20))
        #expect(await images.image(cover("x")) == nil)
        #expect(await images.image(cover("x")) == nil)
        #expect(asked("x") == 2)
        #expect(await images.image(cover("y")) == nil)
        #expect(!images.inMemory(cover("y")))
        #expect(DiskCovers(directory: dir, limit: 1 << 20).bytes == 0)
    }

    @Test("Signing out forgets every cover, in memory and on disk")
    func clear() async throws {
        serve("a")
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let images = loader(disk: DiskCovers(directory: dir, limit: 1 << 20))
        _ = await images.image(cover("a"))
        images.clear()
        #expect(!images.inMemory(cover("a")))
        #expect(DiskCovers(directory: dir, limit: 1 << 20).bytes == 0)
        _ = await images.image(cover("a"))
        #expect(asked("a") == 2)
    }

    @Test("A cover's light: its colour overall and its most vivid, the room drawn from them")
    func palette() throws {
        // The preview's Harbour Lights: navy, with amber lamps.
        let image = cgImage(8, [15, 34, 51]) { $0 % 16 == 5 ? [244, 196, 106] : [15, 34, 51] }
        let palette = try #require(AlbumPalette(image))
        let base = palette.base.hsb
        let accent = palette.accent.hsb
        #expect((0.52...0.62).contains(base.hue)) // blue
        #expect((0.08...0.14).contains(accent.hue)) // amber
        #expect(accent.brightness > 0.9)
        let mesh = palette.mesh
        #expect(mesh.count == 9)
        #expect((0.08...0.14).contains(mesh[4].hsb.hue)) // the glow in the middle is the amber
        #expect(mesh[4].hsb.brightness > mesh[0].hsb.brightness)
        #expect(mesh[7].hsb.brightness < 0.2) // the floor nearly black
        #expect(palette.floor.hsb.brightness < 0.1)
        // Grey stays grey.
        let grey = try #require(AlbumPalette(cgImage(8, [122, 122, 120])))
        #expect(grey.mesh.allSatisfy { $0.hsb.saturation < 0.1 })
    }

    @Test("Colours round-trip between RGB and hue, saturation and brightness")
    func hsb() {
        let amber = RGB(244 / 255, 196 / 255, 106 / 255)
        let (h, s, v) = amber.hsb
        let back = RGB(hue: h, saturation: s, brightness: v)
        #expect(abs(back.r - amber.r) < 0.001)
        #expect(abs(back.g - amber.g) < 0.001)
        #expect(abs(back.b - amber.b) < 0.001)
    }
}
