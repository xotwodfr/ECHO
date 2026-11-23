import Foundation
import Testing

// Listen together, against ECHO's recorded answers (src/server/together.ts; scripts/apple-fixtures.ts):
// the session as every answer carries it, the Server-Sent Events it streams (read byte by byte, as they
// arrive), the arithmetic that keeps a listener in step (src/client/together/sync.ts), the codes and
// links that name a session, and the calls the app makes and the refusals it tells apart. What follows
// the session with a player is in TogetherFollowTests.

let sid = "together-session-for-tests-0001"

private func decode(_ name: String) throws -> TogetherState {
    try JSONDecoder().decode(TogetherState.self, from: Fixture.data(name))
}

@Suite("Listen together: the session as the server tells it")
struct TogetherModelTests {
    @Test("A session just started: the host, the song, two queued, playing from 12 s")
    func started() throws {
        let s = try decode("together-started")
        #expect(s.id == sid)
        #expect(s.host == TogetherPerson(id: 1, username: "ada"))
        #expect(s.you == TogetherYou(id: 1, host: true, member: true))
        #expect(s.members == [TogetherMember(id: 1, username: "ada", host: true, online: true)])
        #expect(s.now?.uid == "together-item-1")
        #expect(s.now?.track.id == "al-1-t1")
        #expect(s.queue.map(\.track.id) == ["al-1-t2", "al-3-t1"])
        #expect(s.queue.map(\.addedBy.username) == ["ada", "ada"])
        #expect(s.playing)
        #expect(s.startedAt == 1_800_001_283_000)
        #expect(s.positionMs == 12000)
        #expect(s.serverTime == 1_800_001_295_000)
        #expect(s.version == 0)
        #expect(s.listeners == 1)
    }

    @Test("A song as this app plays it, and as it shares it")
    func tracks() throws {
        let ref = try #require(decode("together-started").now?.track)
        let track = ref.track
        #expect(track.key == "navidrome:al-1-t1")
        #expect(track.title == "Harbour Lights 1")
        #expect(track.artist == "Lowfield")
        #expect(track.artists.first?.id == "ar-1")
        #expect(track.album.id == "al-1")
        #expect(track.album.title == "Harbour Lights")
        #expect(track.durationMs == 200_000)
        #expect(track.cover == "/api/v1/navidrome/cover/al-1?size=600")
        #expect(TrackRef(track) == ref)
        // A song with no cover and no artist.
        let bare = TrackRef(id: "x", title: "T", artist: "").track
        #expect(bare.artists.isEmpty)
        #expect(bare.cover == nil)
    }

    @Test("Someone about to join sees the session without being in it; a paused one holds its position")
    func peekAndPause() throws {
        let peek = try decode("together-peek")
        #expect(!peek.you.member)
        #expect(!peek.you.host)
        let paused = try decode("together-pause")
        #expect(!paused.playing)
        #expect(paused.startedAt == nil)
        #expect(paused.positionMs > 0)
        let joined = try decode("together-join")
        #expect(joined.you == TogetherYou(id: 2, host: false, member: true))
        #expect(joined.members.map(\.username) == ["ada", "sam"])
    }

    @Test("Who may take a song out: the host any, a member their own")
    func removal() throws {
        let queue = try decode("together-queue-added")
        let host = try decode("together-started")
        let mine = try #require(queue.queue.last)
        let theirs = try #require(queue.queue.first)
        var member = queue
        member.you = TogetherYou(id: 2, host: false, member: true)
        #expect(member.mayRemove(mine) == (mine.addedBy.id == 2))
        #expect(!member.mayRemove(theirs))
        #expect(host.mayRemove(host.queue[0]))
    }

    @Test("The link the QR code holds: a path made whole with the server's origin")
    func link() throws {
        let s = try decode("together-started")
        let origin = URL(string: "https://echo.folk3s.com")!
        #expect(s.link(origin: origin)?.absoluteString == "https://echo.folk3s.com/together/\(sid)")
        var whole = s
        whole.url = "https://music.example.org/together/\(sid)"
        #expect(whole.link(origin: origin)?.absoluteString == "https://music.example.org/together/\(sid)")
    }

