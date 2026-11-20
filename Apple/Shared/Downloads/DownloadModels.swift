import Foundation

// What is downloaded, as the Android app keeps it (offline/OfflineIndex.kt): each album, playlist and
// Liked Songs with the songs as they were last seen online, and the finished files (a song's id or a
// cover's id, and its size in bytes). A song or cover two downloads share is kept until both go.

enum DownloadKind: String, Codable, Sendable {
    case album, playlist, liked
}

/// One download: an album, a playlist or Liked Songs, with its songs.
struct DownloadItem: Codable, Equatable, Sendable {
    var kind: DownloadKind
    /// The album's or playlist's id; "liked" for Liked Songs.
    var id: String
    var title: String
    /// An album's artist, a playlist's owner.
    var subtitle: String?
    /// The cover's server path.
    var cover: String?
    var tracks: [Track]
    var addedAt: Date
    var artistId: String? = nil
    var year: Int? = nil
    var comment: String? = nil

    /// Kind and id together: what tells two downloads apart.
    var key: String { "\(kind.rawValue):\(id)" }

    /// The song ids, each once, in order.
    var trackIds: [String] {
        var seen = Set<String>()
        return tracks.compactMap { seen.insert($0.id).inserted ? $0.id : nil }
    }

    /// The cover ids this download needs: its own and its songs'.
    var coverIds: [String] {
        var seen = Set<String>()
        var ids: [String] = []
        for path in [cover] + tracks.map(\.cover) {
            if let id = DownloadIndex.coverId(path), seen.insert(id).inserted { ids.append(id) }
        }
        return ids
    }

    static let likedId = "liked"

    init(
        kind: DownloadKind, id: String, title: String, subtitle: String? = nil, cover: String? = nil,
        tracks: [Track], addedAt: Date = Date(), artistId: String? = nil, year: Int? = nil, comment: String? = nil
    ) {
        self.kind = kind
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.cover = cover
        self.tracks = tracks
        self.addedAt = addedAt
        self.artistId = artistId
        self.year = year
        self.comment = comment
    }

    init(album: Album, tracks: [Track]? = nil, addedAt: Date = Date()) {
        self.init(
            kind: .album, id: album.id, title: album.title, subtitle: album.artist, cover: album.cover,
            tracks: tracks ?? album.tracks, addedAt: addedAt, artistId: album.artistId, year: album.year)
    }

    init(playlist detail: PlaylistDetail, addedAt: Date = Date()) {
        self.init(
            kind: .playlist, id: detail.playlist.id, title: detail.playlist.name, subtitle: detail.playlist.owner,
            cover: detail.playlist.cover ?? detail.covers.first, tracks: detail.entries, addedAt: addedAt,
            comment: detail.comment)
    }

    static func liked(_ tracks: [Track], addedAt: Date = Date()) -> DownloadItem {
        DownloadItem(kind: .liked, id: likedId, title: "Liked Songs", tracks: tracks, addedAt: addedAt)
    }

    /// The album page's copy of it, to show offline.
    var asAlbum: Album {
        Album(
            id: id, title: title, artist: subtitle ?? "", artistId: artistId, year: year, songCount: tracks.count,
            durationSec: tracks.reduce(0) { $0 + $1.durationMs } / 1000, cover: cover, tracks: tracks)
    }

    /// The playlist page's copy of it.
    var asPlaylist: PlaylistDetail {
        var covers: [String] = []
        for path in tracks.compactMap(\.cover) where !covers.contains(path) { covers.append(path) }
        return PlaylistDetail(
            playlist: Playlist(
                id: id, name: title, tracks: tracks.count, cover: cover, owner: subtitle,
                durationSec: tracks.reduce(0) { $0 + $1.durationMs } / 1000),
            comment: comment, covers: Array(covers.prefix(4)), entries: tracks)
    }
}

/// The downloads and the files that are finished.
struct DownloadIndex: Codable, Equatable, Sendable {
    var items: [DownloadItem] = []
    /// Finished songs: id → bytes.
    var files: [String: Int] = [:]
    /// Finished covers: id → bytes.
    var covers: [String: Int] = [:]

    func item(_ kind: DownloadKind, _ id: String) -> DownloadItem? {
        items.first { $0.kind == kind && $0.id == id }
    }

    /// A download added, or replaced by the same album, playlist or Liked Songs (it keeps its place
    /// in time when `keepDate`).
    mutating func put(_ item: DownloadItem, keepDate: Bool = false) {
        var item = item
        if let at = items.firstIndex(where: { $0.key == item.key }) {
            if keepDate { item.addedAt = items[at].addedAt }
            items[at] = item
        } else {
            items.append(item)
        }
    }

    /// Every song id some download needs.
    var neededTracks: Set<String> { Set(items.flatMap(\.trackIds)) }
    var neededCovers: Set<String> { Set(items.flatMap(\.coverIds)) }

