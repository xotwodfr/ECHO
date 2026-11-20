import Foundation

// The preview's animated lock-screen cover (`-ECHODemo settings`, `lockcover`): Harbour Lights'
// tall motion cover, made for the preview from the web fixture's cover
// (src/client/fixtures/covers/harbour-lights.svg) as a Living light loop: the cover still, light in
// its own colours drifting over it, a soft sweep once per loop; 8 s at 540 × 720, H.264
// (Preview/Motion/harbour-tall.mp4, its first frame harbour-tall.jpg). It is kept as the motion
// cover of the preview's album, so Settings shows it as it would a downloaded one; nothing is ever
// asked of a server.

/// Answers nothing: the preview has no server.
struct DemoMotionSource: MotionSource {
    func motion(album: String, shape: MotionShape, loop: Int) async throws -> MotionAnswer { .off }
    func motionFile(_ path: String) async throws -> Data { throw ApiError.notFound }
}

extension MotionCovers {
    @MainActor
    static func demo(loop: @escaping @MainActor () -> Int) -> MotionCovers {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ECHODemoMotion", isDirectory: true)
        let files = MotionFiles(directory: dir)
        files.removeAll()
        if let video = Bundle.main.url(forResource: "harbour-tall", withExtension: "mp4").flatMap({ try? Data(contentsOf: $0) }),
           let still = Bundle.main.url(forResource: "harbour-tall", withExtension: "jpg").flatMap({ try? Data(contentsOf: $0) })
        {
            files.store(
                MotionKey(album: Demo.harbour.id, shape: .tall, loop: LoopSpeed.normal.seconds), video: video, still: still,
                note: MotionNote(version: "preview", seconds: 8, style: "light", source: "generated", checkedAt: Date()))
        }
        return MotionCovers(source: DemoMotionSource(), files: files, loop: loop)
    }
}
