import Foundation
import Testing

// Following a session with a player (Together/Together.swift), on a fake engine and a fake source
// (no sound, no network): the host's play, pause, seek and next applied with the output's latency; a
// member's controls and what they say; the shared queue's requests; events in order, duplicates and
// gaps; reconnecting with backoff; leaving and ending; and that the personal queue is never touched.

/// A session to follow, on a player with a fake engine; waits pass at once and loops are driven by
/// the tests (`follow()`, `listen(_:)`).
@MainActor
final class TRig {
    let rig: Rig
    let fake: FakeTogether
    let notes: Notices
    let together: Together
    let ada = TogetherPerson(id: 1, username: "ada")

    init() {
        let rig = Rig()
        let fake = FakeTogether()
        let notes = Notices()
        self.rig = rig
        self.fake = fake
        self.notes = notes
        together = Together(
            source: fake, player: rig.player, server: URL(string: "https://echo.test")!, notify: { notes.add($0) },
            sleep: rig.sleeps.sleep, now: { [clock = rig.clock] in clock.now }, loops: false)
    }

    var player: Player { rig.player }
    var engine: FakeEngine { rig.engine }

    /// Milliseconds on the rig's clock.
    var nowMs: Double { rig.clock.now.timeIntervalSince1970 * 1000 }

    func item(_ n: Int, by person: TogetherPerson? = nil) -> TogetherItem {
        TogetherItem(uid: "u\(n)", track: TrackRef(song(n)), addedBy: person ?? ada)
    }

    /// A session as of now: song `now` (nil: nothing) at `position` ms, `queue` songs after it.
    func state(
        _ version: Int, host: Bool = false, playing: Bool = true, at position: Double = 0, now n: Int? = 1,
        queue: [Int] = [], id: String = sid
    ) -> TogetherState {
        TogetherState(
            id: id, url: "/together/\(id)", host: ada, you: TogetherYou(id: host ? 1 : 2, host: host, member: true),
            members: [
                TogetherMember(id: 1, username: "ada", host: true, online: true),
                TogetherMember(id: 2, username: "sam", host: false, online: true),
            ],
            now: n.map { item($0) }, queue: queue.map { item($0) }, playing: playing && n != nil,
            startedAt: playing && n != nil ? nowMs - position : nil, positionMs: position, serverTime: nowMs, version: version)
    }

    /// Joined as a member (or the host) on `state`, with the song cued.
    func join(_ state: TogetherState) async {
        fake.answer("join", .success(state))
        await together.join(sid)
    }

    /// Joined, and playing in step: the cue's wait is over and the clock moved on 5 s (the settling too).
    func playingInStep(host: Bool = false, position: Double = 12_000) async -> TogetherState {
        let s = state(1, host: host, at: position)
        await join(s)
        _ = await eventually { engine.current != nil }
        together.cueElapsed()
        rig.clock.advance(5)
        return s
    }

    func controlled(_ count: Int) async -> Bool {
        await eventually { fake.controls().count >= count }
    }
}

@MainActor private func seeks(_ engine: FakeEngine) -> [Double] {
    engine.calls.compactMap { call in
        if case .seek(let to) = call { return to }
        return nil
    }
}

@MainActor
@Suite("Listen together: following the session")
struct TogetherFollowTests {
    @Test("Joining: the player takes the session's song, cued ahead and started when the session gets there")
    func joinFollows() async throws {
        let t = TRig()
        await t.join(t.state(1, at: 12_000))
        #expect(t.together.session?.id == sid)
        #expect(t.player.remote != nil)
        #expect(t.notes.all == ["Listening together with ada"])
        #expect(t.player.track?.id == "al-1-t1")
        #expect(t.player.context == PlayContext(kind: "together", id: sid, title: "ada's session"))
        #expect(await eventually { t.engine.current?.key == "navidrome:al-1-t1" })
        // 12 s in, cued 1.5 s on, paused until the session gets there.
        #expect(t.engine.calls.contains(.load("navidrome:al-1-t1", at: 13.5, play: false)))
        #expect(!t.player.isPlaying)
        t.together.cueElapsed()
        #expect(t.engine.calls.last == .play)
        #expect(t.player.isPlaying)
        // The sound goes on as the session does: nothing more is asked of the engine.
        let calls = t.engine.calls.count
        t.together.follow()
        #expect(t.engine.calls.count == calls)
    }

