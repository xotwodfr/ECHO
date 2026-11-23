import Foundation
import MediaPlayer
import Testing

// The animated lock-screen covers (docs/MOTION.md, task 5): the server's answers read against its
// recorded ones (scripts/apple-fixtures.ts, the server's code with its stand-in motion service); the
// asking on an album's first play, the waits the server's Retry-After asks for (never shorter,
// growing, given up on after ten minutes), another album stopping it; the files kept, found again
// on the next play, by album, shape and loop length, the least recently used let go, checked
// against the server's version once a day, forgotten on signing out; the lock screen told once a
// cover is ready, on the iPhone only, the still cover staying until then and after an error; the
// loop speed kept on this device and asked for.

/// A box the tests change the loop speed in, as Settings does.
@MainActor
final class LoopBox {
    var seconds = LoopSpeed.standard.seconds
}

/// The motion calls answered in turn, for what EchoClient and Stub cannot do: an answer that never
/// comes until the test says.
final class GatedMotion: MotionSource, @unchecked Sendable {
    private let lock = NSLock()
    private var _asked: [String] = []

    var asked: [String] { lock.withLock { _asked } }

    func motion(album: String, shape: MotionShape, loop: Int) async throws -> MotionAnswer {
        lock.withLock { _asked.append("\(album) \(shape.rawValue) \(loop)") }
        return .pending(retryAfter: 30, ahead: 0)
    }

    func motionFile(_ path: String) async throws -> Data { Data() }
}

@MainActor
@Suite("Motion covers")
struct MotionTests {
    let stub = Stub()
    let sleeps = Sleeps()
    let clock = TestClock()
    let loop = LoopBox()