    @Test("Answers with fields left out still read; ones that matter are required")
    func lenient() throws {
        let min = #"{"id":"together-session-for-tests-0001","host":{"id":1,"username":"ada"},"you":{"id":1,"host":true,"member":true},"serverTime":5}"#
        let s = try JSONDecoder().decode(TogetherState.self, from: Data(min.utf8))
        #expect(s.queue.isEmpty && s.members.isEmpty && s.now == nil && !s.playing && s.version == 0)
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(TogetherState.self, from: Data(#"{"id":"x"}"#.utf8))
        }
    }

    @Test("Each refusal the server makes, told apart, with what the person is told")
    func errors() throws {
        func error(_ fixture: String, _ status: Int, _ retry: String? = nil) -> TogetherError {
            TogetherError(status: status, body: Fixture.data(fixture), retryAfter: retry)
        }
        #expect(error("together-control-denied", 403) == .hostOnly)
        #expect(error("together-remove-denied", 403) == .hostOnly)
        #expect(error("together-queue-not-member", 403) == .notMember)
        #expect(error("together-not-found", 404) == .gone)
        #expect(error("together-jump-not-found", 404) == .gone)
        #expect(error("together-bad-track", 400) == .refused("bad_track"))
        #expect(error("together-seek-bad", 400) == .refused("bad_position"))
        #expect(error("together-bad-action", 400) == .refused("bad_action"))
        func inline(_ json: String, _ status: Int, _ retry: String? = nil) -> TogetherError {
            TogetherError(status: status, body: Data(json.utf8), retryAfter: retry)
        }
        #expect(inline(#"{"error":"other_library","host":"ada"}"#, 409) == .otherLibrary(host: "ada"))
        #expect(inline(#"{"error":"no_library"}"#, 409) == .noLibrary)
        #expect(inline(#"{"error":"full"}"#, 409) == .full)
        #expect(inline(#"{"error":"queue_full"}"#, 409) == .queueFull)
        #expect(inline(#"{"error":"nothing_to_play"}"#, 409) == .nothingToPlay)
        #expect(inline(#"{"error":"too_many_sessions"}"#, 503) == .tooManySessions)
        #expect(inline(#"{"error":"rate_limited"}"#, 429, "3") == .rateLimited(retryAfter: 3))
        #expect(inline(#"{"error":"rate_limited"}"#, 429) == .rateLimited(retryAfter: 1))
        #expect(inline("nonsense", 500) == .api(.server(status: 500, code: nil)))
        #expect(TogetherError.gone.endsSession && TogetherError.notMember.endsSession)
        #expect(!TogetherError.hostOnly.endsSession)
        #expect(TogetherError.hostOnly.userMessage == "Only the host controls playback.")
        #expect(TogetherError.otherLibrary(host: "ada").userMessage
            == "Joining needs the same library: ada's songs come from a Navidrome server you aren't connected to.")
        #expect(TogetherError.rateLimited(retryAfter: 3).userMessage == "Too many requests. Try again in 3 s.")
        #expect(TogetherError.rateLimited(retryAfter: 90).userMessage == "Too many requests. Try again in a minute.")
        #expect(TogetherError.noLibrary.userMessage == "Connect your Navidrome library first.")
    }

    @Test("What the offer says: who invited you, and why a session cannot be joined")
    func offers() {
        #expect(TogetherOffer.ready(id: sid, host: "ada", members: 1).text
            == "ada invited you to listen together. Your music follows theirs while you're in.")
        #expect(TogetherOffer.ready(id: sid, host: "ada", members: 2).text
            == "ada invited you to listen together with 1 other. Your music follows theirs while you're in.")
        #expect(TogetherOffer.ready(id: sid, host: "ada", members: 4).text
            == "ada invited you to listen together with 3 others. Your music follows theirs while you're in.")
        #expect(TogetherOffer.gone(id: sid).text == "This listening session has ended.")
        #expect(TogetherOffer.otherLibrary(id: sid, host: "ada").text.hasPrefix("Joining needs the same library: ada's songs"))
        #expect(TogetherOffer.loading(id: sid).id == sid)
    }
}

// MARK: - Server-Sent Events

@Suite("Listen together: Server-Sent Events")
struct TogetherEventStreamTests {
    private func chunks() throws -> [String] {
        let object = try #require(try JSONSerialization.jsonObject(with: Fixture.data("together-events")) as? [String: Any])
        return try #require(object["chunks"] as? [String])
    }

