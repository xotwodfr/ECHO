import Foundation
import MediaPlayer
import Testing

// The player on a fake engine (no sound: a unit-test bundle has no app and the CI simulator cannot
// stream): the queue's transport as the web's controller.ts does it, the next song buffered for a
// gapless hand-over, signed stream URLs fetched again before they run out, a broken stream asked
// for again then skipped, Navidrome's scrobbles and ECHO's history, interruptions and the
// headphones, the lock screen's commands and info, and what the mini player and Now Playing show.

/// A player on fakes, with a clock the test moves and waits that pass at once.
@MainActor
final class Rig {
    let clock: TestClock
    let engine = FakeEngine()
    let media = FakeMedia()
    let hearts = FakeHearts()
    let sleeps = Sleeps()
    let source: FakeSource
    var settings = UserSettings.Playback()
    private(set) var notices: [String] = []
    private(set) var player: Player!

    init(images: ImageLoader? = nil, seed: UInt32 = 7) {
        let clock = TestClock()
        self.clock = clock
        source = FakeSource(clock: clock)
        let random = SeededRandom(seed)
        player = Player(
            source: source, engine: engine, media: media, hearts: hearts, images: images, follows: false,
            settings: { [unowned self] in self.settings },
            notify: { [unowned self] in self.notices.append($0) },
            sleep: sleeps.sleep, now: { clock.now }, random: { random.next() })
    }

    func key(_ n: Int, album: String = "al-1") -> String { "navidrome:\(album)-t\(n)" }

    /// Waits for the tasks the player started to settle.
    func settle() async {
        try? await Task.sleep(for: .milliseconds(50))
    }
}

@MainActor
@Suite("Player")
struct PlayerTests {
    // MARK: The queue