    /// A download taken out: the song and cover ids no download needs now (their files may go).
    mutating func remove(_ kind: DownloadKind, _ id: String) -> (tracks: [String], covers: [String]) {
        items.removeAll { $0.kind == kind && $0.id == id }
        return dropUnneeded()
    }

    /// Forgets the finished files nothing needs, and says which they were.
    mutating func dropUnneeded() -> (tracks: [String], covers: [String]) {
        let tracks = neededTracks, covers = neededCovers
        let lostTracks = files.keys.filter { !tracks.contains($0) }.sorted()
        let lostCovers = self.covers.keys.filter { !covers.contains($0) }.sorted()
        for id in lostTracks { files[id] = nil }
        for id in lostCovers { self.covers[id] = nil }
        return (lostTracks, lostCovers)
    }

    /// The songs still to fetch: the newest download's first, each once.
    var missingTracks: [Track] {
        var seen = Set<String>()
        var list: [Track] = []
        for item in items.sorted(by: { $0.addedAt > $1.addedAt }) {
            for track in item.tracks where files[track.id] == nil && seen.insert(track.id).inserted {
                list.append(track)
            }
        }
        return list
    }

    var missingCovers: [String] {
        var seen = Set<String>()
        var list: [String] = []
        for item in items.sorted(by: { $0.addedAt > $1.addedAt }) {
            for id in item.coverIds where covers[id] == nil && seen.insert(id).inserted { list.append(id) }
        }
        return list
    }

    /// How many of a download's songs are finished.
    func done(_ item: DownloadItem) -> Int {
        item.trackIds.filter { files[$0] != nil }.count
    }

    /// What every finished file weighs.
    var bytes: Int { files.values.reduce(0, +) + covers.values.reduce(0, +) }

    /// What a download's own songs and covers weigh (one two downloads share counts in each).
    func bytes(of item: DownloadItem) -> Int {
        item.trackIds.reduce(0) { $0 + (files[$1] ?? 0) } + item.coverIds.reduce(0) { $0 + (covers[$1] ?? 0) }
    }

    /// The cover id in a server cover path ("/api/v1/navidrome/cover/al-1?size=300" → "al-1").
    static func coverId(_ path: String?) -> String? {
        guard let path, let found = path.range(of: "/navidrome/cover/") else { return nil }
        let rest = path[found.upperBound...]
        guard let first = rest.split(separator: "?", omittingEmptySubsequences: false).first, !first.isEmpty else {
            return nil
        }
        return String(first).removingPercentEncoding ?? String(first)
    }
}

/// Where a song, or a whole download, stands.
enum TrackDownload: Equatable, Sendable {
    case none
    /// In a download, waiting its turn.
    case queued
    /// Being fetched, 0…1.
    case downloading(Double)
    case done
    case failed(String)
}

/// How a download stands as a whole.
struct DownloadStatus: Equatable, Sendable {
    enum State: Equatable, Sendable { case none, queued, downloading, done, failed }

    var state = State.none
    var done = 0
    var total = 0
    /// 0…1 over all its songs, the one being fetched included.
    var progress = 0.0

    static let none = DownloadStatus()
}

/// Sizes and counts as Settings and the Downloads page say them.
enum DownloadText {
    /// "0 KB", "480 KB", "34.5 MB", "1.25 GB" (decimal units, as the system's storage page shows).
    static func bytes(_ n: Int) -> String {
        let b = Double(max(0, n))
        if b < 999_500 { return "\(Int((b / 1000).rounded())) KB" }
        if b < 1_000_000_000 { return String(format: "%.1f MB", b / 1_000_000) }
        return String(format: "%.2f GB", b / 1_000_000_000)
    }

    /// "Album", "Playlist", "Liked Songs" as a line's first word.
    static func kind(_ kind: DownloadKind) -> String {
        switch kind {
        case .album: "Album"
        case .playlist: "Playlist"
        case .liked: "Playlist"
        }
    }

    static func songs(_ n: Int) -> String { n == 1 ? "1 song" : "\(n) songs" }

    /// "Album · 8 songs · 34.5 MB", or "Album · Downloading 3 of 8", or "Album · 3 of 8 · failed".
    static func line(_ item: DownloadItem, status: DownloadStatus, bytes: Int) -> String {
        let head = kind(item.kind)
        switch status.state {
        case .done: return "\(head) · \(songs(status.total)) · \(Self.bytes(bytes))"
        case .downloading: return "\(head) · Downloading \(status.done) of \(status.total)"
        case .queued: return "\(head) · Waiting · \(status.done) of \(status.total)"
        case .failed: return "\(head) · \(status.done) of \(status.total) · Couldn't finish"
        case .none: return head
        }
    }
}