    @Test("The recorded stream: a state, the next state after a change, then end")
    func recorded() throws {
        var parser = SSEParser()
        var messages: [SSEMessage] = []
        for chunk in try chunks() { messages += parser.feed(Data(chunk.utf8)) }
        #expect(messages.map(\.event) == ["state", "state", "end"])
        let events = messages.compactMap(TogetherEvent.init)
        #expect(events.count == 3)
        guard case .state(let first) = events[0], case .state(let second) = events[1] else {
            Issue.record("two states first")
            return
        }
        #expect(first.playing && !second.playing)
        #expect(second.version == first.version + 1)
        #expect(first.you == TogetherYou(id: 2, host: false, member: true))
        #expect(first.members.map(\.username) == ["ada", "sam"])
        #expect(events[2] == .end)
    }

    @Test("The same stream a byte at a time, and cut anywhere, reads the same")
    func chunked() throws {
        let body = Data(try chunks().joined().utf8)
        var whole = SSEParser()
        let expected = whole.feed(body)
        var bytes = SSEParser()
        var one: [SSEMessage] = []
        for byte in body {
            if let message = bytes.feed(byte) { one.append(message) }
        }
        #expect(one == expected)
        for cut in [1, 7, 19, 400, body.count - 3] {
            var parser = SSEParser()
            let messages = parser.feed(body.prefix(cut)) + parser.feed(body.dropFirst(cut))
            #expect(messages == expected, "cut at \(cut)")
        }
    }

    @Test("Line endings, comments, a message in several data lines, no space after the colon, ids")
    func syntax() {
        var parser = SSEParser()
        let text = ": keep-alive\r\nevent: ping\r\ndata:{\"serverTime\":5,\r\ndata:\"version\":2}\r\nid: 41\r\n\r\nevent: state\ndata: x\n\ndata: only\n\n\n\n"
        let messages = parser.feed(Data(text.utf8))
        #expect(messages.count == 3)
        #expect(messages[0] == SSEMessage(event: "ping", data: "{\"serverTime\":5,\n\"version\":2}", id: "41"))
        #expect(messages[1].event == "state" && messages[1].data == "x")
        // No event name: a message.
        #expect(messages[2].event == "message" && messages[2].data == "only")
        #expect(parser.lastEventId == "41")
        #expect(TogetherEvent(messages[0]) == .ping(serverTime: 5, version: 2))
    }

    @Test("A message not finished is held; a lone CR ends a line; a blank line with nothing before it says nothing")
    func partial() {
        var parser = SSEParser()
        #expect(parser.feed(Data("event: end\ndata: {}\n".utf8)).isEmpty)
        #expect(parser.feed(Data("\n".utf8)).map(\.event) == ["end"])
        #expect(parser.feed(Data("\n\n".utf8)).isEmpty)
        #expect(parser.feed(Data("data: a\rdata: b\r\r".utf8)).map(\.data) == ["a\nb"])
    }

    @Test("Events this app does not know, and broken ones, are skipped: the next state says everything")
    func unknown() {
        #expect(TogetherEvent(SSEMessage(event: "hello", data: "{}")) == nil)
        #expect(TogetherEvent(SSEMessage(event: "state", data: "{not json")) == nil)
        #expect(TogetherEvent(SSEMessage(event: "state", data: #"{"id":"x"}"#)) == nil)
        #expect(TogetherEvent(SSEMessage(event: "ping", data: "[]")) == nil)
        #expect(TogetherEvent(SSEMessage(event: "end", data: "")) == .end)
        #expect(TogetherEvent(SSEMessage(event: "ping", data: #"{"serverTime":9}"#)) == .ping(serverTime: 9, version: 0))
    }
}

// MARK: - Staying in step

@Suite("Listen together: staying in step")
struct TogetherSyncTests {
    @Test("The clock: a request's midpoint, the shortest round trip wins, a push only raises it")
    func clock() {
        var clock = ClockSync()
        #expect(clock.offset == nil)
        #expect(clock.toServer(1000) == 1000)
        // Sent at 1000, received at 1400, stamped 5500: the offset is 5500 − 1200 = 4300.
        clock.request(serverTime: 5500, sentAt: 1000, receivedAt: 1400)
        #expect(clock.offset == 4300)
        // A slower round trip says 4000, but is not as sure.
        clock.request(serverTime: 5000, sentAt: 2000, receivedAt: 3000)
        #expect(clock.offset == 4300)
        // A faster one wins.
        clock.request(serverTime: 7010, sentAt: 3000, receivedAt: 3020)
        #expect(clock.offset == 4000)
        #expect(clock.toServer(10_000) == 14_000)
        // A pushed event says the offset is at least this: it raises, never lowers.
        clock.pushed(serverTime: 9000, receivedAt: 4000)
        #expect(clock.offset == 5000)
        clock.pushed(serverTime: 4100, receivedAt: 4000)
        #expect(clock.offset == 5000)
        var fresh = ClockSync()
        fresh.pushed(serverTime: 9000, receivedAt: 4000)
        #expect(fresh.offset == 5000)
    }

