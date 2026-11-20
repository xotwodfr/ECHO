import Foundation
import Observation

// Offline downloads (the Android app's offline/Downloads.kt and DownloadWorker.kt): albums,
// playlists and Liked Songs into the app's container. Each song is fetched on its own, two at a time,
// newest download first, covers before songs; each has its state (queued, downloading, done, failed)
// and the download's progress is the songs' together. The files and the index are on disk, so the
// Library can be shown offline; a song that is here plays from its file (Player.local), online or not.
//
// The fetching is a transport's (DownloadTransport): the iPhone's background URLSession goes on when
// the app is closed and tells the app what finished when it is launched again, which `resume()`
// picks up. A failed song stays failed until Retry (or the next start, which tries again).

/// The requests that fetch a song and a cover: EchoClient makes them with the device token.
protocol DownloadRequests: Sendable {
    func trackRequest(_ track: Track) -> URLRequest?
    func coverRequest(id: String) -> URLRequest?
}

@MainActor @Observable
final class Downloads {
    private(set) var index: DownloadIndex
    /// The fetches under way ("t:<song id>", "c:<cover id>"), and how far each is, 0…1.
    private(set) var inFlight: Set<String> = []
    private(set) var progress: [String: Double] = [:]
    /// Why a song failed, by id.
    private(set) var failures: [String: String] = [:]

    @ObservationIgnored private let store: DownloadStore
    @ObservationIgnored private let transport: any DownloadTransport
    @ObservationIgnored private let requests: any DownloadRequests
    @ObservationIgnored private let wifiOnly: @MainActor () -> Bool
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var neededTracks: Set<String> = []
    @ObservationIgnored private var neededCovers: Set<String> = []
    @ObservationIgnored private var failedCovers: Set<String> = []
    /// Whether the fetches the system kept have been taken up (resume()); nothing starts before, so
    /// a fetch still running is never started twice.
    @ObservationIgnored private var resumed = false
    /// The preview's: it has no files and fetches nothing, so nothing is made right or started.
    @ObservationIgnored private var previewing = false

    /// Fetches at once.
    static let concurrent = 2

