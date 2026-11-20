import Foundation
import Testing

// Offline downloads on a fake transport and a real store in a folder of their own: the queue and the
// state of each song (queued, downloading, done, failed), retry, a relaunch (what finished meanwhile,
// what the system still has running, an index that disagrees with the files), what the files weigh,
// shared files, removal and signing out, the requests the real client makes, the player choosing a
// file over a stream, the Library offline, and the numbers Settings shows.

/// Fetches nothing: it records what it is asked, and finishes or fails a fetch when told.
@MainActor
final class FakeTransport: DownloadTransport {
    var onEvent: ((TransportEvent) -> Void)?
    /// What the system still has running (asked at resume).
    var alreadyRunning: Set<String> = []
    private(set) var started: [String] = []
    private(set) var requests: [String: URLRequest] = [:]
    private(set) var cancelled: [String] = []
    private(set) var cancelledAll = 0
    private let folder: URL

    init(folder: URL) {
        self.folder = folder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    func start(key: String, request: URLRequest) {
        started.append(key)
        requests[key] = request
    }

    func cancel(key: String) { cancelled.append(key) }
    func cancelAll() { cancelledAll += 1 }
    func running() async -> Set<String> { alreadyRunning }

    /// The fetch finishes with `size` bytes and this status; the staged file's place.
    @discardableResult
    func finish(_ key: String, size: Int = 1000, status: Int = 200) -> URL {
        let file = folder.appendingPathComponent(UUID().uuidString)
        try? Data(repeating: 7, count: size).write(to: file)
        onEvent?(.finished(key: key, file: file, status: status))
        return file
    }

    func progress(_ key: String, _ written: Int64, of expected: Int64) {
        onEvent?(.progress(key: key, written: written, expected: expected))
    }

    func fail(_ key: String, _ message: String = "The network connection was lost.") {
        onEvent?(.failed(key: key, message: message))
    }
}

/// Requests with no token to send: the real client's are tested apart.
struct FakeRequests: DownloadRequests {
    var signedIn = true

    func trackRequest(_ track: Track) -> URLRequest? {
        signedIn ? URLRequest(url: URL(string: "https://echo.test/api/v1/navidrome/stream/\(track.id)")!) : nil
    }

    func coverRequest(id: String) -> URLRequest? {
        signedIn ? URLRequest(url: URL(string: "https://echo.test/api/v1/navidrome/cover/\(id)")!) : nil
    }
}

/// Downloads on fakes, in a folder removed with the rig.
@MainActor
final class DownloadRig {
    let folder: URL
    let store: DownloadStore
    let clock = TestClock()
    var transport: FakeTransport
    var wifiOnly = true
    private(set) var downloads: Downloads!

    init(signedIn: Bool = true) {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("echo-dl-\(UUID().uuidString)")
        store = DownloadStore(directory: folder.appendingPathComponent("store"))
        transport = FakeTransport(folder: folder.appendingPathComponent("system"))
        downloads = make(signedIn: signedIn)
    }

    deinit { try? FileManager.default.removeItem(at: folder) }

    private func make(signedIn: Bool = true) -> Downloads {
        let clock = self.clock
        return Downloads(
            store: store, transport: transport, requests: FakeRequests(signedIn: signedIn),
            wifiOnly: { [weak self] in self?.wifiOnly ?? true }, now: { clock.now })
    }

    /// The app started again: the same files, a new transport that still has `running`.
    func relaunch(running: Set<String> = []) -> Downloads {
        transport = FakeTransport(folder: folder.appendingPathComponent("system"))
        transport.alreadyRunning = running
        downloads = make()
        return downloads
    }

    /// An album (or playlist) of songs 1...n of `album`.
    func album(_ n: Int, id: String = "al-1") -> DownloadItem {
        DownloadItem(
            kind: .album, id: id, title: "Album \(id)", subtitle: "Lowfield", cover: "/api/v1/navidrome/cover/\(id)?size=300",
            tracks: songs(1...n, album: id), artistId: "ar-1", year: 2019)
    }
}

@MainActor
@Suite("Downloads")
struct DownloadTests {
    // MARK: The queue and the state of each song