    @Test("Only the last 8 samples count")
    func keeps() {
        var clock = ClockSync(keep: 3)
        clock.request(serverTime: 100, sentAt: 0, receivedAt: 2)
        for i in 1...3 { clock.request(serverTime: 200 + Double(i), sentAt: Double(i) * 10, receivedAt: Double(i) * 10 + 100) }
        // The quick first sample is gone: the offset is one of the later, slower ones.
        #expect(clock.offset != 99)
    }

    private func state(playing: Bool, startedAt: Double?, position: Double, at serverTime: Double, duration: Int = 200_000) -> TogetherState {
        let ref = TrackRef(id: "t", title: "T", artist: "A", durationMs: duration)
        return TogetherState(
            id: sid, url: "", host: TogetherPerson(id: 1, username: "ada"), you: TogetherYou(id: 2, host: false, member: true),
            now: TogetherItem(uid: "u", track: ref, addedBy: TogetherPerson(id: 1, username: "ada")), playing: playing,
            startedAt: startedAt, positionMs: position, serverTime: serverTime)
    }

    @Test("Where the song should be: from when it started while playing, held while paused, never past its end")
    func expected() {
        #expect(state(playing: true, startedAt: 1000, position: 0, at: 1000).expectedPosition(at: 13_000) == 12_000)
        #expect(state(playing: false, startedAt: nil, position: 40_000, at: 1000).expectedPosition(at: 99_000) == 40_000)
        // No start time but playing: from the position at the time of the answer.
        #expect(state(playing: true, startedAt: nil, position: 5000, at: 1000).expectedPosition(at: 3000) == 7000)
        #expect(state(playing: true, startedAt: 1000, position: 0, at: 1000).expectedPosition(at: 900_000) == 200_000)
        #expect(state(playing: true, startedAt: 5000, position: 0, at: 1000).expectedPosition(at: 1000) == 0)
        var nothing = state(playing: true, startedAt: 1000, position: 0, at: 1000)
        nothing.now = nil
        #expect(nothing.expectedPosition(at: 5000) == 4000)
    }

    private func target(_ track: String? = "a", playing: Bool = true, at position: Double = 10_000) -> TogetherTarget {
        TogetherTarget(trackId: track, playing: playing, positionMs: position, durationMs: 200_000)
    }

    private func local(_ track: String? = "a", active: Bool = true, loading: Bool = false, at position: Double = 10_000) -> TogetherLocal {
        TogetherLocal(trackId: track, active: active, loading: loading, positionMs: position)
    }

    @Test("Another song is loaded at the session's position, playing or not as the session is")
    func load() {
        #expect(TogetherPlan.step(target("b"), local("a")) == .load(positionMs: 10_000, play: true))
        #expect(TogetherPlan.step(target("b", playing: false), local(nil, active: false)) == .load(positionMs: 10_000, play: false))
    }

    @Test("Nothing in the session: a player still playing stops, one that has stopped is left")
    func stop() {
        #expect(TogetherPlan.step(target(nil), local("a")) == .stop)
        #expect(TogetherPlan.step(target(nil), local("a", active: false)) == nil)
        #expect(TogetherPlan.step(target(nil), local(nil, active: false)) == nil)
    }

    @Test("A song still loading is left alone")
    func loading() {
        #expect(TogetherPlan.step(target(), local(loading: true, at: 0)) == nil)
    }

    @Test("Paused in the session: a player that plays pauses at its position; one paused near it is in step")
    func paused() {
        #expect(TogetherPlan.step(target(playing: false), local(active: true)) == .pause(positionMs: 10_000))
        #expect(TogetherPlan.step(target(playing: false), local(active: false, at: 10_200)) == nil)
        #expect(TogetherPlan.step(target(playing: false), local(active: false, at: 12_000)) == .pause(positionMs: 10_000))
    }

