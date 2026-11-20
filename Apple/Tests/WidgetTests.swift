import CoreGraphics
import Foundation
import ImageIO
import MediaPlayer
import Testing

// The iPhone's home-screen widget (task 6): what the app writes into the App Group's folder and the
// widget reads back (the round trip, the cover drawn small, one kept), the widget's timeline (the
// progress from the song's start, held when paused, stopped at its end, nothing playing), when the
// app writes and reloads (the song, play or pause, a seek, the cover; never as the song plays on; a
// reload a second at most), its buttons (each App Intent to the player's command, the saved queue
// read first when the app was started for one), the link it opens, the folder emptied on signing
// out, and no App Group container at all (an unsigned build): nothing written, nothing broken.

/// The player's calls, with a queue saved (another device's, or this one's last time).
final class SavedQueueSource: PlaybackSource, @unchecked Sendable {
    let stream: FakeSource
    let saved: SavedQueue

    init(clock: TestClock, saved: SavedQueue) {
        stream = FakeSource(clock: clock)
        self.saved = saved
    }

    func streamURL(for track: Track) async throws -> SignedStream { try await stream.streamURL(for: track) }
    func scrobble(id: String, submission: Bool) async throws {}
    func recordPlay(_ track: Track, context: PlayContext?) async throws {}
    func savedQueue() async throws -> SavedQueue { saved }
    func saveQueue(_ queue: QueueState, positionMs: Double, base: Int) async throws -> Int { base + 1 }
}

@MainActor
@Suite("Widget")
struct WidgetTests {
    let clock = TestClock()

