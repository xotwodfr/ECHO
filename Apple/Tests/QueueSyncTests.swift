import Foundation
import Testing

// The queue that follows the user, against ECHO's recorded answers (src/client/playback/
// queueSync.ts, queueSync.test.ts): read at sign-in and cued where it was; a refused or unreachable
// read asked again (the API budget's 429 after its Retry-After, a bounded number of times, where the
// web gave up at once); saved as the web saves it, 2 s after a change and every 15 s while playing;
// a newer queue from another device taken unless this one is playing; nothing saved after sign-out.

/// Messages the player said.
final class Notices: @unchecked Sendable {
    private let lock = NSLock()
    private var list: [String] = []

    var all: [String] { lock.withLock { list } }

    func add(_ message: String) {
        lock.withLock { list.append(message) }
    }
}

@MainActor
@Suite("The queue that follows you")
struct QueueSyncTests {
    let stub = Stub()
    /// The client's waits (Retry-After), and the player's (the 2 s before a save, the backoff).
    let clientSleeps = Sleeps()
    let sleeps = Sleeps()
    let clock = TestClock()
    let notices = Notices()

    var client: EchoClient {
        EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session, sleep: clientSleeps.sleep, jitter: { 0 })
    }

    func makePlayer(_ engine: FakeEngine, sleep: (@Sendable (Duration) async throws -> Void)? = nil) -> Player {
        let notices = self.notices
        let clock = self.clock
        return Player(
            source: client, engine: engine, follows: true, notify: { notices.add($0) }, sleep: sleep ?? sleeps.sleep,
            now: { clock.now })
    }

    var saves: [SentRequest] { stub.requests("PUT", "/me/queue") }

    private func queue(_ now: Int, context: ClosedRange<Int>? = nil) -> QueueState {
        QueueState(
            provider: "navidrome", now: song(now), context: context.map { songs($0) } ?? [], contextSource: albumContext)
    }

    // MARK: Signing in

    @Test("Signed in, the saved queue comes back cued where it was, shuffled as it was; nothing streams yet")
    func restore() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue"))
        let engine = FakeEngine()
        let player = makePlayer(engine)
        await player.signedIn()
        #expect(player.track?.id == "al-1-t2")
        #expect(player.status == .paused)
        #expect(abs(player.time(at: clock.now) - 12.345678) < 0.000001)
        #expect(player.upcoming.map(\.id) == ["al-3-t1", "al-1-t4", "al-1-t3"])
        #expect(player.shuffled)
        #expect(player.context == albumContext)
        #expect(player.sync?.base == 1_800_001_155_000)
        #expect(player.sync?.following == true)
        #expect(stub.requests("GET", "/navidrome/stream-url/al-1-t2").isEmpty)
        #expect(engine.loads.isEmpty)
        // Read just now, it is not saved back.
        try? await Task.sleep(for: .milliseconds(100))
        #expect(saves.isEmpty)
    }

    @Test("Nothing saved yet: nothing comes back, and the first change is saved over none")
    func nothingSaved() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        #expect(player.track == nil)
        player.addToQueue(songs(1...2))
        #expect(await eventually { saves.count == 1 })
        let body = try #require(saves.first?.json)
        #expect(body["baseUpdatedAt"] as? Int == 0)
        #expect(body["positionMs"] as? Double == 0)
        let saved = try #require(body["queue"] as? [String: Any])
        #expect(saved["provider"] as? String == "navidrome")
        #expect((saved["now"] as? [String: Any])?["id"] as? String == "al-1-t1")
        #expect((saved["nextUp"] as? [[String: Any]])?.map { $0["id"] as? String } == ["al-1-t2"])
        #expect(sleeps.all.contains(QueueSync.debounce))
        #expect(await eventually { player.sync?.base == 1_800_001_155_000 })
    }

    @Test("Something already playing is not replaced by the saved queue: it is saved over it")
    func playingFirst() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        let player = makePlayer(FakeEngine())
        player.cue(queue(5), at: 0)
        await player.signedIn()
        #expect(player.track?.id == "al-1-t5")
        #expect(await eventually { saves.count == 1 })
        #expect(saves.first?.json?["baseUpdatedAt"] as? Int == 1_800_001_155_000)
        #expect(((saves.first?.json?["queue"] as? [String: Any])?["now"] as? [String: Any])?["id"] as? String == "al-1-t5")
    }

    @Test("Over the API budget at sign-in: asked again after each Retry-After, more than other reads")
    func rateLimited() async throws {
        let limited = Reply.fixture("rate-limited", status: 429, headers: ["Retry-After": "1"])
        stub.on("GET", "/me/queue", limited, limited, limited, limited, .fixture("me-queue"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        #expect(player.track?.id == "al-1-t2")
        #expect(stub.requests("GET", "/me/queue").count == 5)
        #expect(clientSleeps.all == [.seconds(1), .seconds(2), .seconds(3), .seconds(4)])
        #expect(player.sync?.following == true)
    }

    @Test("Still over the budget after its retries: the queue gives up following this session")
    func rateLimitedBeyondTheBound() async throws {
        stub.on("GET", "/me/queue", .fixture("rate-limited", status: 429, headers: ["Retry-After": "1"]))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        #expect(stub.requests("GET", "/me/queue").count == 1 + EchoClient.queueRetries)
        #expect(clientSleeps.all.count == EchoClient.queueRetries)
        #expect(player.track == nil)
        #expect(player.sync?.following == false)
        player.addToQueue(songs(1...1))
        try? await Task.sleep(for: .milliseconds(100))
        #expect(saves.isEmpty)
    }

    @Test("ECHO not answering at sign-in (a restart): asked again 1 s, then 2 s later")
    func unreachable() async throws {
        stub.on("GET", "/me/queue", .failure(.timedOut), .failure(.cannotConnectToHost), .fixture("me-queue"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        #expect(player.track?.id == "al-1-t2")
        #expect(Array(sleeps.all.prefix(2)) == [.seconds(1), .seconds(2)])
    }

    @Test("Signed out meanwhile: no retries, and nothing saved")
    func refused() async throws {
        stub.on("GET", "/me/queue", .fixture("unauthenticated", status: 401))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        #expect(stub.requests("GET", "/me/queue").count == 1)
        #expect(player.sync?.following == false)
        #expect(sleeps.all.isEmpty)
    }

    // MARK: Saving

    @Test("Saved as the web saves it: the source, the history's last 20, where in the song")
    func body() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        player.cue(
            QueueState(
                provider: "navidrome", now: song(30), nextUp: [song(1, album: "al-2")], context: songs(31...32),
                contextSource: albumContext, history: songs(1...29)),
            at: 61.5)
        #expect(await eventually { saves.count == 1 })
        let body = try #require(saves.first?.json)
        #expect(body["positionMs"] as? Double == 61500)
        let saved = try #require(body["queue"] as? [String: Any])
        let history = (saved["history"] as? [[String: Any]])?.map { $0["id"] as? String }
        #expect(history == songs(10...29).map(\.id))
        #expect(saved["contextSource"] as? [String: String] == ["kind": "album", "id": "al-1", "title": "Harbour Lights"])
        #expect((saved["context"] as? [[String: Any]])?.count == 2)
        #expect(saved["shuffleOrder"] == nil)
    }

    @Test("Changes in a row are saved once, 2 s after the last")
    func debounced() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        player.cue(queue(1, context: 2...4), at: 0)
        player.playNext([song(9, album: "al-2")])
        player.remove(at: 0)
        #expect(await eventually { saves.count == 1 })
        try? await Task.sleep(for: .milliseconds(100))
        #expect(saves.count == 1)
        #expect(sleeps.all.allSatisfy { $0 == QueueSync.debounce })
        let saved = try #require(saves.first?.json?["queue"] as? [String: Any])
        #expect((saved["nextUp"] as? [Any])?.isEmpty == true)
    }

    @Test("While playing, the queue is saved every 15 s (its position moves on)")
    func periodic() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        stub.on("GET", "/navidrome/stream-url/al-1-t1", .fixture("stream-url"))
        let engine = FakeEngine()
        let player = makePlayer(engine)
        await player.signedIn()
        await player.play([song(1, seconds: 300)], at: 0, context: albumContext)
        #expect(player.status == .playing)
        #expect(await eventually { saves.count == 1 })
        engine.play(to: 1)
        clock.advance(14)
        engine.play(to: 15)
        try? await Task.sleep(for: .milliseconds(100))
        #expect(saves.count == 1)
        clock.advance(1)
        engine.play(to: 16)
        #expect(await eventually { saves.count == 2 })
        #expect(saves.last?.json?["positionMs"] as? Double == 16000)
    }

    @Test("A newer queue from another device, while paused: said, and taken where it was")
    func conflictPaused() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"), .fixture("me-queue-newer"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-conflict", status: 409))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        player.cue(queue(1), at: 0)
        #expect(await eventually { player.track?.id == "al-3-t2" })
        #expect(notices.all == [QueueSync.changedElsewhere])
        #expect(player.sync?.base == 1_800_001_155_001)
        #expect(player.context == PlayContext(kind: "playlist", id: "pl-1", title: "Late Ferries"))
        #expect(abs(player.time(at: clock.now) - 61) < 0.001)
        #expect(player.status == .paused)
        try? await Task.sleep(for: .milliseconds(100))
        #expect(saves.count == 1)
    }

    @Test("A newer queue from another device, while playing: said, this one kept, and its next save wins")
    func conflictPlaying() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"), .fixture("me-queue-newer"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-conflict", status: 409), .fixture("me-queue-saved"))
        stub.on("GET", "/navidrome/stream-url/al-1-t1", .fixture("stream-url"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        await player.play([song(1)], at: 0, context: albumContext)
        #expect(await eventually { notices.all == [QueueSync.changedElsewhere] })
        #expect(await eventually { player.sync?.base == 1_800_001_155_001 })
        #expect(player.track?.id == "al-1-t1")
        player.pause()
        #expect(await eventually { saves.count == 2 })
        #expect(saves.last?.json?["baseUpdatedAt"] as? Int == 1_800_001_155_001)
        #expect(player.track?.id == "al-1-t1")
    }

    @Test("Signed out: a save on its way is dropped and nothing more is saved")
    func signOut() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        let player = makePlayer(FakeEngine())
        await player.signedIn()
        player.cue(queue(1, context: 2...3), at: 0)
        player.stop()
        player.addToQueue(songs(4...5))
        try? await Task.sleep(for: .milliseconds(100))
        #expect(saves.isEmpty)
        #expect(player.sync?.following == false)
    }

    @Test("Leaving the app: a save that waits goes at once")
    func flush() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        let player = makePlayer(FakeEngine(), sleep: Gate().sleep)
        await player.signedIn()
        player.cue(queue(1), at: 0)
        try? await Task.sleep(for: .milliseconds(50))
        #expect(saves.isEmpty)
        await player.flushQueue()
        #expect(saves.count == 1)
    }

    // MARK: The calls

    @Test("A play for ECHO's history: the song as the clients keep it, and where it played from")
    func recordPlay() async throws {
        stub.on("POST", "/me/plays", .fixture("me-plays"))
        try await client.recordPlay(song(1), context: albumContext)
        let body = try #require(stub.requests("POST", "/me/plays").first?.json)
        let track = try #require(body["track"] as? [String: Any])
        #expect(track["key"] as? String == "navidrome:al-1-t1")
        #expect(track["provider"] as? String == "navidrome")
        #expect(track["title"] as? String == "Song 1")
        #expect(body["context"] as? [String: String] == ["kind": "album", "id": "al-1", "title": "Harbour Lights"])
    }

    @Test("Navidrome's scrobbles: now playing, then played, as writes")
    func scrobble() async throws {
        stub.on("POST", "/navidrome/rest/scrobble", .fixture("scrobble"))
        try await client.scrobble(id: "al-1-t1", submission: false)
        try await client.scrobble(id: "al-1-t1", submission: true)
        let sent = stub.requests("POST", "/navidrome/rest/scrobble")
        #expect(sent.map(\.query) == [["id": "al-1-t1", "submission": "false"], ["id": "al-1-t1", "submission": "true"]])
        #expect(sent.allSatisfy { $0.bearer == "echo_dt_test" })
    }

    @Test("Saving: refused as not a queue, or as changed elsewhere (409, never asked again)")
    func saveRefusals() async throws {
        stub.on("PUT", "/me/queue", .fixture("me-queue-bad", status: 400), .fixture("me-queue-conflict", status: 409))
        await #expect(throws: ApiError.server(status: 400, code: "bad_queue")) {
            try await client.saveQueue(QueueState(), positionMs: 0, base: 0)
        }
        await #expect(throws: ApiError.server(status: 409, code: "changed_elsewhere")) {
            try await client.saveQueue(QueueState(), positionMs: 0, base: 0)
        }
        #expect(saves.count == 2)
    }
}