    @Test("Playing: within 300 ms is in step, further is put right; a stopped player moves, then plays")
    func playing() {
        #expect(TogetherPlan.step(target(), local(at: 10_300)) == nil)
        #expect(TogetherPlan.step(target(), local(at: 10_301)) == .seek(positionMs: 10_000))
        #expect(TogetherPlan.step(target(), local(at: 9_000)) == .seek(positionMs: 10_000))
        #expect(TogetherPlan.step(target(), local(active: false, at: 10_100)) == .play)
        #expect(TogetherPlan.step(target(), local(active: false, at: 3_000)) == .seek(positionMs: 10_000))
    }

    @Test("A correction gets 2.5 s to settle: no seek on top of a seek, but a stopped player is still started")
    func settling() {
        #expect(TogetherPlan.step(target(), local(at: 3_000), settling: true) == nil)
        #expect(TogetherPlan.step(target(), local(active: false, at: 10_000), settling: true) == .play)
    }

    @Test("A song that ended here a moment early waits for the session to move on")
    func ending() {
        let end = TogetherTarget(trackId: "a", playing: true, positionMs: 199_000, durationMs: 200_000)
        #expect(TogetherPlan.step(end, local(active: false, at: 200_000)) == nil)
        let over = TogetherTarget(trackId: "a", playing: true, positionMs: 200_000, durationMs: 200_000)
        #expect(TogetherPlan.step(over, local(active: true, at: 150_000)) == nil)
        // Not near the end: stopped is played.
        #expect(TogetherPlan.step(target(at: 100_000), local(active: false, at: 100_000)) == .play)
    }

    @Test("Cued ahead: 1.5 s on, started when the session gets there; near the end, as it is")
    func cue() {
        #expect(TogetherPlan.cue(positionMs: 12_000, durationMs: 200_000) == (atMs: 13_500, waitMs: 1_500))
        #expect(TogetherPlan.cue(positionMs: 0, durationMs: 0) == (atMs: 1_500, waitMs: 1_500))
        #expect(TogetherPlan.cue(positionMs: 199_000, durationMs: 200_000) == (atMs: 199_000, waitMs: 0))
    }
}

// MARK: - The codes and links that name a session

@Suite("Listen together: codes and links")
struct TogetherLinkTests {
    let server = URL(string: "https://echo.folk3s.com")!

    @Test("The link the QR code holds, for this server, and the app's own")
    func ours() {
        #expect(TogetherLink.id(in: "https://echo.folk3s.com/together/\(sid)", server: server) == sid)
        #expect(TogetherLink.id(in: "  https://ECHO.folk3s.com/together/\(sid)/\n", server: server) == sid)
        #expect(TogetherLink.id(in: "echo://together/\(sid)", server: server) == sid)
        #expect(TogetherLink.id(in: "echo://together#\(sid)", server: server) == sid)
        #expect(TogetherLink.id(in: "ECHO://Together/\(sid)", server: server) == sid)
        #expect(TogetherLink.url(id: sid).absoluteString == "echo://together/\(sid)")
        #expect(TogetherLink.id(in: TogetherLink.url(id: sid).absoluteString, server: server) == sid)
    }

    @Test("Another server's link, other pages and broken ids are not this server's invitation")
    func notOurs() {
        for text in [
            "https://music.example.org/together/\(sid)", "http://echo.folk3s.com/together/\(sid)",
            "https://echo.folk3s.com:8443/together/\(sid)", "https://echo.folk3s.com/together/short",
            "https://echo.folk3s.com/together/", "https://echo.folk3s.com/together",
            "https://echo.folk3s.com/album/\(sid)", "https://echo.folk3s.com/together/\(sid)/more",
            "https://echo.folk3s.com/together/has spaces in it, sixteen+", "echo://now-playing", "echo://together",
            "echo://together/short", "WIFI:S:Harbour;T:WPA;P:lamplight;;", "hello", "",
        ] {
            #expect(TogetherLink.id(in: text, server: server) == nil, "\(text)")
        }
        #expect(TogetherLink.host(of: "https://music.example.org/together/\(sid)") == "music.example.org")
        #expect(TogetherLink.host(of: "https://music.example.org/guest#\(sid)") == nil)
    }