    @Test("The recorded session: joined from the server's own answer, its song and clock")
    func recorded() async throws {
        let t = TRig()
        t.fake.answer("join", .success(try JSONDecoder().decode(TogetherState.self, from: Fixture.data("together-join"))))
        await t.together.join(sid)
        #expect(t.together.session?.queue.map(\.track.id).contains("al-1-t2") == true)
        // The server's clock was far ahead of the rig's: the song is where the server says it is (the
        // answer's own time, 17 s in), not at 0 and not hours in; cued 1.5 s on from there.
        let s = try #require(t.together.session)
        let position = s.serverTime - (try #require(s.startedAt))
        #expect(position > 0 && position < 200_000)
        #expect(t.player.track?.id == "al-1-t1")
        #expect(await eventually { t.engine.current != nil })
        #expect(t.engine.calls.contains(.load("navidrome:al-1-t1", at: (position + 1500) / 1000, play: false)))
    }

    @Test("Paused in the session: the song is cued paused at its position, and stays")
    func pausedSession() async throws {
        let t = TRig()
        await t.join(t.state(1, playing: false, at: 20_000))
        #expect(await eventually { t.engine.current != nil })
        #expect(t.engine.calls.contains(.load("navidrome:al-1-t1", at: 20, play: false)))
        t.together.follow()
        #expect(!t.engine.calls.contains(.play))
        #expect(!t.player.isPlaying)
    }

    @Test("The host's pause and play, seek and next, applied here: pause holds where the session is")
    func hostTransportFollowed() async throws {
        let t = TRig()
        _ = await t.playingInStep()
        #expect(t.player.isPlaying)
        // Paused at 31 s.
        t.together.apply(t.state(2, playing: false, at: 31_000))
        #expect(t.engine.calls.contains(.pause))
        #expect(seeks(t.engine).last == 31)
        #expect(!t.player.isPlaying)
        // Playing again from there: cued ahead, started when the session gets there.
        t.rig.clock.advance(1)
        t.together.apply(t.state(3, playing: true, at: 31_000))
        t.together.cueElapsed()
        #expect(t.player.isPlaying)
        // The next song: loaded.
        t.together.apply(t.state(4, at: 0, now: 2))
        #expect(t.player.track?.id == "al-1-t2")
        #expect(await eventually { t.engine.current?.key == "navidrome:al-1-t2" })
        // Nothing in the session any more: it stops.
        t.together.cueElapsed()
        t.together.apply(t.state(5, now: nil))
        #expect(!t.player.isPlaying)
    }

    @Test("Drift: 300 ms is left, more is put right, a place asked of the engine is that far on by the output's latency")
    func drift() async throws {
        let t = TRig()
        t.engine.latency = 0.25
        _ = await t.playingInStep()
        // The session is at 17 s. What is heard is the engine's time less the latency.
        t.engine.play(to: 17.25 + 0.2)
        t.together.follow()
        #expect(seeks(t.engine).isEmpty)
        // 3 s behind: paused, moved to where the session will be in 1.5 s (18.5 s), plus the latency.
        t.engine.play(to: 14.25)
        t.together.follow()
        #expect(seeks(t.engine) == [18.75])
        #expect(t.engine.calls.contains(.pause))
        t.together.cueElapsed()
        #expect(t.engine.calls.last == .play)
        // No second correction while this one settles.
        t.engine.play(to: 3)
        t.together.follow()
        #expect(seeks(t.engine) == [18.75])
    }

    @Test("A song that ends here a moment early waits for the session; a member's player never starts it again")
    func endsEarly() async throws {
        let t = TRig()
        await t.join(t.state(1, at: 190_000))
        _ = await eventually { t.engine.current != nil }
        t.together.cueElapsed()
        let loads = t.engine.loads.count
        t.engine.finish()
        #expect(t.player.status == .ended)
        t.rig.clock.advance(6)
        t.together.apply(t.state(2, at: 199_000))
        t.together.follow()
        #expect(t.engine.loads.count == loads)
        #expect(!t.player.isPlaying)
        #expect(t.fake.controls().isEmpty)
        // The session moves on: the next song loads.
        t.together.apply(t.state(3, at: 0, now: 2))
        #expect(t.player.track?.id == "al-1-t2")
    }

    @Test("Songs ending: the host's player tells the session which song ended")
    func hostSongEnded() async throws {
        let t = TRig()
        t.fake.answer("control", .success(t.state(9, at: 0, now: 2)))
        _ = await t.playingInStep(host: true, position: 150_000)
        t.engine.finish()
        #expect(await t.controlled(1))
        #expect(t.fake.controls() == [.next(from: "u1")])
    }

    @Test("The system pausing the sound (the headphones out) is not undone by the session; Play is")
    func headphones() async throws {
        let t = TRig()
        _ = await t.playingInStep()
        t.engine.send(.headphonesOut)
        #expect(!t.player.isPlaying)
        #expect(t.player.followHeld)
        t.together.follow()
        #expect(!t.player.isPlaying)
        // The person plays on: following again, in step.
        t.player.resume()
        #expect(!t.player.followHeld)
        #expect(t.notes.all.last != Together.hostOnly)
        #expect(t.fake.controls().isEmpty)
    }
}

@MainActor
@Suite("Listen together: who controls what")
struct TogetherRulesTests {
    @Test("A member's Play, Next, Previous and seek say only the host controls playback, and ask nothing")
    func memberControls() async throws {
        let t = TRig()
        _ = await t.playingInStep()
        t.player.toggle()
        t.player.pause()
        t.player.next()
        t.player.previous()
        t.player.seek(to: 30)
        #expect(t.notes.all.filter { $0 == "Only the host controls playback." }.count == 5)
        #expect(t.fake.controls().isEmpty)
        #expect(t.player.isPlaying)
        // Next stays pressable, so a member hears who controls.
        #expect(t.player.hasNext)
    }