    /// - Parameters:
    ///   - wifiOnly: whether downloads wait for a network that is not expensive (cellular, a hotspot):
    ///     the Settings toggle, asked each time a fetch starts.
    init(
        store: DownloadStore, transport: any DownloadTransport, requests: any DownloadRequests,
        wifiOnly: @escaping @MainActor () -> Bool = { true }, now: @escaping () -> Date = { Date() }
    ) {
        self.store = store
        self.transport = transport
        self.requests = requests
        self.wifiOnly = wifiOnly
        self.now = now
        index = store.readIndex()
        neededTracks = index.neededTracks
        neededCovers = index.neededCovers
        transport.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: - What pages ask

    /// What every finished file weighs.
    var bytes: Int { index.bytes }
    var isEmpty: Bool { index.items.isEmpty }
    /// The downloads, the newest first.
    var items: [DownloadItem] { index.items.sorted { $0.addedAt > $1.addedAt } }
    /// The finished songs, each once.
    var songCount: Int { index.files.count }

    func isDownloaded(_ track: Track) -> Bool { index.files[track.id] != nil }

    /// Whether a song can be played: online, any; offline, the downloaded ones.
    func isPlayable(_ track: Track, online: Bool) -> Bool { online || isDownloaded(track) }

    /// "3 songs · 14.2 MB" under the Library's Downloads row, "Nothing yet".
    var summary: String {
        isEmpty ? "Nothing yet" : "\(DownloadText.songs(songCount)) · \(DownloadText.bytes(bytes))"
    }

    func state(of track: Track) -> TrackDownload {
        let id = track.id
        if index.files[id] != nil { return .done }
        if inFlight.contains("t:" + id) { return .downloading(progress["t:" + id] ?? 0) }
        if let why = failures[id] { return .failed(why) }
        return neededTracks.contains(id) ? .queued : .none
    }

    func status(_ kind: DownloadKind, _ id: String) -> DownloadStatus {
        guard let item = index.item(kind, id) else { return .none }
        let ids = item.trackIds
        let done = ids.filter { index.files[$0] != nil }.count
        if done >= ids.count { return DownloadStatus(state: .done, done: done, total: ids.count, progress: 1) }
        let waiting = ids.filter { index.files[$0] == nil }
        let partial = waiting.reduce(0.0) { $0 + (inFlight.contains("t:" + $1) ? (progress["t:" + $1] ?? 0) : 0) }
        let value = min(1, (Double(done) + partial) / Double(ids.count))
        let state: DownloadStatus.State
        if waiting.contains(where: { inFlight.contains("t:" + $0) }) {
            state = .downloading
        } else if waiting.allSatisfy({ failures[$0] != nil }) {
            state = .failed
        } else {
            state = .queued
        }
        return DownloadStatus(state: state, done: done, total: ids.count, progress: value)
    }

    /// What a download's own files weigh.
    func bytes(of item: DownloadItem) -> Int { index.bytes(of: item) }

    /// The song's file, when it is all here.
    func localURL(_ track: Track) -> URL? {
        index.files[track.id] != nil ? store.existingTrack(track.id) : nil
    }

    /// A downloaded album, as its page shows it offline.
    func album(_ id: String) -> Album? { index.item(.album, id)?.asAlbum }
    func playlist(_ id: String) -> PlaylistDetail? { index.item(.playlist, id)?.asPlaylist }
    /// Liked Songs as downloaded; nil when they are not.
    var likedTracks: [Track]? { index.item(.liked, DownloadItem.likedId)?.tracks }

    /// Whether any download failed in part.
    var hasFailures: Bool { !failures.isEmpty }

    // MARK: - What people do

    /// Downloads an album, a playlist or Liked Songs: its songs and covers are fetched from now on
    /// (again, as a new download, when it was one already).
    func download(_ item: DownloadItem) {
        guard !item.tracks.isEmpty else { return }
        var item = item
        item.addedAt = now()
        index.put(item)
        failedCovers = []
        for id in item.trackIds { failures[id] = nil }
        changed()
        pump()
    }

    /// Takes a download away with the files nothing else needs; what is being fetched for it stops.
    func remove(_ kind: DownloadKind, _ id: String) {
        let lost = index.remove(kind, id)
        store.remove(tracks: lost.tracks, covers: lost.covers)
        changed()
        pump()
    }

    /// Every download, and every file.
    func removeAll() {
        transport.cancelAll()
        inFlight = []
        progress = [:]
        failures = [:]
        failedCovers = []
        index = DownloadIndex()
        neededTracks = []
        neededCovers = []
        store.removeAll()
    }

    /// Signing out: nothing of the account stays.
    func reset() {
        removeAll()
    }

    /// Tries a download's failed songs again.
    func retry(_ kind: DownloadKind, _ id: String) {
        guard let item = index.item(kind, id) else { return }
        for track in item.trackIds { failures[track] = nil }
        failedCovers = []
        pump()
    }

    func retryAll() {
        failures = [:]
        failedCovers = []
        pump()
    }

    /// A download seen again online: its songs follow the album, the playlist or the hearts, the
    /// files of songs that left it go and the new ones are fetched.
    func sync(_ item: DownloadItem) {
        guard let current = index.item(item.kind, item.id) else { return }
        guard current.tracks != item.tracks || current.title != item.title || current.cover != item.cover else { return }
        var next = item
        next.addedAt = current.addedAt
        index.put(next, keepDate: true)
        let lost = index.dropUnneeded()
        store.remove(tracks: lost.tracks, covers: lost.covers)
        changed()
        pump()
    }

    /// The download choice changed (Wi-Fi only): what is being fetched starts again on the new terms.
    func networkPolicyChanged() {
        transport.cancelAll()
        inFlight = []
        progress = [:]
        pump()
    }

    /// The preview's state (`-ECHODemo`): what is downloaded, what is being fetched (song key → how
    /// far) and what failed, with no transport behind it.
    func preview(_ index: DownloadIndex, fetching: [String: Double] = [:], failed: [String: String] = [:]) {
        previewing = true
        self.index = index
        neededTracks = index.neededTracks
        neededCovers = index.neededCovers
        inFlight = Set(fetching.keys)
        progress = fetching
        failures = failed
    }

    // MARK: - Starting up

    /// At launch: the index is made right with the files on disk, the fetches the system kept
    /// running (or finished) while the app was away are taken up, and the rest goes on.
    func resume() async {
        guard !previewing else { return }
        reconcile()
        let running = await transport.running()
        for key in running {
            if isNeeded(key) {
                inFlight.insert(key)
                progress[key] = progress[key] ?? 0
            } else {
                transport.cancel(key: key)
            }
        }
        resumed = true
        pump()
    }

    /// The index and the files agree: a file made it to disk but not to the index (a crash between),
    /// or the system took one away.
    private func reconcile() {
        let present = store.present(tracks: neededTracks, covers: neededCovers)
        var edited = false
        for (id, size) in present.tracks where index.files[id] != size {
            index.files[id] = size
            edited = true
        }
        for (id, size) in present.covers where index.covers[id] != size {
            index.covers[id] = size
            edited = true
        }
        for id in Array(index.files.keys) where present.tracks[id] == nil {
            index.files[id] = nil
            edited = true
        }
        for id in Array(index.covers.keys) where present.covers[id] == nil {
            index.covers[id] = nil
            edited = true
        }
        if edited { changed() }
    }

    // MARK: - The queue

    private func isNeeded(_ key: String) -> Bool {
        if key.hasPrefix("t:") { return neededTracks.contains(String(key.dropFirst(2))) }
        if key.hasPrefix("c:") { return neededCovers.contains(String(key.dropFirst(2))) }
        return false
    }

    /// The index changed: what it needs is known again, fetches nothing needs stop, and it is saved.
    private func changed() {
        neededTracks = index.neededTracks
        neededCovers = index.neededCovers
        failures = failures.filter { neededTracks.contains($0.key) }
        for key in Array(inFlight) where !isNeeded(key) {
            transport.cancel(key: key)
            inFlight.remove(key)
            progress[key] = nil
        }
        store.writeIndex(index)
    }

    /// Starts fetches until two are under way: covers first, then songs, the newest download's first.
    private func pump() {
        guard resumed else { return }
        var slots = Self.concurrent - inFlight.count
        guard slots > 0 else { return }
        let expensive = !wifiOnly()
        for id in index.missingCovers where slots > 0 {
            let key = "c:" + id
            guard !inFlight.contains(key), !failedCovers.contains(id) else { continue }
            guard var request = requests.coverRequest(id: id) else {
                failedCovers.insert(id)
                continue
            }
            request.allowsExpensiveNetworkAccess = expensive
            begin(key, request)
            slots -= 1
        }
        for track in index.missingTracks where slots > 0 {
            let key = "t:" + track.id
            guard !inFlight.contains(key), failures[track.id] == nil else { continue }
            guard var request = requests.trackRequest(track) else {
                failures[track.id] = "Sign in again to download."
                continue
            }
            request.allowsExpensiveNetworkAccess = expensive
            begin(key, request)
            slots -= 1
        }
    }

    private func begin(_ key: String, _ request: URLRequest) {
        inFlight.insert(key)
        progress[key] = 0
        transport.start(key: key, request: request)
    }

    // MARK: - What the transport says

    func handle(_ event: TransportEvent) {
        switch event {
        case .progress(let key, let written, let expected):
            guard inFlight.contains(key) else { return }
            progress[key] = expected > 0 ? min(1, Double(written) / Double(expected)) : 0
        case .finished(let key, let file, let status):
            inFlight.remove(key)
            progress[key] = nil
            guard isNeeded(key) else {
                store.discard(file)
                pump()
                return
            }
            let answered = (200..<300).contains(status)
            let ok = answered && store.size(of: file) > 0
            let id = String(key.dropFirst(2))
            if key.hasPrefix("t:") {
                if ok, let size = store.install(file, track: id) {
                    index.files[id] = size
                    failures[id] = nil
                    changed()
                } else {
                    store.discard(file)
                    failures[id] = answered ? "Couldn't keep the file." : Self.why(status)
                }
            } else {
                if ok, let size = store.install(file, cover: id) {
                    index.covers[id] = size
                    changed()
                } else {
                    store.discard(file)
                    failedCovers.insert(id)
                }
            }
            pump()
        case .failed(let key, let message):
            inFlight.remove(key)
            progress[key] = nil
            if isNeeded(key) {
                if key.hasPrefix("t:") { failures[String(key.dropFirst(2))] = message } else { failedCovers.insert(String(key.dropFirst(2))) }
            }
            pump()
        }
    }

    /// What a refused fetch says.
    static func why(_ status: Int) -> String {
        switch status {
        case 0: "ECHO didn't answer."
        case 401, 403: "Not allowed. Sign in again."
        case 404: "Not on your server."
        case 409: "ECHO isn't connected to Navidrome."
        default: "ECHO answered \(status)."
        }
    }
}

extension EchoClient: DownloadRequests {
    /// A song as ECHO transcodes it for AVPlayer to play from a file: MP3 at 192 kbps through the
    /// stream proxy, with the device token (the fetch outlives the 6-hour signed URLs). The Android
    /// app's downloads are Opus at 192; AVPlayer plays MP3 from any file name.
    func trackRequest(_ track: Track) -> URLRequest? {
        guard track.provider == "navidrome", token != nil,
              let url = apiURL(
                "/navidrome/stream/\(Self.encode(track.id))",
                [("format", "mp3"), ("maxBitRate", "192"), ("estimateContentLength", "true")])
        else { return nil }
        var request = authorized(url)
        request.timeoutInterval = 120
        return request
    }

    func coverRequest(id: String) -> URLRequest? {
        guard token != nil, let path = Subsonic.cover(id, size: 600), let full = self.url(path) else { return nil }
        return authorized(full)
    }
}