    @Test("A scanned code: an invitation for this server, another's, and what else it can be")
    func payload() {
        #expect(ScanPayload("https://echo.folk3s.com/together/\(sid)", server: server) == .together(id: sid))
        #expect(ScanPayload("echo://together/\(sid)", server: server) == .together(id: sid))
        #expect(ScanPayload("https://music.example.org/together/\(sid)", server: server) == .otherServer(host: "music.example.org"))
        #expect(ScanPayload("https://echo.folk3s.com/together/short", server: server) == .unknown)
        // The others still read as they did.
        #expect(ScanPayload("https://echo.folk3s.com/guest#guest-code-for-tests-0001", server: server)
            == .guest(code: "guest-code-for-tests-0001"))
    }

    @Test("The app's own link: echo://together/id or #id, and back")
    func appLink() throws {
        for text in ["echo://together/\(sid)", "echo://together#\(sid)", "ECHO://Together/\(sid)"] {
            #expect(AppLink(try #require(URL(string: text))) == .together(id: sid), "\(text)")
        }
        #expect(AppLink.together(id: sid).url.absoluteString == "echo://together/\(sid)")
        #expect(AppLink(AppLink.together(id: sid).url) == .together(id: sid))
        #expect(AppLink(try #require(URL(string: "echo://together/short"))) == nil)
        #expect(AppLink(try #require(URL(string: "echo://together"))) == nil)
        #expect(AppLink(try #require(URL(string: "echo://now-playing"))) == .nowPlaying)
    }
}

// MARK: - The calls, against the stub

@MainActor
@Suite("Listen together: the calls")
struct TogetherApiTests {
    let stub = Stub()
    let sleeps = Sleeps()