    var client: EchoClient { EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session) }

    func folder() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("motion-\(UUID().uuidString)", isDirectory: true)
    }

    func motionFiles(_ dir: URL, limit: Int = 64 << 20) -> MotionFiles {
        let clock = self.clock
        return MotionFiles(directory: dir, limit: limit, now: { clock.now })
    }

    func covers(_ files: MotionFiles, source: (any MotionSource)? = nil, sleep: (@Sendable (Duration) async throws -> Void)? = nil) -> MotionCovers {
        let loop = self.loop
        let clock = self.clock
        return MotionCovers(
            source: source ?? client, files: files, loop: { loop.seconds }, sleep: sleep ?? sleeps.sleep,
            now: { clock.now })
    }

    /// The album's video and still, as the server sends them.
    func serveFiles(_ album: String = "al-1") {
        stub.on("GET", "/motion/\(album)/video", .json(200, Data("VIDEO".utf8), headers: ["Content-Type": "video/mp4"]))
        stub.on("GET", "/motion/\(album)/still", .json(200, pngData(4), headers: ["Content-Type": "image/jpeg"]))
    }

    func asked(_ album: String = "al-1") -> [SentRequest] { stub.requests("GET", "/motion/\(album)") }

    static let working = Reply.fixture("motion-working", status: 202, headers: ["Retry-After": "30"])
    static let ready = Reply.fixture("motion-ready")
    static let readySquare = Reply.fixture("motion-ready-square")
    static let version = "35834c26989a-mywq7vt4"

    // MARK: The server's answers

    @Test("Asked with its shape and loop length: ready, with its video's and still's paths and version")
    func readyAnswer() async throws {
        stub.on("GET", "/motion/al-1", Self.ready)
        let answer = try await client.motion(album: "al-1", shape: .tall, loop: 8)
        #expect(answer == .ready(MotionReady(
            source: "generated", style: "light", seconds: 8, version: Self.version,
            video: "/api/v1/motion/al-1/video?shape=tall&loop=8", still: "/api/v1/motion/al-1/still?shape=tall&loop=8")))
        let sent = try #require(asked().first)
        #expect(sent.query == ["shape": "tall", "loop": "8"])
        #expect(sent.bearer == "echo_dt_test")
        // An admin's upload: the album's cover at any length, at its own.
        stub.on("GET", "/motion/al-1", .fixture("motion-ready-upload-loop-12"))
        guard case .ready(let upload) = try await client.motion(album: "al-1", shape: .tall, loop: 12) else {
            Issue.record("not ready")
            return
        }
        #expect(upload.source == "upload")
        #expect(upload.style == "video")
        #expect(upload.seconds == 3)
        #expect(upload.version != Self.version)
    }

    @Test("While it is made: 202, waiting what Retry-After says (the body's when there is no header)")
    func pendingAnswer() async throws {
        stub.on(
            "GET", "/motion/al-1", Self.working, .fixture("motion-queued", status: 202, headers: ["Retry-After": "60"]),
            .fixture("motion-working", status: 202))
        #expect(try await client.motion(album: "al-1", shape: .tall, loop: 8) == .pending(retryAfter: 30, ahead: 0))
        #expect(try await client.motion(album: "al-1", shape: .tall, loop: 8) == .pending(retryAfter: 60, ahead: 1))
        #expect(try await client.motion(album: "al-1", shape: .tall, loop: 8) == .pending(retryAfter: 30, ahead: 0))
    }

    @Test("Failed, no motion service, too many waiting, a length not offered, Navidrome not connected")
    func otherAnswers() async throws {
        stub.on("GET", "/motion/al-3", .fixture("motion-failed"))
        stub.on("GET", "/motion/al-4", .fixture("motion-off"))
        stub.on("GET", "/motion/al-5", .fixture("motion-busy", status: 429, headers: ["Retry-After": "60"]))
        stub.on("GET", "/motion/al-6", .fixture("motion-bad-loop", status: 400))
        stub.on("GET", "/motion/al-7", .fixture("motion-not-connected", status: 409))
        #expect(try await client.motion(album: "al-3", shape: .tall, loop: 8) == .failed)
        #expect(try await client.motion(album: "al-4", shape: .tall, loop: 8) == .off)
        #expect(try await client.motion(album: "al-5", shape: .tall, loop: 8) == .busy(retryAfter: 60))
        // The 429 is an answer, not the API budget's: asked once, not again inside the call.
        #expect(asked("al-5").count == 1)
        await #expect(throws: ApiError.server(status: 400, code: "bad_params")) {
            try await client.motion(album: "al-6", shape: .tall, loop: 10)
        }
        await #expect(throws: ApiError.navidromeNotConnected) {
            try await client.motion(album: "al-7", shape: .tall, loop: 8)
        }
    }

    @Test("A ready cover's files: the bytes; 202 while it is made again; only ECHO's motion paths")
    func fileAnswers() async throws {
        serveFiles()
        #expect(try await client.motionFile("/api/v1/motion/al-1/video?shape=tall&loop=8") == Data("VIDEO".utf8))
        stub.on("GET", "/motion/al-1/video", .fixture("motion-video-pending", status: 202, headers: ["Retry-After": "5"]))
        await #expect(throws: MotionNotReady(retryAfter: 5)) {
            try await client.motionFile("/api/v1/motion/al-1/video?shape=tall&loop=12")
        }
        await #expect(throws: ApiError.badResponse) { try await client.motionFile("https://elsewhere.test/video.mp4") }
        await #expect(throws: ApiError.badResponse) { try await client.motionFile("/api/v1/navidrome/cover/al-1") }
    }

    @Test("The speeds are the server's loop lengths, Normal (8 s) by default")
    func speeds() throws {
        struct Status: Decodable { let loops: [Int] }
        let status = try JSONDecoder().decode(Status.self, from: Fixture.data("motion-status"))
        #expect(LoopSpeed.allCases.map(\.seconds) == status.loops)
        #expect(LoopSpeed.standard == .normal)
        #expect(LoopSpeed.standard.seconds == 8)
        #expect(LoopSpeed.allCases.map(\.label) == ["Fast", "Normal", "Slow", "Very slow"])
    }

    // MARK: Asking on the first play

    @Test("First play: 202, the wait Retry-After asked for, then ready: both shapes kept, the lock screen told")
    func firstPlay() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", Self.working, Self.ready, Self.readySquare)
        serveFiles()
        let motion = covers(motionFiles(dir))
        var told = 0
        let track = song(1)
        #expect(motion.cover(for: track) == nil)
        motion.want(track) { told += 1 }
        #expect(await eventually { told == 2 })
        #expect(sleeps.all == [.seconds(30)])
        #expect(asked().map(\.query) == [
            ["shape": "tall", "loop": "8"], ["shape": "tall", "loop": "8"], ["shape": "square", "loop": "8"],
        ])
        #expect(stub.requests("GET", "/motion/al-1/video").count == 2)
        let cover = try #require(motion.cover(for: track))
        let tall = try #require(cover.tall)
        let square = try #require(cover.square)
        #expect(tall.id == "navidrome:al-1|tall|8|\(Self.version)")
        #expect(square.id == "navidrome:al-1|square|8|\(Self.version)")
        #expect(tall.video.isFileURL)
        #expect(tall.video.pathExtension == "mp4")
        #expect(try Data(contentsOf: tall.video) == Data("VIDEO".utf8))
        #expect(try Data(contentsOf: tall.still) == pngData(4))
        #expect(tall.video != square.video)
        // Followed already: the next publish asks for nothing.
        motion.want(track) { told += 1 }
        try await Task.sleep(for: .milliseconds(50))
        #expect(asked().count == 3)
    }

    @Test("Retry-After is honoured: never sooner, the waits growing by half to a minute")
    func waits() async throws {
        #expect(MotionCovers.delay(retryAfter: 30, attempt: 0) == 30)
        #expect(MotionCovers.delay(retryAfter: 5, attempt: 0) == 5)
        #expect(MotionCovers.delay(retryAfter: 5, attempt: 1) == 7.5)
        #expect(MotionCovers.delay(retryAfter: 5, attempt: 2) == 11.25)
        #expect(MotionCovers.delay(retryAfter: 5, attempt: 20) == 60)
        #expect(MotionCovers.delay(retryAfter: 120, attempt: 3) == 120)

        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let five = Reply.fixture("motion-loop-12", status: 202, headers: ["Retry-After": "5"])
        stub.on("GET", "/motion/al-1", five, five, five, Self.ready, Self.readySquare)
        serveFiles()
        let motion = covers(motionFiles(dir))
        var told = 0
        motion.want(song(1)) { told += 1 }
        #expect(await eventually { told == 2 })
        #expect(sleeps.all == [.seconds(5), .milliseconds(7500), .milliseconds(11250)])
    }

    @Test("Ten minutes of waiting and it gives up: the still cover stays, the album left alone a while")
    func givesUp() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", .fixture("motion-queued", status: 202, headers: ["Retry-After": "60"]))
        stub.on("GET", "/motion/al-2", .fixture("motion-failed"))
        let motion = covers(motionFiles(dir))
        motion.want(song(1)) {}
        #expect(await eventually { asked().count == 11 })
        try await Task.sleep(for: .milliseconds(50))
        #expect(asked().count == 11)
        #expect(sleeps.all.count == 10)
        #expect(sleeps.all.allSatisfy { $0 == .seconds(60) })
        #expect(motion.cover(for: song(1)) == nil)
        // Back on the album within ten minutes: not asked again.
        motion.want(song(1, album: "al-2")) {}
        #expect(await eventually { asked("al-2").count == 1 })
        motion.want(song(2)) {}
        try await Task.sleep(for: .milliseconds(50))
        #expect(asked().count == 11)
        // Later, it is.
        clock.advance(MotionCovers.restAfterGivingUp + 1)
        motion.want(song(1, album: "al-2")) {}
        motion.want(song(3)) {}
        #expect(await eventually { asked().count >= 12 })
        motion.cancel()
    }

    @Test("Another album stops the asking for the one before; the same album's next song keeps it")
    func trackChange() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let gated = GatedMotion()
        // Waits that last until cancelled.
        let motion = covers(motionFiles(dir), source: gated, sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
        motion.want(song(1)) {}
        #expect(await eventually { gated.asked == ["al-1 tall 8"] })
        motion.want(song(2)) {}
        try await Task.sleep(for: .milliseconds(50))
        #expect(gated.asked == ["al-1 tall 8"])
        motion.want(song(1, album: "al-2")) {}
        #expect(await eventually { gated.asked == ["al-1 tall 8", "al-2 tall 8"] })
        // Nothing plays: stopped.
        motion.want(nil) {}
        motion.want(song(1, album: "al-2")) {}
        #expect(await eventually { gated.asked.count == 3 })
        motion.cancel()
        try await Task.sleep(for: .milliseconds(50))
        #expect(gated.asked.count == 3)
        #expect(motion.files.names.isEmpty)
    }

    @Test("Not a Navidrome album: nothing to ask for")
    func otherProviders() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let motion = covers(motionFiles(dir))
        var track = song(1)
        track.album.key = "youtube:OLAK5uy"
        motion.want(track) {}
        try await Task.sleep(for: .milliseconds(50))
        #expect(stub.requests.isEmpty)
        #expect(motion.cover(for: track) == nil)
        #expect(MotionCovers.album(of: song(1)) == "al-1")
        track.album.key = "navidrome:"
        #expect(MotionCovers.album(of: track) == nil)
    }

    @Test("Failed, or no motion service: the still cover stays and it is not asked again for a while")
    func failedAndOff() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-3", .fixture("motion-failed"))
        stub.on("GET", "/motion/al-4", .fixture("motion-off"))
        stub.on("GET", "/motion/al-5", Self.working)
        let motion = covers(motionFiles(dir))
        motion.want(song(1, album: "al-3")) {}
        #expect(await eventually { asked("al-3").count == 1 })
        motion.want(song(1, album: "al-4")) {}
        #expect(await eventually { asked("al-4").count == 1 })
        try await Task.sleep(for: .milliseconds(50))
        // Off: no album is asked for until an hour has passed.
        motion.want(song(1, album: "al-5")) {}
        motion.want(song(1, album: "al-3")) {}
        try await Task.sleep(for: .milliseconds(50))
        #expect(asked("al-5").isEmpty)
        #expect(asked("al-3").count == 1)
        clock.advance(MotionCovers.restAfterFailure + 1)
        motion.want(song(1, album: "al-5")) {}
        #expect(await eventually { asked("al-5").count >= 1 })
        motion.cancel()
        #expect(motion.cover(for: song(1, album: "al-3")) == nil)
    }

    // MARK: The files kept

    @Test("The next play is at once: the files kept, nothing asked")
    func secondPlay() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", Self.ready, Self.readySquare)
        serveFiles()
        var told = 0
        let first = covers(motionFiles(dir))
        first.want(song(1)) { told += 1 }
        #expect(await eventually { told == 2 })
        first.cancel()
        let before = stub.requests.count

        // The app again (a later launch): the same folder.
        let motion = covers(motionFiles(dir))
        let cover = try #require(motion.cover(for: song(4)))
        #expect(cover.tall?.id == "navidrome:al-1|tall|8|\(Self.version)")
        #expect(cover.square != nil)
        motion.want(song(4)) { told += 1 }
        try await Task.sleep(for: .milliseconds(50))
        #expect(stub.requests.count == before)
        #expect(told == 2)
    }

    @Test("Each album, shape and loop length is its own cover")
    func keys() throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let files = motionFiles(dir)
        let note = MotionNote(version: "v1", seconds: 8, style: "depth", source: "generated", checkedAt: clock.now)
        let tall = MotionKey(album: "al-1", shape: .tall, loop: 8)
        try #require(files.store(tall, video: Data("V".utf8), still: Data("S".utf8), note: note) != nil)
        #expect(files.file(tall)?.note == note)
        #expect(files.file(MotionKey(album: "al-1", shape: .square, loop: 8)) == nil)
        #expect(files.file(MotionKey(album: "al-1", shape: .tall, loop: 12)) == nil)
        #expect(files.file(MotionKey(album: "al-2", shape: .tall, loop: 8)) == nil)
        let names = Set(
            [tall, MotionKey(album: "al-1", shape: .square, loop: 8), MotionKey(album: "al-1", shape: .tall, loop: 12),
             MotionKey(album: "al-2", shape: .tall, loop: 8)].map(\.name))
        #expect(names.count == 4)
    }

    @Test("Past the limit the least recently used cover goes, never the one just kept")
    func eviction() throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let ticking = TickingClock()
        let files = MotionFiles(directory: dir, limit: 2500, now: ticking.now)
        let note = MotionNote(version: "v", checkedAt: clock.now)
        let video = Data(repeating: 1, count: 1000)
        let still = Data(repeating: 2, count: 100)
        let a = MotionKey(album: "a", shape: .tall, loop: 8)
        let b = MotionKey(album: "b", shape: .tall, loop: 8)
        let c = MotionKey(album: "c", shape: .tall, loop: 8)
        files.store(a, video: video, still: still, note: note)
        files.store(b, video: video, still: still, note: note)
        files.used(a) // a played since b
        files.store(c, video: video, still: still, note: note)
        #expect(files.file(a) != nil)
        #expect(files.file(b) == nil)
        #expect(files.file(c) != nil)
        #expect(files.bytes <= 2500)
        #expect(files.names == [a.name, c.name])
        // One larger than the limit is still kept, alone.
        files.store(b, video: Data(repeating: 3, count: 4000), still: still, note: note)
        #expect(files.names == [b.name])
    }

    @Test("Checked once a day: a new version replaces the files; the same one is only noted")
    func checkedDaily() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let files = motionFiles(dir)
        let old = MotionNote(version: "old", checkedAt: clock.now)
        let tall = MotionKey(album: "al-1", shape: .tall, loop: 8)
        let square = MotionKey(album: "al-1", shape: .square, loop: 8)
        files.store(tall, video: Data("OLD".utf8), still: Data("S".utf8), note: old)
        files.store(square, video: Data("OLD".utf8), still: Data("S".utf8), note: MotionNote(version: Self.version, checkedAt: clock.now))
        // Within the day: nothing asked.
        let motion = covers(files)
        motion.want(song(1)) {}
        try await Task.sleep(for: .milliseconds(50))
        #expect(stub.requests.isEmpty)
        // A day on (an admin may have uploaded a video): asked again; the tall one is new, the
        // square one the same.
        clock.advance(MotionCovers.checkAfter + 1)
        stub.on("GET", "/motion/al-1", Self.ready, Self.readySquare)
        serveFiles()
        var told = 0
        let later = covers(files)
        later.want(song(1)) { told += 1 }
        #expect(await eventually { asked().count == 2 })
        #expect(await eventually { told == 1 })
        #expect(await eventually { files.file(square)?.note.checkedAt == clock.now })
        let tallVideo = try #require(files.file(tall)?.video)
        let squareVideo = try #require(files.file(square)?.video)
        #expect(try Data(contentsOf: tallVideo) == Data("VIDEO".utf8))
        #expect(files.file(tall)?.note.version == Self.version)
        #expect(try Data(contentsOf: squareVideo) == Data("OLD".utf8))
        #expect(stub.requests("GET", "/motion/al-1/video").count == 1)
        motion.cancel()
        later.cancel()
    }

    @Test("A download that fails leaves the still cover, and the album is tried again later")
    func downloadFails() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", Self.ready)
        stub.on("GET", "/motion/al-1/still", .json(200, pngData(4)))
        stub.on("GET", "/motion/al-1/video", .failure(.networkConnectionLost))
        let motion = covers(motionFiles(dir))
        motion.want(song(1)) {}
        #expect(await eventually { stub.requests("GET", "/motion/al-1/video").count == 1 })
        try await Task.sleep(for: .milliseconds(50))
        #expect(motion.cover(for: song(1)) == nil)
        #expect(motion.files.names.isEmpty)
        clock.advance(MotionCovers.restAfterError + 1)
        motion.want(song(1, album: "al-2")) {}
        motion.want(song(1)) {}
        #expect(await eventually { asked().count == 2 })
        motion.cancel()
    }

    // MARK: The lock screen

    func makeRig(_ dir: URL, sleep: (@Sendable (Duration) async throws -> Void)? = nil) -> (Rig, MotionCovers) {
        let motion = covers(motionFiles(dir), sleep: sleep)
        return (Rig(images: ImageLoader(fetch: { _ in pngData(8) }), motion: motion), motion)
    }

    @Test("The lock screen: the still cover until the motion cover is ready, then the animated keys (iPhone only)")
    func lockScreen() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        let gate = AsyncGate()
        stub.on("GET", "/motion/al-1", Self.working, Self.ready, Self.readySquare)
        serveFiles()
        let (rig, _) = makeRig(dir, sleep: { _ in await gate.wait() })
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(await eventually { rig.media.info?[MPMediaItemPropertyArtwork] is MPMediaItemArtwork })
        #expect(await eventually { asked().count == 1 })
        // Waiting on the server: the still cover only.
        #expect(rig.media.info?[MPNowPlayingInfoProperty3x4AnimatedArtwork] == nil)
        #expect(rig.media.info?[MPNowPlayingInfoProperty1x1AnimatedArtwork] == nil)
        gate.open()
        #expect(await eventually { asked().count == 3 })
        #if os(iOS)
        #expect(await eventually {
            rig.media.info?[MPNowPlayingInfoProperty3x4AnimatedArtwork] is MPMediaItemAnimatedArtwork
                && rig.media.info?[MPNowPlayingInfoProperty1x1AnimatedArtwork] is MPMediaItemAnimatedArtwork
        })
        #expect(rig.media.info?[MPMediaItemPropertyArtwork] is MPMediaItemArtwork)
        #else
        try await Task.sleep(for: .milliseconds(100))
        #expect(rig.media.info?[MPNowPlayingInfoProperty3x4AnimatedArtwork] == nil)
        #expect(rig.media.info?[MPNowPlayingInfoProperty1x1AnimatedArtwork] == nil)
        #endif
        // The next song of the album asks nothing more.
        player.next()
        try await Task.sleep(for: .milliseconds(50))
        #expect(asked().count == 3)
        #if os(iOS)
        #expect(rig.media.info?[MPNowPlayingInfoProperty3x4AnimatedArtwork] is MPMediaItemAnimatedArtwork)
        #endif
    }

    @Test("No motion cover (an error): the lock screen keeps the still cover")
    func errorKeepsStill() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", .failure(.notConnectedToInternet))
        let (rig, motion) = makeRig(dir)
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(await eventually { asked().count == 1 })
        #expect(await eventually { rig.media.info?[MPMediaItemPropertyArtwork] is MPMediaItemArtwork })
        try await Task.sleep(for: .milliseconds(50))
        #expect(rig.media.info?[MPNowPlayingInfoProperty3x4AnimatedArtwork] == nil)
        #expect(motion.cover(for: song(1)) == nil)
    }

    @Test("The info builder: the animated keys only when a cover is given, and only on the iPhone")
    func builder() {
        let still = URL(fileURLWithPath: "/tmp/still.jpg")
        let video = URL(fileURLWithPath: "/tmp/video.mp4")
        let frame = AnimatedCover.Frame(id: "navidrome:al-1|tall|8|v", video: video, still: still)
        let none = NowPlayingInfo.build(
            track: song(1), elapsed: 0, duration: 200, playing: true, index: 0, count: 1, artwork: nil)
        #expect(none[MPNowPlayingInfoProperty3x4AnimatedArtwork] == nil)
        #expect(none[MPNowPlayingInfoProperty1x1AnimatedArtwork] == nil)
        let tallOnly = NowPlayingInfo.build(
            track: song(1), elapsed: 0, duration: 200, playing: true, index: 0, count: 1, artwork: nil,
            animated: AnimatedCover(tall: frame))
        #expect(tallOnly[MPNowPlayingInfoProperty1x1AnimatedArtwork] == nil)
        #if os(iOS)
        #expect(tallOnly[MPNowPlayingInfoProperty3x4AnimatedArtwork] is MPMediaItemAnimatedArtwork)
        #else
        #expect(tallOnly[MPNowPlayingInfoProperty3x4AnimatedArtwork] == nil)
        #endif
        #expect(tallOnly[MPMediaItemPropertyTitle] as? String == "Song 1")
    }

    @Test("Signing out forgets the motion covers kept")
    func signOut() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", Self.ready, Self.readySquare)
        serveFiles()
        let (rig, motion) = makeRig(dir)
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(await eventually { motion.files.names.count == 2 })
        player.stop()
        #expect(motion.files.names.isEmpty)
        #expect(motion.cover(for: song(1)) == nil)
        #expect(rig.media.info == nil)
    }

    // MARK: The loop speed

    @Test("The loop speed changes the length asked for, and the cover's key")
    func loopSpeed() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", Self.ready, Self.readySquare)
        serveFiles()
        let motion = covers(motionFiles(dir))
        var told = 0
        motion.want(song(1)) { told += 1 }
        #expect(await eventually { told == 2 })
        loop.seconds = LoopSpeed.slow.seconds
        // The 8-second cover is not the 12-second one.
        #expect(motion.cover(for: song(1)) == nil)
        #expect(motion.preview(for: song(1))?.note.seconds == 8)
        stub.on("GET", "/motion/al-1", Self.working, .fixture("motion-ready-loop-12"), Self.readySquare)
        motion.want(song(1)) { told += 1 }
        #expect(await eventually { told == 4 })
        #expect(asked().suffix(3).map { $0.query["loop"] } == ["12", "12", "12"])
        #expect(motion.cover(for: song(1))?.tall?.id.hasSuffix("|tall|12|ee02028ebea0-mywq7vt4") == true)
        #expect(motion.preview(for: song(1))?.note.seconds == 12)
        loop.seconds = LoopSpeed.normal.seconds
        #expect(motion.cover(for: song(1))?.tall?.id == "navidrome:al-1|tall|8|\(Self.version)")
    }

    @Test("The loop speed: Normal until chosen, then kept on this device")
    func deviceSettings() throws {
        let name = "motion-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        #expect(DeviceSettings(defaults: defaults).motionLoop == .normal)
        DeviceSettings(defaults: defaults).setMotionLoop(.slow)
        #expect(defaults.integer(forKey: DeviceSettings.motionLoopKey) == 12)
        #expect(DeviceSettings(defaults: defaults).motionLoop == .slow)
        defaults.set(10, forKey: DeviceSettings.motionLoopKey) // not a length the server makes
        #expect(DeviceSettings(defaults: defaults).motionLoop == .normal)
        let memory = DeviceSettings(defaults: nil)
        memory.setMotionLoop(.fast)
        #expect(memory.motionLoop == .fast)
    }

    @Test("A loop speed chosen in Settings: the player asks for the cover at the new length")
    func playerLoop() async throws {
        let dir = folder()
        defer { try? FileManager.default.removeItem(at: dir) }
        stub.on("GET", "/motion/al-1", Self.ready, Self.readySquare)
        serveFiles()
        let (rig, _) = makeRig(dir)
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(await eventually { asked().count == 2 })
        loop.seconds = LoopSpeed.fast.seconds
        stub.on("GET", "/motion/al-1", Self.working)
        player.lockScreenChanged()
        #expect(await eventually { asked().count >= 3 })
        #expect(asked()[2].query == ["shape": "tall", "loop": "5"])
        player.stop()
    }
}

/// A wait that holds until the test opens it (the first ask's Retry-After, while the test looks).
final class AsyncGate: @unchecked Sendable {
    private let lock = NSLock()
    private var opened = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        await withCheckedContinuation { continuation in
            let resume = lock.withLock { () -> Bool in
                if opened { return true }
                waiting.append(continuation)
                return false
            }
            if resume { continuation.resume() }
        }
    }

    func open() {
        let all = lock.withLock { () -> [CheckedContinuation<Void, Never>] in
            opened = true
            defer { waiting = [] }
            return waiting
        }
        for continuation in all { continuation.resume() }
    }
}