    @Test("The lock screen's and the widget's commands go the same way")
    func lockScreen() async throws {
        let t = TRig()
        _ = await t.playingInStep()
        #expect(t.player.handle(.pause))
        #expect(t.player.handle(.next))
        #expect(t.player.handle(.seek(5)))
        #expect(t.notes.all.filter { $0 == "Only the host controls playback." }.count == 3)
        #expect(t.fake.controls().isEmpty)
    }

    @Test("A member adds songs: Add to Queue at the end, Play Next next (in order), a song from a list at the end")
    func memberAdds() async throws {
        let t = TRig()
        t.fake.answer("add", .success(t.state(2, queue: [2])))
        _ = await t.playingInStep()
        t.player.addToQueue([song(2)])
        #expect(await eventually { t.notes.all.contains("Added “Song 2” to the shared queue") })
        t.player.playNext([song(3), song(4)], label: "Two songs")
        #expect(await eventually { t.notes.all.contains("“Two songs” plays next for everyone") })
        await t.player.play(songs(5...6), at: 1)
        #expect(await eventually { t.notes.all.contains("Added “Song 6” to the shared queue") })
        let adds = t.fake.calls.compactMap { call -> String? in
            if case .add(_, let id, let next) = call { return "\(id) \(next ? "next" : "end")" }
            return nil
        }
        // Play Next adds the last song first, so the two end up in their order.
        #expect(adds == ["al-1-t2 end", "al-1-t4 next", "al-1-t3 next", "al-1-t6 end"])
    }

    @Test("Only songs from the library can be shared")
    func library() async throws {
        let t = TRig()
        _ = await t.playingInStep()
        var other = song(2)
        other.provider = "youtube"
        await t.together.share(other, next: false)
        #expect(t.notes.all.last == "Only songs from your library can be shared.")
        #expect(t.fake.calls.allSatisfy { if case .add = $0 { return false } else { return true } })
    }

    @Test("The host's controls go to the session: play, pause, seek, next, previous")
    func hostControls() async throws {
        let t = TRig()
        t.fake.answer("control", .success(t.state(9, host: true)))
        _ = await t.playingInStep(host: true)
        t.player.toggle()
        #expect(await t.controlled(1))
        t.together.apply(t.state(10, host: true, playing: false, at: 20_000))
        t.player.resume()
        #expect(await t.controlled(2))
        t.player.seek(to: 42.5)
        #expect(await t.controlled(3))
        t.player.next()
        #expect(await t.controlled(4))
        t.player.previous()
        #expect(await t.controlled(5))
        #expect(t.fake.controls() == [.pause, .play, .seek(positionMs: 42_500), .next(from: nil), .previous])
        #expect(!t.notes.all.contains("Only the host controls playback."))
    }