    var client: EchoClient {
        EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session, sleep: sleeps.sleep, jitter: { 0 })
    }

    private func ref(_ n: Int) -> TrackRef { TrackRef(song(n)) }

    @Test("The session this person is in, or none")
    func current() async throws {
        stub.on("GET", "/together", .fixture("together-none"), .fixture("together-current"))
        let none = try await client.current()
        #expect(none == nil)
        let found = try #require(try await client.current())
        #expect(found.id == sid)
        #expect(stub.requests("GET", "/together").first?.bearer == "echo_dt_test")
    }

    @Test("Starting on a song: the song, where it is, whether it plays, and what is next")
    func start() async throws {
        stub.on("POST", "/together", .fixture("together-started", status: 201))
        let s = try await client.start(TogetherSeed(track: ref(1), positionMs: 12_345.6, playing: true, queue: [ref(2), ref(3)]))
        #expect(s.you.host)
        let body = try #require(stub.requests("POST", "/together").first?.json)
        let track = try #require(body["track"] as? [String: Any])
        #expect(track["id"] as? String == "al-1-t1")
        #expect(track["title"] as? String == "Song 1")
        #expect(track["artist"] as? String == "Lowfield")
        #expect(track["artistId"] as? String == "ar-1")
        #expect(track["albumId"] as? String == "al-1")
        #expect(track["durationMs"] as? Int == 200_000)
        #expect(track["cover"] as? String == "/api/v1/navidrome/cover/al-1?size=600")
        #expect(body["positionMs"] as? Double == 12_346)
        #expect(body["playing"] as? Bool == true)
        #expect((body["queue"] as? [[String: Any]])?.map { $0["id"] as? String } == ["al-1-t2", "al-1-t3"])
    }

    @Test("Starting with nothing playing: an empty session, nothing else sent; at most 100 songs of what is next")
    func startEmpty() async throws {
        stub.on("POST", "/together", .fixture("together-started-empty", status: 201))
        _ = try await client.start(TogetherSeed(track: nil, positionMs: 5000, playing: true, queue: [ref(1)]))
        let body = try #require(stub.requests("POST", "/together").first?.json)
        #expect(body.isEmpty)
        stub.on("POST", "/together", .fixture("together-started", status: 201))
        _ = try await client.start(TogetherSeed(track: ref(1), queue: (1...150).map { _ in ref(2) }))
        let last = try #require(stub.requests("POST", "/together").last?.json)
        #expect((last["queue"] as? [Any])?.count == 100)
    }

    @Test("Looking at a session before joining, joining, leaving (the host's leaving ends it)")
    func joinAndLeave() async throws {
        stub.on("GET", "/together/\(sid)", .fixture("together-peek"))
        stub.on("POST", "/together/\(sid)/join", .fixture("together-join"))
        stub.on("POST", "/together/\(sid)/leave", .fixture("together-leave"), .fixture("together-end"))
        let peek = try await client.peek(sid)
        #expect(!peek.you.member)
        let joined = try await client.join(sid)
        #expect(joined.you.member)
        let left = try await client.leave(sid)
        #expect(!left)
        let ended = try await client.leave(sid)
        #expect(ended)
        #expect(stub.requests("POST", "/together/\(sid)/join").count == 1)
    }

    @Test("The shared queue: add at the end or next, remove by its id")
    func queue() async throws {
        stub.on("POST", "/together/\(sid)/queue", .fixture("together-queue-added"), .fixture("together-queue-next"))
        stub.on("DELETE", "/together/\(sid)/queue/together-item-4", .fixture("together-remove"))
        let added = try await client.add(sid, track: ref(5), next: false)
        #expect(added.queue.count >= 3)
        _ = try await client.add(sid, track: ref(6), next: true)
        let bodies = stub.requests("POST", "/together/\(sid)/queue").compactMap(\.json)
        #expect(bodies.map { $0["next"] as? Bool } == [false, true])
        #expect((bodies[1]["track"] as? [String: Any])?["id"] as? String == "al-1-t6")
        _ = try await client.remove(sid, uid: "together-item-4")
        #expect(stub.requests("DELETE", "/together/\(sid)/queue/together-item-4").count == 1)
    }

    @Test("The host's transport: each action as the server takes it")
    func control() async throws {
        stub.on("POST", "/together/\(sid)/control", .fixture("together-pause"))
        for action in [
            TogetherAction.play, .pause, .seek(positionMs: 90_000.4), .next(from: "together-item-1"), .next(from: nil),
            .previous, .jump(uid: "together-item-2"),
        ] {
            _ = try await client.control(sid, action)
        }
        let bodies = stub.requests("POST", "/together/\(sid)/control").compactMap(\.json)
        #expect(bodies.map { $0["action"] as? String } == ["play", "pause", "seek", "next", "next", "previous", "jump"])
        #expect(bodies[2]["positionMs"] as? Double == 90_000)
        #expect(bodies[3]["from"] as? String == "together-item-1")
        #expect(bodies[4]["from"] == nil)
        #expect(bodies[6]["uid"] as? String == "together-item-2")
        #expect(bodies[0]["positionMs"] == nil && bodies[0]["uid"] == nil)
    }

    @Test("Refusals: host only, a session that is gone, another library, 400s")
    func refusals() async {
        stub.on("POST", "/together/\(sid)/control", .fixture("together-control-denied", status: 403))
        stub.on("GET", "/together/\(sid)", .fixture("together-not-found", status: 404))
        stub.on("POST", "/together/\(sid)/join", .body(#"{"error":"other_library","host":"ada"}"#, status: 409))
        stub.on("POST", "/together/\(sid)/queue", .fixture("together-queue-bad", status: 400))
        await #expect(throws: TogetherError.hostOnly) { try await client.control(sid, .pause) }
        await #expect(throws: TogetherError.gone) { try await client.peek(sid) }
        await #expect(throws: TogetherError.otherLibrary(host: "ada")) { try await client.join(sid) }
        await #expect(throws: TogetherError.refused("bad_track")) { try await client.add(sid, track: TrackRef(id: "x", title: "X", artist: ""), next: false) }
    }

    @Test("Over the API budget: a read is asked again after Retry-After; a write is not repeated")
    func rateLimited() async throws {
        let limited = Reply.fixture("rate-limited", status: 429, headers: ["Retry-After": "1"])
        stub.on("GET", "/together/\(sid)", limited, .fixture("together-peek"))
        let peek = try await client.peek(sid)
        #expect(peek.id == sid)
        #expect(sleeps.all == [.seconds(1)])
        stub.on("POST", "/together/\(sid)/control", limited)
        await #expect(throws: TogetherError.rateLimited(retryAfter: 1)) { try await client.control(sid, .play) }
        #expect(stub.requests("POST", "/together/\(sid)/control").count == 1)
    }

    @Test("Not signed in: the token is refused and the call says so")
    func unauthenticated() async {
        stub.on("GET", "/together", .fixture("unauthenticated", status: 401))
        await #expect(throws: TogetherError.api(.signedOut)) { try await client.current() }
    }

    @Test("The stream, read from the server: its events in order, over the bearer header")
    func stream() async throws {
        let object = try #require(try JSONSerialization.jsonObject(with: Fixture.data("together-events")) as? [String: Any])
        let body = try #require(object["chunks"] as? [String]).joined()
        stub.on("GET", "/together/\(sid)/events", .json(200, Data(body.utf8), headers: ["Content-Type": "text/event-stream"]))
        var events: [TogetherEvent] = []
        for try await event in client.events(sid) { events.append(event) }
        #expect(events.count == 3)
        #expect(events.last == .end)
        let request = try #require(stub.requests("GET", "/together/\(sid)/events").first)
        #expect(request.headers["Accept"] == "text/event-stream")
        #expect(request.bearer == "echo_dt_test")
    }

    @Test("The stream refused: the session gone, not a member, over the budget with its wait")
    func streamRefused() async {
        stub.on("GET", "/together/\(sid)/events", .fixture("together-not-found", status: 404))
        await #expect(throws: TogetherError.gone) { for try await _ in client.events(sid) {} }
        stub.on("GET", "/together/\(sid)/events", .fixture("together-queue-not-member", status: 403))
        await #expect(throws: TogetherError.notMember) { for try await _ in client.events(sid) {} }
        stub.on("GET", "/together/\(sid)/events", .fixture("rate-limited", status: 429, headers: ["Retry-After": "7"]))
        await #expect(throws: TogetherError.rateLimited(retryAfter: 7)) { for try await _ in client.events(sid) {} }
        stub.on("GET", "/together/\(sid)/events", .failure(.notConnectedToInternet))
        await #expect(throws: TogetherError.api(.offline)) { for try await _ in client.events(sid) {} }
    }
}

// MARK: - The scanner

@MainActor
@Suite("Listen together: scanning a code")
struct TogetherScanTests {
    let stub = Stub()

    func session() -> Session {
        Session(
            server: stub.base, tokens: MemoryTokenStore("echo_dt_test"), http: stub.session,
            deviceName: { "ECHO for iPhone" }, cache: nil, watchNetwork: false)
    }

    private var link: String { "\(stub.base.absoluteString)/together/\(sid)" }

    @Test("An invitation goes to Listen together, which offers it; the scanner is done")
    func invitation() async {
        let t = TRig()
        var peek = t.state(1)
        peek.you = TogetherYou(id: 2, host: false, member: false)
        t.fake.answer("peek", .success(peek))
        let flow = ScanFlow(purpose: .joinTogether, session: session(), together: t.together)
        await flow.scanned(link)
        #expect(flow.step == .joined)
        #expect(await eventually { t.together.offer == .ready(id: sid, host: "ada", members: 2) })
    }

    @Test("The app's own link scans the same")
    func appLink() async {
        let t = TRig()
        t.fake.answer("peek", .failure(.gone))
        let flow = ScanFlow(purpose: .joinTogether, session: session(), together: t.together)
        await flow.scanned(TogetherLink.url(id: sid).absoluteString)
        #expect(flow.step == .joined)
        #expect(await eventually { t.together.offer == .gone(id: sid) })
    }

    @Test("Other codes at this scanner say what they are; an invitation at the other scanners says where to scan it")
    func others() async {
        let t = TRig()
        let s = session()
        let base = stub.base.absoluteString
        let together = ScanFlow(purpose: .joinTogether, session: s, together: t.together)
        await together.scanned("\(base)/link#qr-request-for-tests-0001")
        #expect(together.note == "That's ECHO's sign-in code for a computer, not a Listen together code.")
        await together.scanned("\(base)/guest#guest-code-for-tests-0001")
        #expect(together.note == "That's a guest pass, not a Listen together code.")
        await together.scanned("https://music.example.org/together/\(sid)")
        #expect(together.note == "That code is for music.example.org, not \(s.server).")
        await together.scanned("hello")
        #expect(together.note == "That isn't a Listen together code from \(s.server).")
        #expect(together.step == .scanning)
        for purpose in [ScanFlow.Purpose.signInComputer, .joinAsGuest] {
            let flow = ScanFlow(purpose: purpose, session: s, together: t.together)
            await flow.scanned(link)
            #expect(flow.note == "That's a Listen together code. Scan it from Now Playing → Together.")
            #expect(flow.step == .scanning)
        }
        #expect(t.fake.calls.isEmpty)
    }

    @Test("A guest joins a session like anyone: nothing about being a guest stops it")
    func guest() async {
        let t = TRig()
        var peek = t.state(1)
        peek.you = TogetherYou(id: 9, host: false, member: false)
        t.fake.answer("peek", .success(peek))
        t.fake.answer("join", .success(t.state(1)))
        await t.together.consider(sid)
        await t.together.join(sid)
        #expect(t.together.session != nil)
        #expect(t.notes.all == ["Listening together with ada"])
        // The guest's controls are a member's.
        t.player.next()
        #expect(t.notes.all.last == Together.hostOnly)
    }
}
