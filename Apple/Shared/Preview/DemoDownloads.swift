import Foundation

// The preview's downloads (`-ECHODemo downloads`, `downloads-album`, `downloads-settings`): Harbour
// Lights half way (three songs on the device, one being fetched, two waiting), Paper Satellites, the
// Rain on Glass playlist and Liked Songs done, so the Library's Downloads page, an album with its
// progress ring and Settings → Downloads show real numbers. Nothing is fetched: the transport never
// starts anything and the requests are none.

@MainActor
final class DemoTransport: DownloadTransport {
    var onEvent: ((TransportEvent) -> Void)?
    func start(key: String, request: URLRequest) {}
    func cancel(key: String) {}
    func cancelAll() {}
    func running() async -> Set<String> { [] }
}

struct DemoRequests: DownloadRequests {
    func trackRequest(_ track: Track) -> URLRequest? { nil }
    func coverRequest(id: String) -> URLRequest? { nil }
}

extension Downloads {
    /// The preview's downloads: empty, except on the screens named `downloads…`.
    static func demo(screen: String) -> Downloads {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("echo-demo-downloads-\(UUID().uuidString)", isDirectory: true)
        let downloads = Downloads(store: DownloadStore(directory: folder), transport: DemoTransport(), requests: DemoRequests())
        if screen.hasPrefix("downloads") {
            let (index, fetching) = DemoDownloads.state()
            downloads.preview(index, fetching: fetching)
        }
        return downloads
    }
}

enum DemoDownloads {
    /// A song of an album, as an MP3 at 192 kbps weighs.
    private static func bytes(_ track: Track) -> Int { track.seconds * 24_000 }

    static func state(now: Date = Date()) -> (DownloadIndex, [String: Double]) {
        let harbour = DemoLibrary.album(Demo.harbour, songs: true)
        let paper = DemoLibrary.album(Demo.albums[1], songs: true)
        let rain = DemoLibrary.songs(DemoLibrary.playlistSongs["rain-on-glass"] ?? [])
        let liked = DemoLibrary.songs(DemoLibrary.likedSongs)
        let playlist = DemoLibrary.playlistList.first { $0.id == "rain-on-glass" }

        var index = DownloadIndex()
        index.put(DownloadItem(album: paper, addedAt: now.addingTimeInterval(-86_400 * 3)))
        index.put(DownloadItem(
            kind: .playlist, id: "rain-on-glass", title: "Rain on Glass", subtitle: playlist?.owner, cover: playlist?.cover,
            tracks: rain, addedAt: now.addingTimeInterval(-86_400 * 2)))
        index.put(DownloadItem.liked(liked, addedAt: now.addingTimeInterval(-86_400)))
        index.put(DownloadItem(album: harbour, addedAt: now.addingTimeInterval(-90)))

        let done = Set(paper.tracks.map(\.id) + rain.map(\.id) + liked.map(\.id) + ["harbour-0", "harbour-1"])
        for track in index.items.flatMap(\.tracks) where done.contains(track.id) {
            index.files[track.id] = bytes(track)
        }
        // Harbour Lights' third song is on its way.
        return (index, ["t:harbour-2": 0.45])
    }
}