    @Test("The host picks a song from a list: queued first, then played now")
    func hostPlays() async throws {
        let t = TRig()
        let queued = t.state(5, host: true, queue: [7, 2])
        t.fake.answer("add", .success(queued))
        t.fake.answer("control", .success(t.state(6, host: true, now: 7)))
        _ = await t.playingInStep(host: true)
        await t.player.play([song(7)], at: 0)
        #expect(await t.controlled(1))
        #expect(t.fake.calls.contains(.add(sid, id: "al-1-t7", next: true)))
        #expect(t.fake.controls() == [.jump(uid: "u7")])
    }

    @Test("The shared queue: the host removes any song or plays one now; a member is told off for the host's")
    func queueActions() async throws {
        let t = TRig()
        let s = t.state(1, queue: [2, 3])
        await t.join(s)
        t.together.jump(s.queue[0])
        #expect(t.notes.all.last == Together.hostOnly)
        #expect(t.fake.controls().isEmpty)
        t.fake.answer("remove", .success(t.state(2, queue: [3])))
        await t.together.remove(s.queue[0])
        #expect(t.fake.calls.contains(.remove(sid, uid: "u2")))
        #expect(t.together.session?.queue.map(\.uid) == ["u3"])
        t.fake.answer("remove", .failure(.hostOnly))
        await t.together.remove(s.queue[1])
        #expect(t.notes.all.last == Together.hostOnly)
    }

    @Test("A refused add says why: the queue full, too many requests")
    func refusedAdds() async throws {
        let t = TRig()
        _ = await t.playingInStep()
        t.fake.answer("add", .failure(.queueFull), .failure(.rateLimited(retryAfter: 3)))
        await t.together.share(song(2), next: false)
        #expect(t.notes.all.last == "The shared queue is full.")
        await t.together.share(song(2), next: false)
        #expect(t.notes.all.last == "Too many requests. Try again in 3 s.")
        #expect(t.together.session != nil)
    }

    @Test("Cannot reach ECHO: the control says so, and the session stays")
    func unreachable() async throws {
        let t = TRig()
        _ = await t.playingInStep(host: true)
        await t.together.perform(.pause)
        #expect(t.notes.all.last == ApiError.unreachable.userMessage)
        #expect(t.together.session != nil)
    }
}

@MainActor
@Suite("Listen together: events and the order they arrive in")
struct TogetherEventTests {
    @Test("A newer state is taken, an older one dropped, the same one harmless, another session's ignored")
    func ordering() async throws {
        let t = TRig()
        await t.join(t.state(5, queue: [2]))
        t.together.apply(t.state(4, queue: []))
        #expect(t.together.session?.version == 5)
        t.together.apply(t.state(5, queue: [2]))
        #expect(t.together.session?.version == 5)
        t.together.apply(t.state(6, queue: [2, 3]))
        #expect(t.together.session?.queue.count == 2)
        t.together.apply(t.state(9, queue: [], id: "another-session-for-tests-0002"))
        #expect(t.together.session?.id == sid)
        #expect(t.together.session?.version == 6)
        // A state while in no session is ignored.
        let none = TRig()
        none.together.apply(none.state(1))
        #expect(none.together.session == nil)
    }

    @Test("A pushed state raises the clock estimate; a ping with a newer version asks for the state")
    func pings() async throws {
        let t = TRig()
        await t.join(t.state(5))
        t.fake.answer("peek", .success(t.state(7, queue: [4])))
        // The same version: nothing to ask.
        #expect(await t.together.handle(.ping(serverTime: t.nowMs, version: 5)) == false)
        #expect(!t.fake.calls.contains(.peek(sid)))
        // A version it has not seen: asked for, and taken.
        #expect(await t.together.handle(.ping(serverTime: t.nowMs, version: 7)) == false)
        #expect(t.fake.calls.contains(.peek(sid)))
        #expect(t.together.session?.version == 7)
        #expect(await t.together.handle(.state(t.state(8, queue: [4, 5]))) == false)
        #expect(t.together.session?.queue.count == 2)
        #expect(await t.together.handle(.end) == true)
    }