    @Test("Play at an index: that song's signed URL, loaded playing; the rest of the list after it")
    func playAtIndex() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...4), at: 1, context: albumContext)
        #expect(player.track?.id == "al-1-t2")
        #expect(player.status == .playing)
        #expect(player.isPlaying)
        #expect(player.upcoming.map(\.id) == ["al-1-t3", "al-1-t4"])
        #expect(player.context == albumContext)
        #expect(player.isCurrent(albumContext))
        #expect(!player.isCurrent(PlayContext(kind: "album", id: "al-2", title: "Other")))
        #expect(rig.source.streams.first == "al-1-t2")
        #expect(rig.engine.calls.contains(.load(rig.key(2), at: 0, play: true)))
        let loaded = try #require(rig.engine.loads.first)
        #expect(loaded.url.absoluteString.hasPrefix("https://echo.test/api/v1/navidrome/stream/al-1-t2"))
        #expect(loaded.expiresAt == rig.clock.now.addingTimeInterval(6 * 3600))
    }

    @Test("Next goes on; Previous within 3 s goes back, past 3 s starts the song again")
    func nextAndPrevious() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        player.next()
        #expect(player.track?.id == "al-1-t2")
        #expect(await eventually { rig.engine.current?.key == rig.key(2) })
        rig.engine.play(to: 2)
        player.previous()
        #expect(player.track?.id == "al-1-t1")
        #expect(await eventually { rig.engine.current?.key == rig.key(1) })
        rig.engine.play(to: 10)
        player.previous()
        #expect(player.track?.id == "al-1-t1")
        #expect(rig.engine.calls.last == .seek(0))
        #expect(player.time(at: rig.clock.now) == 0)
        // With nothing before it, Previous starts the song again too.
        player.previous()
        #expect(player.track?.id == "al-1-t1")
    }

    @Test("Shuffle: on, from a random song, the rest in a random order; off brings the list's order back")
    func shuffle() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.shuffle(songs(1...5), context: albumContext)
        #expect(player.shuffled)
        #expect(player.queue.shuffleOrder != nil)
        let all = [try #require(player.track?.id)] + player.upcoming.map(\.id)
        #expect(Set(all) == Set(songs(1...5).map(\.id)))
        #expect(all.count == 5)
        player.toggleShuffle()
        #expect(!player.shuffled)
        #expect(player.upcoming == player.queue.context)
    }

    @Test("Play Next and Add to Queue, each said in a message; with nothing playing, the first is cued")
    func queueing() async throws {
        let idle = Rig()
        idle.player.addToQueue(songs(1...2))
        #expect(idle.player.track?.id == "al-1-t1")
        #expect(idle.player.status == .paused)
        #expect(idle.player.upcoming.map(\.id) == ["al-1-t2"])
        #expect(idle.source.streams.isEmpty)
        #expect(idle.notices == ["Added “2 songs” to the queue"])
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        player.playNext([song(8, album: "al-2")])
        player.addToQueue([song(9, album: "al-2")], label: "Glass Weather")
        player.playNext([song(7, album: "al-2")])
        #expect(player.upcoming.map(\.id) == ["al-2-t7", "al-2-t8", "al-2-t9", "al-1-t2", "al-1-t3"])
        #expect(rig.notices == [
            "Playing “Song 8” next", "Added “Glass Weather” to the queue", "Playing “Song 7” next",
        ])
        // A new list keeps what was queued next.
        await player.play(songs(1...2, album: "al-5"), at: 0)
        #expect(player.upcoming.map(\.id) == ["al-2-t7", "al-2-t8", "al-2-t9", "al-5-t2"])
    }

    @Test("Up next: drag to reorder in either part, swipe to remove, tap to play one now")
    func editing() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...4), at: 0, context: albumContext)
        player.playNext([song(8, album: "al-2"), song(9, album: "al-2")])
        player.move(.context, fromOffsets: [2], toOffset: 0)
        #expect(player.queue.context.map(\.id) == ["al-1-t4", "al-1-t2", "al-1-t3"])
        player.move(.nextUp, fromOffsets: [0], toOffset: 2)
        #expect(player.queue.nextUp.map(\.id) == ["al-2-t9", "al-2-t8"])
        player.remove(.context, atOffsets: [1])
        #expect(player.upcoming.map(\.id) == ["al-2-t9", "al-2-t8", "al-1-t4", "al-1-t3"])
        player.jump(to: 3)
        #expect(player.track?.id == "al-1-t3")
        #expect(player.upcoming.isEmpty)
        #expect(player.queue.history.last?.id == "al-1-t1")
        #expect(await eventually { rig.engine.current?.key == rig.key(3) })
    }

    @Test("The end of the queue: stopped on the last song; Play starts it again from the top")
    func endOfQueue() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...2), at: 1, context: albumContext)
        #expect(!player.hasNext)
        rig.engine.play(to: 199)
        rig.engine.finish()
        #expect(player.status == .ended)
        #expect(!player.isPlaying)
        #expect(player.track?.id == "al-1-t2")
        player.toggle()
        #expect(await eventually { rig.engine.loads.count == 2 })
        #expect(rig.engine.calls.contains(.load(rig.key(2), at: 0, play: true)))
        #expect(player.status == .playing)
    }

    @Test("Repeat all starts the list again; repeat one plays the song again and buffers nothing next")
    func repeats() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...2), at: 1, context: albumContext)
        player.cycleRepeat()
        #expect(player.repeatMode == .all)
        #expect(player.hasNext)
        rig.engine.finish()
        #expect(player.track?.id == "al-1-t1")
        #expect(await eventually { rig.engine.current?.key == rig.key(1) && rig.engine.preloaded != nil })
        player.cycleRepeat()
        #expect(player.repeatMode == .one)
        #expect(player.repeatIcon == "repeat.1")
        #expect(rig.engine.calls.last == .preload(nil))
        rig.engine.finish()
        #expect(player.track?.id == "al-1-t1")
        #expect(await eventually { rig.engine.loadedKeys.filter { $0 == rig.key(1) }.count == 2 })
        player.cycleRepeat()
        #expect(player.repeatMode == .off)
    }

    // MARK: Gapless

    @Test("The next song is buffered 5 s in, and the engine's hand-over to it needs no new load")
    func gapless() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(await eventually { rig.engine.preloaded?.key == rig.key(2) })
        #expect(rig.sleeps.all.contains(.seconds(5)))
        rig.engine.finish()
        #expect(player.track?.id == "al-1-t2")
        #expect(player.status == .playing)
        #expect(player.time(at: rig.clock.now) == 0)
        #expect(rig.engine.loadedKeys == [rig.key(1)])
        #expect(rig.source.streams == ["al-1-t1", "al-1-t2"])
        #expect(await eventually { rig.engine.preloaded?.key == rig.key(3) })
    }

    @Test("Next with the next song buffered starts it at once, with no new URL")
    func instantNext() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(await eventually { rig.engine.preloaded?.key == rig.key(2) })
        let fetched = rig.source.streams
        player.next()
        #expect(player.track?.id == "al-1-t2")
        #expect(player.status == .playing)
        #expect(rig.engine.calls.contains(.load(rig.key(2), at: 0, play: true)))
        #expect(rig.source.streams == fetched)
    }

    @Test("A different next song (Play Next) is buffered in place of the one before")
    func preloadFollowsTheQueue() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(await eventually { rig.engine.preloaded?.key == rig.key(2) })
        player.playNext([song(9, album: "al-2")])
        #expect(rig.engine.calls.contains(.preload(nil)))
        #expect(await eventually { rig.engine.preloaded?.key == rig.key(9, album: "al-2") })
    }

    // MARK: Signed URLs

    @Test("Play after a long pause: a URL that would run out before the song ends is fetched again")
    func urlRefresh() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...2, seconds: 600), at: 0, context: albumContext)
        rig.engine.play(to: 120)
        player.pause()
        // 5 h 45 min later the URL has 15 min left: less than the 8 min of song and the margin.
        rig.clock.advance(6 * 3600 - 15 * 60)
        player.resume()
        #expect(await eventually { rig.source.streams.filter { $0 == "al-1-t1" }.count == 2 })
        #expect(await eventually { rig.engine.calls.contains(.load(rig.key(1), at: 120, play: true)) })
        #expect(rig.engine.loads.last { $0.key == rig.key(1) }?.expiresAt == rig.clock.now.addingTimeInterval(6 * 3600))
        #expect(player.status == .playing)
        // A URL with time to spare just plays on.
        player.pause()
        rig.clock.advance(60)
        player.resume()
        #expect(rig.engine.calls.last == .play)
        #expect(player.status == .playing)
    }

    // MARK: Broken streams

    @Test("A broken stream is asked for again at its place 3 times, then skipped with a message")
    func brokenStream() async throws {
        let rig = Rig()
        rig.engine.reportsLoads = false
        let player = try #require(rig.player)
        await player.play(songs(1...2), at: 0, context: albumContext)
        rig.engine.play(to: 30)
        for attempt in 2...4 {
            rig.engine.send(.failed(rig.key(1)))
            #expect(await eventually { rig.engine.loadedKeys.filter { $0 == rig.key(1) }.count == attempt })
        }
        #expect(rig.engine.calls.contains(.load(rig.key(1), at: 30, play: true)))
        #expect(rig.sleeps.all.contains(.milliseconds(500)))
        #expect(rig.sleeps.all.contains(.milliseconds(1000)))
        #expect(rig.sleeps.all.contains(.milliseconds(2000)))
        rig.engine.send(.failed(rig.key(1)))
        #expect(player.track?.id == "al-1-t2")
        #expect(rig.notices == [Player.skipped])
        // With nothing after it, what failed is said.
        #expect(await eventually { rig.engine.current?.key == rig.key(2) })
        for _ in 1...4 {
            let before = rig.engine.loads.count
            rig.engine.send(.failed(rig.key(2)))
            if player.status != .failed { _ = await eventually { rig.engine.loads.count > before } }
        }
        #expect(player.status == .failed)
        #expect(rig.notices.last == Player.unplayable)
    }

    @Test("No stream URL (Navidrome not connected): the reason is said and nothing plays")
    func noStreamURL() async throws {
        let rig = Rig()
        rig.source.streamError = .navidromeNotConnected
        let player = try #require(rig.player)
        await player.play(songs(1...2), at: 0, context: albumContext)
        #expect(player.status == .failed)
        #expect(player.error == .navidromeNotConnected)
        #expect(rig.notices == [ApiError.navidromeNotConnected.userMessage])
        #expect(rig.engine.loads.isEmpty)
    }

    // MARK: Scrobbles

    @Test("Scrobbles: now playing at the start, played at half the song; ECHO's history at the same point")
    func scrobbles() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...2, seconds: 200), at: 0, context: albumContext)
        #expect(await eventually { rig.source.scrobbles == ["al-1-t1 now"] })
        rig.engine.play(to: 99)
        await rig.settle()
        #expect(rig.source.scrobbles == ["al-1-t1 now"])
        #expect(rig.source.plays.isEmpty)
        rig.engine.play(to: 100)
        #expect(await eventually { rig.source.scrobbles == ["al-1-t1 now", "al-1-t1 played"] })
        #expect(await eventually { rig.source.plays.map(\.0) == ["al-1-t1"] })
        #expect(rig.source.plays.first?.1 == albumContext)
        rig.engine.play(to: 150)
        await rig.settle()
        #expect(rig.source.scrobbles.count == 2)
        #expect(rig.source.plays.count == 1)
        // The song again from its start is another play for the history (Navidrome's stays one).
        rig.engine.play(to: 5)
        rig.engine.play(to: 100)
        #expect(await eventually { rig.source.plays.count == 2 })
        #expect(rig.source.scrobbles.count == 2)
    }

    @Test("A long song is played at 4 minutes; a short one counts for Navidrome but not the history")
    func scrobblePoint() async throws {
        let long = Rig()
        await long.player.play([song(1, seconds: 600)], at: 0)
        long.engine.play(to: 239)
        await long.settle()
        #expect(long.source.scrobbles == ["al-1-t1 now"])
        long.engine.play(to: 240)
        #expect(await eventually { long.source.scrobbles.last == "al-1-t1 played" })
        let short = Rig()
        await short.player.play([song(1, seconds: 20)], at: 0)
        short.engine.play(to: 10)
        #expect(await eventually { short.source.scrobbles == ["al-1-t1 now", "al-1-t1 played"] })
        await short.settle()
        #expect(short.source.plays.isEmpty)
    }

    @Test("With scrobbling off in Settings, Navidrome hears nothing; ECHO's history still counts")
    func scrobblingOff() async throws {
        let rig = Rig()
        rig.settings.scrobble = false
        await rig.player.play([song(1, seconds: 200)], at: 0)
        rig.engine.play(to: 120)
        #expect(await eventually { rig.source.plays.count == 1 })
        #expect(rig.source.scrobbles.isEmpty)
    }

    // MARK: Interruptions and the headphones

    @Test("A call pauses; when it ends the music plays on if the system says so and it was playing")
    func interruptions() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...2), at: 0)
        rig.engine.send(.interruptionBegan)
        #expect(player.status == .paused)
        rig.engine.send(.interruptionEnded(shouldResume: true))
        #expect(player.status == .playing)
        rig.engine.send(.interruptionBegan)
        rig.engine.send(.interruptionEnded(shouldResume: false))
        #expect(player.status == .paused)
        // Paused before the call: still paused after it.
        rig.engine.send(.interruptionBegan)
        rig.engine.send(.interruptionEnded(shouldResume: true))
        #expect(player.status == .paused)
        // The system paused it first and said why after: it plays on all the same.
        player.resume()
        rig.engine.send(.status(.paused))
        #expect(player.status == .paused)
        rig.engine.send(.interruptionBegan)
        rig.engine.send(.interruptionEnded(shouldResume: true))
        #expect(player.status == .playing)
    }

    @Test("The headphones out: the music stops, and an interruption ending later does not start it")
    func headphonesOut() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...2), at: 0)
        rig.engine.send(.headphonesOut)
        #expect(player.status == .paused)
        #expect(rig.engine.calls.last == .pause)
        rig.engine.send(.interruptionEnded(shouldResume: true))
        #expect(player.status == .paused)
    }

    // MARK: The lock screen and Control Center

    @Test("The commands from outside the app: play, pause, toggle, next, previous, seek and the heart")
    func remoteCommands() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        #expect(rig.media.onCommand?(.play) == false)
        await player.play(songs(1...3), at: 0, context: albumContext)
        #expect(rig.media.onCommand?(.pause) == true)
        #expect(player.status == .paused)
        #expect(rig.media.onCommand?(.play) == true)
        #expect(player.status == .playing)
        #expect(rig.media.onCommand?(.toggle) == true)
        #expect(player.status == .paused)
        _ = rig.media.onCommand?(.toggle)
        #expect(player.status == .playing)
        _ = rig.media.onCommand?(.next)
        #expect(player.track?.id == "al-1-t2")
        _ = rig.media.onCommand?(.previous)
        #expect(player.track?.id == "al-1-t1")
        #expect(await eventually { rig.engine.current?.key == rig.key(1) })
        _ = rig.media.onCommand?(.seek(42))
        #expect(player.time(at: rig.clock.now) == 42)
        #expect(rig.engine.calls.last == .seek(42))
        _ = rig.media.onCommand?(.like)
        #expect(await eventually { rig.hearts.liked == ["al-1-t1"] && rig.media.liked })
        _ = rig.media.onCommand?(.like)
        #expect(await eventually { rig.hearts.liked.isEmpty && !rig.media.liked })
    }

    @Test("What the lock screen shows: the song, its length, where it is, whether it moves, its place")
    func nowPlayingInfo() async throws {
        let rig = Rig(images: ImageLoader(fetch: { _ in pngData(8) }))
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 1, context: albumContext)
        let info = try #require(rig.media.info)
        #expect(info[MPMediaItemPropertyTitle] as? String == "Song 2")
        #expect(info[MPMediaItemPropertyArtist] as? String == "Lowfield")
        #expect(info[MPMediaItemPropertyAlbumTitle] as? String == "Harbour Lights")
        #expect(info[MPMediaItemPropertyPlaybackDuration] as? Double == 200)
        #expect(info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double == 0)
        #expect(info[MPNowPlayingInfoPropertyPlaybackRate] as? Double == 1)
        #expect(info[MPNowPlayingInfoPropertyDefaultPlaybackRate] as? Double == 1)
        #expect(info[MPNowPlayingInfoPropertyPlaybackQueueIndex] as? Int == 0)
        #expect(info[MPNowPlayingInfoPropertyPlaybackQueueCount] as? Int == 2)
        #expect(info[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String == "navidrome:al-1-t2")
        #expect(info[MPNowPlayingInfoPropertyMediaType] as? UInt == MPNowPlayingInfoMediaType.audio.rawValue)
        #expect(rig.media.playing)
        #expect(rig.media.canGoNext)
        // The cover follows once it has loaded.
        #expect(await eventually { rig.media.info?[MPMediaItemPropertyArtwork] is MPMediaItemArtwork })
        let artwork = try #require(rig.media.info?[MPMediaItemPropertyArtwork] as? MPMediaItemArtwork)
        #expect(artwork.bounds.size == CGSize(width: 8, height: 8))
        // Paused at 1:01: the time holds still there.
        rig.engine.play(to: 61)
        player.pause()
        #expect(rig.media.info?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double == 61)
        #expect(rig.media.info?[MPNowPlayingInfoPropertyPlaybackRate] as? Double == 0)
        #expect(!rig.media.playing)
        // Signed out: nothing.
        player.stop()
        #expect(rig.media.info == nil)
    }

    @Test("The info is built in one place, the same for any caller")
    func infoBuilder() {
        let info = NowPlayingInfo.build(
            track: song(4, seconds: 181), elapsed: 12.5, duration: 181, playing: false, index: 3, count: 9, artwork: nil)
        #expect(info[MPMediaItemPropertyTitle] as? String == "Song 4")
        #expect(info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double == 12.5)
        #expect(info[MPNowPlayingInfoPropertyPlaybackRate] as? Double == 0)
        #expect(info[MPNowPlayingInfoPropertyPlaybackQueueIndex] as? Int == 3)
        #expect(info[MPNowPlayingInfoPropertyPlaybackQueueCount] as? Int == 9)
        #expect(info[MPMediaItemPropertyArtwork] == nil)
    }

    // MARK: What the screens show

    @Test("The mini player and Now Playing: the song, where it plays from, Play or Pause, the times")
    func display() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        #expect(NowPlayingDisplay(player, at: rig.clock.now) == nil)
        player.cue(
            QueueState(provider: "navidrome", now: song(1, seconds: 221), context: songs(2...3), contextSource: albumContext),
            at: 84)
        let paused = try #require(NowPlayingDisplay(player, at: rig.clock.now))
        #expect(paused.title == "Song 1")
        #expect(paused.artist == "Lowfield")
        #expect(paused.album == "Harbour Lights")
        #expect(paused.cover == "/api/v1/navidrome/cover/al-1?size=600")
        #expect(paused.from == "Playing from album")
        #expect(paused.fromTitle == "Harbour Lights")
        #expect(!paused.playing)
        #expect(paused.playIcon == "play.fill")
        #expect(paused.playLabel == "Play")
        #expect(paused.elapsed == "1:24")
        #expect(paused.remaining == "-2:17")
        #expect(paused.total == "3:41")
        #expect(abs(paused.progress - 84.0 / 221) < 0.0001)
        #expect(paused.canGoNext)
        #expect(rig.source.streams.isEmpty)
        // Playing, the time moves on with the clock.
        player.resume()
        #expect(await eventually { player.status == .playing })
        rig.clock.advance(10)
        let playing = try #require(NowPlayingDisplay(player, at: rig.clock.now))
        #expect(playing.playing)
        #expect(playing.playIcon == "pause.fill")
        #expect(playing.playLabel == "Pause")
        #expect(playing.elapsed == "1:34")
        #expect(playing.remaining == "-2:07")
        // Up next: what was added, then the rest of the album.
        player.playNext([song(9, album: "al-2")])
        let queue = QueueDisplay(player.queue)
        #expect(queue.nextUp.map(\.id) == ["al-2-t9"])
        #expect(queue.rest.map(\.id) == ["al-1-t2", "al-1-t3"])
        #expect(queue.restTitle == "Continue playing from Harbour Lights")
    }

    @Test("Where it plays from, by the kind of list", arguments: [
        ("album", "Playing from album"), ("playlist", "Playing from playlist"), ("artist", "Playing from artist"),
        ("mix", "Playing from Made for you"), ("search", "Playing from search"),
        ("starred", "Playing from your library"), ("karaoke", "Playing from"),
    ])
    func source(kind: String, label: String) {
        let source = NowPlayingDisplay.source(PlayContext(kind: kind, title: "Some list"))
        #expect(source.label == label)
        #expect(source.title == "Some list")
        #expect(NowPlayingDisplay.source(nil).label == nil)
        #expect(NowPlayingDisplay.clock(3725) == "1:02:05")
    }

    // MARK: ReplayGain, the volume, signing out

    @Test("ReplayGain: album gain within an album, track gain elsewhere, never past full scale or louder")
    func replayGain() async throws {
        #expect(ReplayGain.linear(nil, peak: nil) == 1)
        #expect(abs(ReplayGain.linear(-6, peak: nil) - 0.501187) < 0.0001)
        #expect(ReplayGain.linear(6, peak: 0.9) == 1 / 0.9)
        let gain = ReplayGain(trackGain: -6, albumGain: -3, trackPeak: 0.9, albumPeak: 1)
        #expect(abs(ReplayGain.volume(gain, mode: .auto, inAlbum: true) - 0.70795) < 0.0001)
        #expect(abs(ReplayGain.volume(gain, mode: .auto, inAlbum: false) - 0.50119) < 0.0001)
        #expect(abs(ReplayGain.volume(gain, mode: .track, inAlbum: true) - 0.50119) < 0.0001)
        #expect(abs(ReplayGain.volume(gain, mode: .album, inAlbum: false) - 0.70795) < 0.0001)
        #expect(ReplayGain.volume(gain, mode: .off, inAlbum: true) == 1)
        #expect(ReplayGain.volume(ReplayGain(trackGain: 4), mode: .track, inAlbum: false) == 1)
        #expect(ReplayGain.volume(nil, mode: .auto, inAlbum: true) == 1)
        let rig = Rig()
        var loud = song(1)
        loud.replayGain = gain
        await rig.player.play([loud, song(2)], at: 0, context: albumContext)
        #expect(abs((rig.engine.loads.first?.gain ?? 0) - 0.70795) < 0.0001)
        rig.player.setVolume(0.4)
        #expect(rig.engine.volume == 0.4)
    }

    @Test("Signing out: the music stops and the queue empties")
    func stop() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        await player.play(songs(1...3), at: 0, context: albumContext)
        player.stop()
        #expect(player.track == nil)
        #expect(player.status == .idle)
        #expect(player.upcoming.isEmpty)
        #expect(player.context == nil)
        #expect(rig.engine.calls.last == .stop)
        #expect(rig.media.info == nil)
    }
}