    @Test("A download fetches its cover, then its songs, two at a time; each song's state follows")
    func queue() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(3))
        #expect(rig.transport.started == ["c:al-1", "t:al-1-t1"])
        #expect(d.state(of: song(1)) == .downloading(0))
        #expect(d.state(of: song(2)) == .queued)
        #expect(d.status(.album, "al-1").state == .downloading)

        rig.transport.finish("c:al-1", size: 500)
        #expect(rig.transport.started == ["c:al-1", "t:al-1-t1", "t:al-1-t2"])
        rig.transport.progress("t:al-1-t1", 50, of: 200)
        #expect(d.state(of: song(1)) == .downloading(0.25))
        let status = d.status(.album, "al-1")
        #expect(status.done == 0 && status.total == 3)
        #expect(abs(status.progress - 0.25 / 3) < 0.0001)

        rig.transport.finish("t:al-1-t1", size: 2000)
        #expect(d.state(of: song(1)) == .done)
        #expect(d.isDownloaded(song(1)))
        #expect(rig.transport.started.last == "t:al-1-t3")
        rig.transport.finish("t:al-1-t2", size: 3000)
        rig.transport.finish("t:al-1-t3", size: 4000)
        let done = d.status(.album, "al-1")
        #expect(done == DownloadStatus(state: .done, done: 3, total: 3, progress: 1))
        #expect(d.inFlight.isEmpty)
    }

    @Test("Songs wait for covers; the newest download goes first")
    func newestFirst() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(3, id: "al-1"))
        rig.clock.advance(60)
        d.download(rig.album(2, id: "al-2"))
        #expect(rig.transport.started == ["c:al-1", "t:al-1-t1"]) // the slots were taken already
        rig.transport.finish("c:al-1")
        #expect(rig.transport.started.last == "c:al-2") // then the newest download's cover
        rig.transport.finish("t:al-1-t1")
        #expect(rig.transport.started.last == "t:al-2-t1") // and its first song before the older one's second
    }

    @Test("A song the server refuses fails, the others go on, and Retry asks again")
    func failureAndRetry() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(3))
        rig.transport.finish("c:al-1")
        rig.transport.finish("t:al-1-t1", status: 401)
        #expect(d.state(of: song(1)) == .failed("Not allowed. Sign in again."))
        #expect(rig.transport.started.contains("t:al-1-t3")) // went on
        rig.transport.fail("t:al-1-t2", "The network connection was lost.")
        #expect(d.state(of: song(2)) == .failed("The network connection was lost."))
        rig.transport.finish("t:al-1-t3")
        #expect(d.status(.album, "al-1").state == .failed)
        #expect(d.status(.album, "al-1").done == 1)
        #expect(d.hasFailures)

        let before = rig.transport.started.count
        d.retry(.album, "al-1")
        #expect(rig.transport.started.count == before + 2)
        #expect(rig.transport.started.suffix(2) == ["t:al-1-t1", "t:al-1-t2"])
        #expect(!d.hasFailures)
        rig.transport.finish("t:al-1-t1")
        rig.transport.finish("t:al-1-t2")
        #expect(d.status(.album, "al-1").state == .done)
    }

    @Test("An empty body is a failure, not a song")
    func emptyBody() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(1))
        rig.transport.finish("c:al-1")
        rig.transport.finish("t:al-1-t1", size: 0)
        #expect(!d.isDownloaded(song(1)))
        #expect(d.state(of: song(1)) == .failed("Couldn't keep the file."))
    }

    @Test("Signed out: nothing is requested and the songs say so")
    func signedOut() async throws {
        let rig = DownloadRig(signedIn: false)
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(2))
        #expect(rig.transport.started.isEmpty)
        #expect(d.state(of: song(1)) == .failed("Sign in again to download."))
    }

    @Test("Nothing starts before resume: a fetch the system kept is not started twice")
    func notBeforeResume() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        d.download(rig.album(2))
        #expect(rig.transport.started.isEmpty)
        await d.resume()
        #expect(rig.transport.started == ["c:al-1", "t:al-1-t1"])
    }

    // MARK: Wi-Fi only

    @Test("Wi-Fi only asks for a network that is not expensive; changing it starts the fetches again")
    func wifiOnly() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(2))
        #expect(rig.transport.requests["t:al-1-t1"]?.allowsExpensiveNetworkAccess == false)
        rig.wifiOnly = false
        d.networkPolicyChanged()
        #expect(rig.transport.cancelledAll == 1)
        #expect(rig.transport.started.count == 4)
        #expect(rig.transport.requests["t:al-1-t1"]?.allowsExpensiveNetworkAccess == true)
    }

    // MARK: Relaunch

    @Test("After a relaunch the finished files are known, a fetch the system kept is taken up, the rest goes on")
    func relaunch() async throws {
        let rig = DownloadRig()
        let first = rig.downloads!
        await first.resume()
        first.download(rig.album(4))
        rig.transport.finish("c:al-1", size: 100)
        rig.transport.finish("t:al-1-t1", size: 2000)
        // The app goes away; the system still has song 2 running.
        let d = rig.relaunch(running: ["t:al-1-t2"])
        #expect(d.isDownloaded(song(1)))
        #expect(d.items.count == 1)
        await d.resume()
        #expect(d.state(of: song(2)) == .downloading(0))
        #expect(!rig.transport.started.contains("t:al-1-t2")) // not started twice
        #expect(rig.transport.started == ["t:al-1-t3"]) // the free slot
        rig.transport.progress("t:al-1-t2", 10, of: 40)
        #expect(d.state(of: song(2)) == .downloading(0.25))
    }

    @Test("What finished while the app was away is taken in")
    func finishedMeanwhile() async throws {
        let rig = DownloadRig()
        let first = rig.downloads!
        await first.resume()
        first.download(rig.album(3))
        rig.transport.finish("c:al-1")
        let d = rig.relaunch(running: [])
        // The system tells the new session what finished, before the app asks what is running.
        rig.transport.finish("t:al-1-t1", size: 777)
        #expect(d.isDownloaded(song(1)))
        #expect(d.localURL(song(1)) != nil)
        await d.resume()
        #expect(rig.transport.started == ["t:al-1-t2", "t:al-1-t3"])
    }

    @Test("The index is made right with the files: one that arrived unrecorded, one that is gone")
    func reconcile() async throws {
        let rig = DownloadRig()
        let first = rig.downloads!
        await first.resume()
        first.download(rig.album(3))
        rig.transport.finish("c:al-1", size: 100)
        rig.transport.finish("t:al-1-t1", size: 1000)
        rig.transport.finish("t:al-1-t2", size: 2000)
        // Song 3 reached its place but not the index (a crash between); song 1's file was taken away.
        try Data(repeating: 1, count: 3000).write(to: rig.store.trackFile("al-1-t3"))
        try FileManager.default.removeItem(at: rig.store.trackFile("al-1-t1"))
        let d = rig.relaunch()
        await d.resume()
        #expect(d.isDownloaded(song(3)))
        #expect(d.index.files["al-1-t3"] == 3000)
        #expect(!d.isDownloaded(song(1)))
        #expect(d.localURL(song(1)) == nil)
        #expect(rig.transport.started == ["t:al-1-t1"]) // fetched again
    }

    // MARK: Storage

    @Test("What the files weigh: in the index, on disk and per download; shared files stay until both go")
    func storage() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        let album = rig.album(2)
        let playlist = DownloadItem(
            kind: .playlist, id: "pl-1", title: "Late Ferries", subtitle: "ada", cover: nil,
            tracks: [song(2), song(1, album: "al-2")])
        d.download(album)
        rig.transport.finish("c:al-1", size: 100)
        rig.transport.finish("t:al-1-t1", size: 1000)
        rig.transport.finish("t:al-1-t2", size: 2000)
        d.download(playlist)
        rig.transport.finish("c:al-2", size: 50)
        rig.transport.finish("t:al-2-t1", size: 4000)
        #expect(d.bytes == 100 + 1000 + 2000 + 50 + 4000)
        #expect(d.bytes == rig.store.bytes)
        #expect(d.bytes(of: album) == 100 + 1000 + 2000)
        #expect(d.bytes(of: playlist) == 2000 + 4000 + 100 + 50) // song 2 is in both
        #expect(d.songCount == 3)

        d.remove(.album, "al-1")
        #expect(d.isDownloaded(song(2))) // the playlist still needs it
        #expect(!d.isDownloaded(song(1)))
        #expect(rig.store.existingTrack("al-1-t2") != nil)
        #expect(rig.store.existingTrack("al-1-t1") == nil)
        #expect(d.bytes == rig.store.bytes)
        #expect(d.bytes == 2000 + 4000 + 100 + 50) // the cover the playlist's song uses stays

        d.remove(.playlist, "pl-1")
        #expect(d.bytes == 0)
        #expect(rig.store.bytes == 0)
        #expect(d.isEmpty)
    }

    @Test("Removing a download stops what is being fetched for it, and a late answer is thrown away")
    func removeInFlight() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(2))
        rig.transport.finish("c:al-1")
        d.remove(.album, "al-1")
        #expect(rig.transport.cancelled.contains("t:al-1-t1"))
        #expect(d.inFlight.isEmpty)
        let staged = rig.transport.finish("t:al-1-t1")
        #expect(!d.isDownloaded(song(1)))
        #expect(!FileManager.default.fileExists(atPath: staged.path(percentEncoded: false)))
        #expect(rig.store.bytes == 0)
    }

    @Test("Signing out removes every download and every file")
    func signOut() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(2))
        rig.transport.finish("c:al-1")
        rig.transport.finish("t:al-1-t1")
        #expect(d.bytes > 0)
        d.reset()
        #expect(d.isEmpty)
        #expect(d.bytes == 0)
        #expect(d.inFlight.isEmpty)
        #expect(rig.transport.cancelledAll == 1)
        #expect(rig.store.bytes == 0)
        #expect(rig.store.readIndex() == DownloadIndex())
        // And it stays gone after a relaunch.
        let again = rig.relaunch()
        #expect(again.isEmpty)
    }

    @Test("Liked Songs follows the hearts: a song that leaves loses its file, a new one is fetched")
    func likedFollowsHearts() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(DownloadItem.liked(songs(1...2)))
        rig.transport.finish("c:al-1")
        rig.transport.finish("t:al-1-t1")
        rig.transport.finish("t:al-1-t2")
        let added = d.items[0].addedAt
        rig.clock.advance(100)
        d.sync(.liked([song(2), song(3)]))
        #expect(!d.isDownloaded(song(1)))
        #expect(rig.store.existingTrack("al-1-t1") == nil)
        #expect(d.isDownloaded(song(2)))
        #expect(rig.transport.started.last == "t:al-1-t3")
        #expect(d.items[0].addedAt == added)
        #expect(d.likedTracks?.map(\.id) == ["al-1-t2", "al-1-t3"])
        // Nothing changed: nothing happens.
        let count = rig.transport.started.count
        d.sync(.liked([song(2), song(3)]))
        #expect(rig.transport.started.count == count)
        // Not downloaded: a heart changes nothing.
        d.sync(DownloadItem(kind: .album, id: "other", title: "Other", tracks: [song(1)]))
        #expect(d.items.count == 1)
    }

    // MARK: The real client's requests

    @Test("A song is asked for as MP3 at 192 with the device token; a cover at 600")
    func requests() throws {
        let client = EchoClient(base: URL(string: "https://echo.test/")!, token: "echo_dt_x")
        let request = try #require(client.trackRequest(song(1)))
        let url = try #require(request.url)
        #expect(url.path == "/api/v1/navidrome/stream/al-1-t1")
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.reduce(into: [String: String]()) { $0[$1.name] = $1.value }
        #expect(query == ["format": "mp3", "maxBitRate": "192", "estimateContentLength": "true"])
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer echo_dt_x")
        let cover = try #require(client.coverRequest(id: "al-1"))
        #expect(cover.url?.absoluteString == "https://echo.test/api/v1/navidrome/cover/al-1?size=600")
        #expect(cover.value(forHTTPHeaderField: "Authorization") == "Bearer echo_dt_x")
        #expect(EchoClient(base: URL(string: "https://echo.test")!).trackRequest(song(1)) == nil)
        var other = song(1)
        other.provider = "spotify"
        #expect(client.trackRequest(other) == nil)
    }

    // MARK: Playing

    @Test("A downloaded song plays from its file, with no stream URL asked for; the rest stream")
    func playerChoosesLocal() async throws {
        let clock = TestClock()
        let engine = FakeEngine()
        let source = FakeSource(clock: clock)
        let sleeps = Sleeps()
        let file = URL(fileURLWithPath: "/tmp/echo-local-1.mp3")
        let player = Player(
            source: source, engine: engine, follows: false,
            local: { $0.id == "al-1-t1" ? file : nil }, sleep: sleeps.sleep, now: { clock.now })
        await player.play(songs(1...2), at: 0, context: albumContext)
        #expect(engine.loads.first?.url == file)
        #expect(engine.loads.first?.expiresAt == .distantFuture)
        #expect(player.status == .playing)
        // The next song, not downloaded, is buffered from a stream URL; the first never asked for one.
        #expect(await eventually { engine.preloaded?.key == "navidrome:al-1-t2" })
        #expect(engine.preloaded?.url.absoluteString.hasPrefix("https://echo.test/api/v1/navidrome/stream/al-1-t2") == true)
        #expect(!source.streams.contains("al-1-t1"))

        player.next()
        #expect(await eventually { engine.current?.key == "navidrome:al-1-t2" })
        #expect(source.streams == ["al-1-t2"])
    }

    @Test("Offline, a downloaded song plays and one that is not fails with the offline message; scrobbles are not queued")
    func playsOffline() async throws {
        let clock = TestClock()
        let engine = FakeEngine()
        let source = FakeSource(clock: clock)
        source.streamError = .offline
        let sleeps = Sleeps()
        let file = URL(fileURLWithPath: "/tmp/echo-local-1.mp3")
        var notices: [String] = []
        let player = Player(
            source: source, engine: engine, follows: false, notify: { notices.append($0) },
            local: { $0.id == "al-1-t1" ? file : nil }, sleep: sleeps.sleep, now: { clock.now })
        await player.play(songs(1...2), at: 0, context: albumContext)
        #expect(player.status == .playing)
        #expect(engine.loads.first?.url == file)
        player.next()
        #expect(await eventually { player.status == .failed })
        #expect(player.error == .offline)
        #expect(notices.contains(ApiError.offline.userMessage))
        // The queue is still the queue.
        #expect(player.track?.id == "al-1-t2")
    }

    // MARK: The Library offline

    @Test("Offline the pages show the downloaded copy, and only downloaded songs can play")
    func libraryOffline() async throws {
        let rig = DownloadRig()
        let d = rig.downloads!
        await d.resume()
        d.download(rig.album(3))
        d.download(DownloadItem.liked([song(1), song(9, album: "al-9")]))
        rig.transport.finish("c:al-1")
        rig.transport.finish("t:al-1-t1")
        rig.transport.finish("t:al-1-t2")

        let album = try #require(d.album("al-1"))
        #expect(album.title == "Album al-1")
        #expect(album.artist == "Lowfield")
        #expect(album.artistId == "ar-1")
        #expect(album.year == 2019)
        #expect(album.tracks.map(\.id) == ["al-1-t1", "al-1-t2", "al-1-t3"])
        #expect(album.cover == "/api/v1/navidrome/cover/al-1?size=300")
        #expect(d.album("nope") == nil)
        #expect(d.likedTracks?.count == 2)

        let playlist = DownloadItem(kind: .playlist, id: "pl", title: "Mix", subtitle: "ada", tracks: songs(1...2) + [song(1, album: "al-2")])
        let detail = playlist.asPlaylist
        #expect(detail.playlist.name == "Mix")
        #expect(detail.playlist.owner == "ada")
        #expect(detail.playlist.tracks == 3)
        #expect(detail.covers.count == 2)
        #expect(detail.entries.count == 3)

        let connectivity = Connectivity(watchNetwork: false, probe: nil)
        connectivity.networkChanged(false)
        #expect(!connectivity.isOnline)
        #expect(d.isPlayable(song(1), online: connectivity.isOnline))
        #expect(!d.isPlayable(song(3), online: connectivity.isOnline)) // queued, not here
        connectivity.networkChanged(true)
        #expect(d.isPlayable(song(3), online: connectivity.isOnline))
    }

    // MARK: Settings' numbers

    @Test("Sizes, lines and the summary as Settings and Library say them")
    func numbers() async throws {
        #expect(DownloadText.bytes(0) == "0 KB")
        #expect(DownloadText.bytes(480_000) == "480 KB")
        #expect(DownloadText.bytes(999_000) == "999 KB")
        #expect(DownloadText.bytes(34_500_000) == "34.5 MB")
        #expect(DownloadText.bytes(1_250_000_000) == "1.25 GB")
        #expect(DownloadText.songs(1) == "1 song")
        #expect(DownloadText.songs(8) == "8 songs")

        let rig = DownloadRig()
        let d = rig.downloads!
        #expect(d.summary == "Nothing yet")
        await d.resume()
        let album = rig.album(2)
        d.download(album)
        rig.transport.finish("c:al-1", size: 400_000)
        rig.transport.finish("t:al-1-t1", size: 5_000_000)
        #expect(DownloadText.line(album, status: d.status(.album, "al-1"), bytes: d.bytes(of: album)) == "Album · Downloading 1 of 2")
        rig.transport.finish("t:al-1-t2", size: 6_100_000)
        #expect(d.bytes == 11_500_000)
        #expect(d.summary == "2 songs · 11.5 MB")
        #expect(DownloadText.line(album, status: d.status(.album, "al-1"), bytes: d.bytes(of: album)) == "Album · 2 songs · 11.5 MB")
        d.removeAll()
        #expect(d.summary == "Nothing yet")
    }

    @Test("Wi-Fi only is on until it is turned off, and kept on this device")
    func wifiSetting() throws {
        let name = "downloads-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        #expect(DeviceSettings(defaults: defaults).downloadWifiOnly)
        DeviceSettings(defaults: defaults).setDownloadWifiOnly(false)
        #expect(defaults.bool(forKey: DeviceSettings.downloadWifiOnlyKey) == false)
        #expect(!DeviceSettings(defaults: defaults).downloadWifiOnly)
        #expect(DeviceSettings(defaults: nil).downloadWifiOnly)
    }

    // MARK: The index

    @Test("Cover ids, the index's order, and what goes when a download does")
    func index() throws {
        #expect(DownloadIndex.coverId("/api/v1/navidrome/cover/al-1?size=600") == "al-1")
        #expect(DownloadIndex.coverId("/api/v1/navidrome/cover/a%20b?size=300") == "a b")
        #expect(DownloadIndex.coverId("demo:harbour?size=300") == nil)
        #expect(DownloadIndex.coverId(nil) == nil)

        var index = DownloadIndex()
        let older = DownloadItem(kind: .album, id: "a", title: "A", tracks: songs(1...2, album: "a"), addedAt: Date(timeIntervalSince1970: 100))
        let newer = DownloadItem(kind: .playlist, id: "p", title: "P", tracks: [song(2, album: "a"), song(1, album: "b")], addedAt: Date(timeIntervalSince1970: 200))
        index.put(older)
        index.put(newer)
        #expect(index.missingTracks.map(\.id) == ["a-t2", "b-t1", "a-t1"]) // the newest first, each once
        index.files["a-t2"] = 10
        index.covers["a"] = 5
        index.covers["b"] = 6
        let lost = index.remove(.playlist, "p")
        #expect(lost.tracks.isEmpty) // song 2 is the album's too: not lost
        #expect(lost.covers == ["b"])
        let data = try JSONEncoder().encode(index)
        #expect(try JSONDecoder().decode(DownloadIndex.self, from: data) == index)
    }
}