    @Test("The stream closing and breaking: opened again 1, 2, 4 s apart; a state after it puts a gap right; end ends it")
    func reconnect() async throws {
        let t = TRig()
        await t.join(t.state(1))
        t.fake.script(
            [.event(.state(t.state(2, queue: [2]))), .fail(.api(.unreachable))],
            [.fail(.api(.offline))],
            [],
            [.event(.state(t.state(5, queue: [2, 3, 4]))), .event(.end)])
        await t.together.listen(sid)
        let opens = t.fake.calls.filter { if case .events = $0 { return true } else { return false } }
        #expect(opens.count == 4)
        // 1 s after the first break, 2 s after the second, 4 s after the stream that ended quietly.
        #expect(Array(t.rig.sleeps.all.suffix(3)) == [.milliseconds(1000), .milliseconds(2000), .milliseconds(4000)])
        // The end: the session is over here too.
        #expect(t.together.session == nil)
        #expect(t.notes.all.last == "The listening session ended.")
        #expect(t.player.remote == nil)
    }

    @Test("The wait goes back to 1 s once a stream has been heard; the server's 429 wait is kept")
    func backoff() async throws {
        let t = TRig()
        await t.join(t.state(1))
        t.fake.script(
            [.fail(.api(.unreachable))], [.fail(.api(.unreachable))],
            [.event(.state(t.state(2))), .fail(.api(.unreachable))],
            [.fail(.rateLimited(retryAfter: 7))],
            [.fail(.gone)])
        await t.together.listen(sid)
        let waits = t.rig.sleeps.all.suffix(4)
        #expect(Array(waits) == [.milliseconds(1000), .milliseconds(2000), .milliseconds(1000), .seconds(7)])
        #expect(t.together.session == nil)
        #expect(t.notes.all.last == "The listening session ended.")
    }

    @Test("Told it is not a member (dropped for being away): the session is over")
    func dropped() async throws {
        let t = TRig()
        await t.join(t.state(1))
        t.fake.script([.fail(.notMember)])
        await t.together.listen(sid)
        #expect(t.together.session == nil)
    }
}

@MainActor
@Suite("Listen together: joining, starting, leaving")
struct TogetherLifecycleTests {
    @Test("A scanned code or an opened link: whose session it is, then Join; what the person is told when not")
    func offers() async throws {
        let t = TRig()
        var peek = t.state(1)
        peek.you = TogetherYou(id: 2, host: false, member: false)
        t.fake.answer("peek", .success(peek), .failure(.otherLibrary(host: "ada")), .failure(.gone), .failure(.rateLimited(retryAfter: 2)))
        await t.together.consider(sid)
        #expect(t.together.offer == .ready(id: sid, host: "ada", members: 2))
        #expect(t.together.session == nil)
        await t.together.consider(sid)
        #expect(t.together.offer == .otherLibrary(id: sid, host: "ada"))
        await t.together.consider(sid)
        #expect(t.together.offer == .gone(id: sid))
        await t.together.consider(sid)
        #expect(t.together.offer == .failed(id: sid, message: "Too many requests. Try again in 2 s."))
        t.together.dismissOffer()
        #expect(t.together.offer == nil)
    }

    @Test("A session this person is in already: offered, it is joined without asking")
    func alreadyIn() async throws {
        let t = TRig()
        t.fake.answer("peek", .success(t.state(3)))
        await t.together.consider(sid)
        #expect(t.together.session?.id == sid)
        #expect(t.together.offer == nil)
    }

    @Test("Join: the session's answer; joining another library says so; a session gone says so")
    func join() async throws {
        let t = TRig()
        t.fake.answer("join", .failure(.otherLibrary(host: "ada")), .failure(.gone), .failure(.full))
        await t.together.join(sid)
        #expect(t.together.offer == .otherLibrary(id: sid, host: "ada"))
        await t.together.join(sid)
        #expect(t.together.offer == .gone(id: sid))
        await t.together.join(sid)
        #expect(t.together.offer == .failed(id: sid, message: "This listening session is full."))
        #expect(t.together.session == nil)
        #expect(t.player.remote == nil)
    }

    @Test("A link opened before signing in is offered once signed in; a session still on the server is joined again")
    func resume() async throws {
        let t = TRig()
        var peek = t.state(1)
        peek.you = TogetherYou(id: 2, host: false, member: false)
        t.fake.answer("peek", .success(peek))
        t.together.holdLink(sid)
        await t.together.resume()
        #expect(t.together.offer == .ready(id: sid, host: "ada", members: 2))
        let again = TRig()
        again.fake.current = again.state(4)
        await again.together.resume()
        #expect(again.together.session?.version == 4)
        #expect(again.player.remote != nil)
        let none = TRig()
        await none.together.resume()
        #expect(none.together.session == nil)
    }