    func folder() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("widget-\(UUID().uuidString)", isDirectory: true)
    }

    func snapshot(position: Double = 84, at date: Date? = nil, playing: Bool = true, duration: Double = 221) -> WidgetSnapshot {
        WidgetSnapshot(
            key: "navidrome:al-1-t1", title: "Ferry at Six", artist: "Lowfield", album: "Harbour Lights",
            palette: AlbumPalette(base: RGB(0.1, 0.2, 0.3), accent: RGB(0.9, 0.8, 0.5)), playing: playing,
            advancing: playing, position: position, positionAt: date ?? clock.now, duration: duration, cover: nil)
    }

    static let coverPath = "/api/v1/navidrome/cover/al-1?size=600"

    // MARK: What the app writes and the widget reads

    @Test("The round trip: what plays, written whole into the folder, read back the same")
    func roundTrip() throws {
        let store = WidgetStore(directory: folder())
        #expect(store.isAvailable)
        #expect(store.read() == nil)
        let playing = snapshot()
        #expect(store.write(playing))
        #expect(store.read() == playing)
        #expect(store.fileNames == [WidgetStore.snapshotName])
        // Another write takes its place.
        let paused = snapshot(playing: false)
        #expect(store.write(paused))
        #expect(store.read() == paused)
        // A date with a fraction of a second comes back as it went.
        let exact = snapshot(at: Date(timeIntervalSince1970: 1_800_000_000.123456))
        store.write(exact)
        #expect(store.read() == exact)
        // A file the widget cannot read is nothing playing, not a crash.
        let directory = try #require(store.directory)
        try Data("{".utf8).write(to: directory.appendingPathComponent(WidgetStore.snapshotName))
        #expect(store.read() == nil)
    }

    @Test("The cover: drawn small (400 px at most) as a JPEG, one album's at a time")
    func cover() throws {
        let store = WidgetStore(directory: folder())
        let name = try #require(store.storeCover(cgImage(600, [16, 40, 62]), for: Self.coverPath))
        #expect(name == WidgetStore.coverName(Self.coverPath))
        #expect(name.hasPrefix("cover-") && name.hasSuffix(".jpg"))
        let url = try #require(store.coverURL(name))
        let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil))
        #expect(CGImageSourceGetType(source) as String? == "public.jpeg")
        let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        #expect(image.width == WidgetStore.coverSide && image.height == WidgetStore.coverSide)
        // The next album's cover replaces it; a small one keeps its size.
        let next = try #require(store.storeCover(cgImage(8, [200, 10, 10]), for: "/api/v1/navidrome/cover/al-2"))
        #expect(store.coverURL(name) == nil)
        #expect(store.fileNames == [next])
        let small = try #require(store.coverURL(next).flatMap { CGImageSourceCreateWithURL($0 as CFURL, nil) })
        #expect(CGImageSourceCreateImageAtIndex(small, 0, nil)?.width == 8)
    }

    // MARK: The widget's timeline

    @Test("Nothing playing: one moment with nothing in it; the queue emptying clears the widget")
    func nothingPlaying() async throws {
        let now = clock.now
        #expect(WidgetTimeline.moments(for: nil, now: now) == [WidgetTimeline.Moment(date: now, snapshot: nil)])
        let store = WidgetStore(directory: folder())
        let rig = Rig(widget: store)
        let feed = try #require(rig.widget)
        // Nothing shown yet: nothing to clear.
        feed.showNothing()
        #expect(feed.reloads.count == 0)
        await rig.player.play(songs(1...2), at: 0, context: albumContext)
        #expect(store.read() != nil)
        await rig.settle()
        let before = feed.reloads.count
        feed.showNothing()
        #expect(store.read() == nil)
        #expect(store.fileNames.isEmpty)
        #expect(feed.shown == nil)
        #expect(await eventually { feed.reloads.count == before + 1 })
    }

    @Test("The progress runs from the song's start by itself while it plays, held where it is otherwise")
    func progress() throws {
        let t = clock.now
        let playing = snapshot(position: 84, at: t, duration: 221)
        #expect(playing.startedAt == t.addingTimeInterval(-84))
        #expect(playing.endsAt == t.addingTimeInterval(137))
        #expect(playing.progressRange == t.addingTimeInterval(-84)...t.addingTimeInterval(137))
        #expect(playing.time(at: t.addingTimeInterval(10)) == 94)
        #expect(playing.time(at: t.addingTimeInterval(500)) == 221)
        // The timeline: now, running; at the song's end, stopped there (should the app say nothing).
        let now = t.addingTimeInterval(10)
        let moments = WidgetTimeline.moments(for: playing, now: now)
        #expect(moments.map(\.date) == [now, t.addingTimeInterval(137)])
        #expect(moments.first?.snapshot == playing)
        let end = try #require(moments.last?.snapshot)
        #expect(!end.playing && !end.advancing)
        #expect(end.position == 221 && end.fraction == 1 && end.progressRange == nil)
        // Paused at 1:24: one moment, held at 84 of 221.
        let paused = snapshot(position: 84, at: t, playing: false)
        #expect(paused.progressRange == nil)
        #expect(abs(paused.fraction - 84.0 / 221) < 1e-9)
        #expect(paused.time(at: t.addingTimeInterval(60)) == 84)
        #expect(WidgetTimeline.moments(for: paused, now: now) == [WidgetTimeline.Moment(date: now, snapshot: paused)])
        // A playing song that should have ended already (the app was closed): stopped at its end.
        let late = t.addingTimeInterval(400)
        #expect(WidgetTimeline.moments(for: playing, now: late) == [WidgetTimeline.Moment(date: late, snapshot: playing.ended)])
        // A song of no known length: no running progress.
        let unknown = snapshot(duration: 0)
        #expect(unknown.progressRange == nil && unknown.fraction == 0)
        #expect(WidgetTimeline.moments(for: unknown, now: now).count == 1)
    }

    @Test("Told again only when what it shows changes: not as the song plays on, but on a seek, a pause, the cover")
    func showsSame() {
        let t = clock.now
        let playing = snapshot(position: 84, at: t)
        // Ten seconds on, ten seconds further: the same.
        #expect(playing.showsSame(as: snapshot(position: 94, at: t.addingTimeInterval(10))))
        #expect(playing.showsSame(as: snapshot(position: 94.6, at: t.addingTimeInterval(10))))
        // A seek: not.
        #expect(!playing.showsSame(as: snapshot(position: 120, at: t.addingTimeInterval(10))))
        // Paused: the same while it stays where it is, whenever it is said.
        let paused = snapshot(position: 84, at: t, playing: false)
        #expect(paused.showsSame(as: snapshot(position: 84, at: t.addingTimeInterval(30), playing: false)))
        #expect(!paused.showsSame(as: snapshot(position: 90, at: t, playing: false)))
        #expect(!paused.showsSame(as: playing))
        var covered = playing
        covered.cover = "cover-1.jpg"
        #expect(!playing.showsSame(as: covered))
        var other = playing
        other.key = "navidrome:al-1-t2"
        #expect(!playing.showsSame(as: other))
    }

    @Test("The ground: a pale cover's glow dimmed under the widget's white words; a vivid cover keeps its own")
    func ground() {
        // Paper Satellites: beige and black, its most vivid colour the beige.
        let pale = AlbumPalette(base: RGB(0.78, 0.76, 0.72), accent: RGB(0.91, 0.89, 0.85))
        #expect(pale.widgetMesh[4].hsb.brightness < 0.55)
        #expect(pale.widgetMesh[4].hsb.brightness < pale.mesh[4].hsb.brightness)
        #expect(pale.widgetMesh[3].hsb.brightness < pale.mesh[3].hsb.brightness)
        // Only the glow: the rest of the room as the app has it.
        for i in [0, 1, 2, 5, 6, 7, 8] {
            #expect(pale.widgetMesh[i] == pale.mesh[i])
        }
        // Harbour Lights' amber lamps: as in the app.
        let vivid = AlbumPalette(base: RGB(0.06, 0.13, 0.2), accent: RGB(0.96, 0.77, 0.42))
        #expect(vivid.widgetMesh == vivid.mesh)
    }

    // MARK: When the widget is reloaded

    @Test("Reloads: at once, then at most one a second, the last change always shown")
    func reloadThrottle() async {
        let sleeps = Sleeps()
        let clock = self.clock
        let reloads = WidgetReloads(reload: {}, sleep: sleeps.sleep, now: { clock.now })
        reloads.request()
        #expect(reloads.count == 1)
        // A quarter of a second later: once the second is up, for both changes.
        clock.advance(0.25)
        reloads.request()
        reloads.request()
        #expect(reloads.count == 1)
        #expect(await eventually { reloads.count == 2 })
        #expect(sleeps.all == [.milliseconds(750)])
        // Well after: at once again.
        clock.advance(1.5)
        reloads.request()
        #expect(reloads.count == 3)
        try? await Task.sleep(for: .milliseconds(50))
        #expect(reloads.count == 3)
        #expect(sleeps.all.count == 1)
    }

    @Test("The player's widget: the song, the cover and its colours, the lock screen's values; written again on pause, a seek, the next song, not as it plays on")
    func playerFeed() async throws {
        let store = WidgetStore(directory: folder())
        let rig = Rig(images: ImageLoader(fetch: { _ in pngData(600) }), widget: store)
        let player = try #require(rig.player)
        let feed = try #require(rig.widget)
        await player.play(songs(1...3), at: 0, context: albumContext)
        // The cover comes: drawn small into the folder, the album's colours with it.
        #expect(await eventually { store.read()?.cover != nil })
        let shown = try #require(store.read())
        #expect(shown.key == "navidrome:al-1-t1")
        #expect(shown.title == "Song 1" && shown.artist == "Lowfield" && shown.album == "Harbour Lights")
        #expect(shown.playing && shown.advancing)
        #expect(shown.duration == 200 && shown.position == 0 && shown.positionAt == rig.clock.now)
        #expect(shown.cover == WidgetStore.coverName(Self.coverPath))
        // The cover's colours (a navy cover: its blue over its red).
        let palette = try #require(shown.palette)
        #expect(palette.base.b > palette.base.r)
        #expect(store.fileNames.sorted() == [WidgetStore.coverName(Self.coverPath), WidgetStore.snapshotName].sorted())
        // What the lock screen was told at the same moment.
        #expect(rig.media.info?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double == shown.position)
        #expect(rig.media.info?[MPMediaItemPropertyTitle] as? String == shown.title)
        await rig.settle()
        let settled = feed.reloads.count
        #expect(settled >= 1)
        // Playing on, as the engine says: nothing written, nothing reloaded.
        rig.clock.advance(10)
        rig.engine.play(to: 10)
        rig.clock.advance(10)
        rig.engine.play(to: 20)
        await rig.settle()
        #expect(feed.reloads.count == settled)
        #expect(store.read() == shown)
        // Paused at 0:20: held there, and reloaded at once.
        player.pause()
        #expect(store.read()?.playing == false)
        #expect(store.read()?.advancing == false)
        #expect(store.read()?.position == 20)
        #expect(feed.reloads.count == settled + 1)
        // A seek, then the next song, within the second: written each time, one reload for both.
        player.seek(to: 100)
        #expect(store.read()?.position == 100)
        player.next()
        #expect(store.read()?.key == "navidrome:al-1-t2")
        #expect(store.read()?.position == 0)
        #expect(await eventually { feed.reloads.count == settled + 2 })
        await rig.settle()
        #expect(feed.reloads.count == settled + 2)
    }

    // MARK: The buttons and the link

    @Test("The buttons: each App Intent asks the player for its command; with nothing queued, the saved queue first")
    func intents() async throws {
        #expect(PlayPauseIntent.command == .toggle)
        #expect(NextSongIntent.command == .next)
        #expect(PreviousSongIntent.command == .previous)
        #expect(!PlayPauseIntent.isDiscoverable && !NextSongIntent.isDiscoverable && !PreviousSongIntent.isDiscoverable)
        defer { WidgetCommands.handler = nil }
        // Nothing listening (the widget extension's own copy): nothing happens.
        WidgetCommands.handler = nil
        _ = try await PlayPauseIntent().perform()

        let rig = Rig()
        let player = try #require(rig.player)
        WidgetCommands.handler = { await player.perform($0) }
        await player.play(songs(1...3), at: 0, context: albumContext)
        _ = try await PlayPauseIntent().perform()
        #expect(player.status == .paused)
        _ = try await PlayPauseIntent().perform()
        #expect(player.status == .playing)
        _ = try await NextSongIntent().perform()
        #expect(player.track?.id == "al-1-t2")
        #expect(player.status == .playing)
        _ = try await PreviousSongIntent().perform()
        #expect(player.track?.id == "al-1-t1")

        // The app started for the button (nothing in the queue): the saved queue comes back, then plays.
        let clock = self.clock
        let saved = QueueState(provider: "navidrome", now: song(2), context: [song(3)], contextSource: albumContext)
        let source = SavedQueueSource(clock: clock, saved: SavedQueue(queue: saved, positionMs: 42_000, updatedAt: 5))
        let engine = FakeEngine()
        let cold = Player(source: source, engine: engine, follows: true, sleep: Sleeps().sleep, now: { clock.now })
        WidgetCommands.handler = { await cold.perform($0) }
        #expect(cold.track == nil)
        _ = try await PlayPauseIntent().perform()
        #expect(cold.track?.id == "al-1-t2")
        #expect(cold.status == .playing)
        #expect(engine.calls.contains(.load("navidrome:al-1-t2", at: 42, play: true)))
        cold.stop()
    }

    @Test("The widget's tap opens Now Playing (echo://now-playing); other links are not the app's")
    func links() throws {
        #expect(AppLink.nowPlaying.url.absoluteString == "echo://now-playing")
        #expect(AppLink(AppLink.nowPlaying.url) == .nowPlaying)
        #expect(AppLink(try #require(URL(string: "ECHO://Now-Playing"))) == .nowPlaying)
        #expect(AppLink(try #require(URL(string: "echo:now-playing"))) == .nowPlaying)
        #expect(AppLink(try #require(URL(string: "echo://library"))) == nil)
        #expect(AppLink(try #require(URL(string: "https://echo.folk3s.com/now-playing"))) == nil)
    }

    // MARK: Signing out, and no App Group

    @Test("Signing out empties the widget's folder: the song and its cover go, and the widget is told")
    func clearedOnSignOut() async throws {
        let store = WidgetStore(directory: folder())
        let rig = Rig(images: ImageLoader(fetch: { _ in pngData(64) }), widget: store)
        let feed = try #require(rig.widget)
        await rig.player.play(songs(1...2), at: 0, context: albumContext)
        #expect(await eventually { store.fileNames.count == 2 })
        await rig.settle()
        let before = feed.reloads.count
        rig.player.stop()
        #expect(store.fileNames.isEmpty)
        #expect(store.read() == nil)
        #expect(feed.shown == nil)
        #expect(await eventually { feed.reloads.count == before + 1 })
        // What an earlier launch left goes too, though this one showed nothing.
        let left = WidgetStore(directory: store.directory)
        left.write(snapshot())
        #expect(left.fileNames == [WidgetStore.snapshotName])
        Rig(widget: left).player.stop()
        #expect(left.fileNames.isEmpty)
    }

    @Test("No App Group container (an unsigned build may get none): nothing written or read, the music plays on")
    func noAppGroup() async throws {
        let store = WidgetStore.appGroup(container: { _ in nil })
        #expect(store.directory == nil)
        #expect(!store.isAvailable)
        #expect(!store.write(snapshot()))
        #expect(store.read() == nil)
        #expect(store.storeCover(cgImage(8, [1, 2, 3]), for: Self.coverPath) == nil)
        #expect(store.coverURL("cover-1.jpg") == nil)
        #expect(store.fileNames.isEmpty)
        store.clear()
        #expect(WidgetStore.describeAppGroup(container: { _ in nil }) == "App Group group.com.folk3s.echo: no container")
        // The player as before, the lock screen told; the widget's feed does nothing at all.
        let rig = Rig(images: ImageLoader(fetch: { _ in pngData(8) }), widget: store)
        let feed = try #require(rig.widget)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        rig.player.pause()
        rig.player.next()
        #expect(rig.player.track?.id == "al-1-t2")
        rig.player.stop()
        await rig.settle()
        #expect(feed.reloads.count == 0)
        #expect(feed.shown == nil)
        #expect(rig.media.publishes > 0)
        // A container given: the widget's own folder in it, made, written to.
        let root = folder()
        let given = WidgetStore.appGroup(container: { $0 == WidgetShared.appGroup ? root : nil })
        #expect(given.directory == root.appendingPathComponent("Widget", isDirectory: true))
        #expect(given.write(snapshot()))
        #expect(WidgetStore.describeAppGroup(container: { _ in root }).hasSuffix("(writable)"))
    }

    #if os(iOS)
    @Test("The App Group as this test bundle is given it, in the simulator (printed for the run's log)")
    func appGroupHere() {
        let said = WidgetStore.describeAppGroup()
        print("➜ iOS test bundle: \(said)")
        #expect(said.hasPrefix("App Group \(WidgetShared.appGroup): "))
    }
    #endif
}