    @Test("Start: the song playing, where it is, and what is next; the invite opens")
    func start() async throws {
        let t = TRig()
        await t.player.play(songs(1...3), at: 0, context: albumContext)
        _ = await eventually { t.engine.current != nil }
        t.rig.clock.advance(9)
        t.engine.play(to: 9)
        t.fake.answer("start", .success(t.state(0, host: true, at: 9_000, queue: [2, 3])))
        await t.together.start()
        let seed = try #require(t.fake.calls.compactMap { call -> TogetherSeed? in
            if case .start(let seed) = call { return seed }
            return nil
        }.first)
        #expect(seed.track?.id == "al-1-t1")
        #expect(seed.playing)
        #expect(abs(seed.positionMs - 9_000) < 1)
        #expect(seed.queue.map(\.id) == ["al-1-t2", "al-1-t3"])
        #expect(t.together.isHost)
        #expect(t.together.inviteOpen)
        #expect(t.together.label == "Together · 2")
        #expect(t.together.inviteLink?.absoluteString == "https://echo.test/together/\(sid)")
        // The host's own player carries on: no load for the song it is on.
        #expect(t.engine.loads.count == 1)
    }

    @Test("Start with nothing playing: an empty session; refusals say why")
    func startRefused() async throws {
        let t = TRig()
        t.fake.answer("start", .failure(.noLibrary), .failure(.tooManySessions))
        await t.together.start()
        #expect(t.together.note == "Connect your Navidrome library first.")
        await t.together.start()
        #expect(t.together.note?.hasPrefix("Couldn't start listening together.") == true)
        #expect(t.together.session == nil)
        let seed = try #require(t.fake.calls.compactMap { call -> TogetherSeed? in
            if case .start(let seed) = call { return seed }
            return nil
        }.first)
        #expect(seed.track == nil)
        #expect(!t.together.inviteOpen)
    }

    @Test("Leaving puts the queue from before back, paused where it was; the host's leaving ends it for all")
    func leaving() async throws {
        let t = TRig()
        await t.player.play(songs(1...3), at: 1, context: albumContext)
        _ = await eventually { t.engine.current != nil }
        t.rig.clock.advance(30)
        t.engine.play(to: 30)
        await t.join(t.state(1, at: 50_000, now: 9, queue: [8]))
        #expect(t.player.track?.id == "al-1-t9")
        #expect(await eventually { t.engine.current?.key == "navidrome:al-1-t9" })
        await t.together.leave()
        #expect(t.fake.calls.contains(.leave(sid)))
        #expect(t.together.session == nil)
        #expect(t.player.remote == nil)
        #expect(t.notes.all.last == "You left the listening session.")
        // The queue as it was: song 2 of the album, song 3 after it, paused near 30 s.
        #expect(t.player.track?.id == "al-1-t2")
        #expect(t.player.upcoming.map(\.id) == ["al-1-t3"])
        #expect(t.player.status == .paused)
        #expect(abs(t.player.time(at: t.rig.clock.now) - 30) < 1)
        #expect(t.player.context == albumContext)
        // The host ending it.
        let host = TRig()
        host.fake.leaveEnds = true
        await host.join(host.state(1, host: true))
        await host.together.leave()
        #expect(host.notes.all.last == "The listening session ended.")
        // With nothing playing before, nothing is left playing after.
        #expect(host.player.track == nil)
        #expect(host.player.status == .idle)
    }

    @Test("The server ending it: the same, said as an end")
    func serverEnds() async throws {
        let t = TRig()
        await t.join(t.state(1))
        t.fake.script([.event(.end)])
        await t.together.listen(sid)
        #expect(t.together.session == nil)
        #expect(t.notes.all.last == "The listening session ended.")
        #expect(t.player.track == nil)
    }

    @Test("Joining another session straight from one keeps the queue from before the first")
    func switching() async throws {
        let t = TRig()
        await t.player.play(songs(1...2), at: 0, context: albumContext)
        _ = await eventually { t.engine.current != nil }
        await t.join(t.state(1, now: 5))
        t.fake.answer("join", .success(t.state(1, now: 6, id: "second-session-for-tests-0002")))
        await t.together.join("second-session-for-tests-0002")
        #expect(t.together.session?.id == "second-session-for-tests-0002")
        await t.together.leave()
        #expect(t.player.track?.id == "al-1-t1")
        #expect(t.player.upcoming.map(\.id) == ["al-1-t2"])
    }

    @Test("Signing out: no session follows the next account, and nothing is put back")
    func clearing() async throws {
        let t = TRig()
        await t.join(t.state(1))
        t.together.clear()
        #expect(t.together.session == nil)
        #expect(t.player.remote == nil)
        #expect(t.together.offer == nil)
    }
}

// MARK: - The personal queue

@MainActor
@Suite("Listen together: the queue that follows you")
struct TogetherPersonalQueueTests {
    let stub = Stub()
    let sleeps = Sleeps()
    let clock = TestClock()

    var client: EchoClient {
        EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session, sleep: sleeps.sleep, jitter: { 0 })
    }

    var saves: [SentRequest] { stub.requests("PUT", "/me/queue") }

    @Test("A session never writes /me/queue: before it saved, during it nothing, after it nothing for the queue put back")
    func untouched() async throws {
        stub.on("GET", "/me/queue", .fixture("me-queue-empty"))
        stub.on("PUT", "/me/queue", .fixture("me-queue-saved"))
        stub.on("GET", "/navidrome/stream-url/al-1-t1", .fixture("stream-url"))
        stub.on("POST", "/together/\(sid)/queue", .fixture("together-queue-added"))
        stub.on("POST", "/together/\(sid)/join", .fixture("together-join"))
        stub.on("POST", "/together/\(sid)/leave", .fixture("together-leave"))
        let engine = FakeEngine()
        let c = client
        let player = Player(
            source: c, engine: engine, follows: true, sleep: sleeps.sleep, now: { [clock] in clock.now })
        let together = Together(
            source: c, player: player, server: stub.base, sleep: sleeps.sleep, now: { [clock] in clock.now }, loops: false)
        await player.signedIn()
        player.addToQueue(songs(2...3))
        #expect(await eventually { saves.count == 1 })
        let before = (try #require(saves.first?.json?["queue"] as? [String: Any]))["now"] as? [String: Any]
        #expect(before?["id"] as? String == "al-1-t2")

        // In the session: the player follows, plays, is paused and sought by it; no save goes.
        await together.join(sid)
        #expect(together.session != nil)
        #expect(await eventually { engine.current != nil })
        together.follow()
        player.seek(to: 5)
        player.addToQueue(songs(3...3))
        await player.play(songs(4...5), at: 0)
        player.toggle()
        #expect(await eventually { stub.requests("POST", "/together/\(sid)/queue").count == 2 })
        try? await Task.sleep(for: .milliseconds(150))
        #expect(saves.count == 1)
        #expect(together.session != nil)

        // Leaving: the personal queue is back (paused), and putting it back saves nothing.
        await together.leave()
        #expect(player.track?.id == "al-1-t2")
        #expect(player.upcoming.map(\.id) == ["al-1-t3"])
        #expect(player.status == .paused)
        try? await Task.sleep(for: .milliseconds(150))
        #expect(saves.count == 1)
        #expect(player.sync?.held == false)
        // And it is saved again when it changes: the queue follows the user as before.
        player.addToQueue(songs(6...6))
        #expect(await eventually { saves.count == 2 })
    }
}

@MainActor
@Suite("Listen together: hosting")
struct TogetherHostingTests {
    @Test("Ending the session closes the invite and the sheets, and tells everyone through the host's leave")
    func endClosesEverything() async throws {
        let t = TRig()
        t.fake.answer("start", .success(t.state(0, host: true, queue: [2])))
        t.fake.leaveEnds = true
        await t.together.start()
        t.together.sheetOpen = true
        t.together.membersOpen = true
        #expect(t.together.inviteOpen)
        await t.together.leave()
        #expect(t.fake.calls.contains(.leave(sid)))
        #expect(!t.together.inviteOpen && !t.together.sheetOpen && !t.together.membersOpen)
        #expect(t.notes.all.last == "The listening session ended.")
    }

    @Test("Starting twice does not make a second session: the sheet opens on the first")
    func startOnce() async throws {
        let t = TRig()
        t.fake.answer("start", .success(t.state(0, host: true)))
        await t.together.start()
        t.together.sheetOpen = false
        await t.together.start()
        #expect(t.together.sheetOpen)
        #expect(t.fake.calls.filter { if case .start = $0 { return true } else { return false } }.count == 1)
    }
}
