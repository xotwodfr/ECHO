import ImageIO
import SwiftUI

/// The preview's library (`-ECHODemo`): the web fixtures' albums (Demo.albums) as the library's
/// models, with playlists, hearts, mixes, the Wanted list and the Karaoke shelf made from them and
/// covers drawn in code, so a demo screen never reaches the network. `failing` answers everything as
/// ECHO not answering (the `shell` screen: the banner and the error states).
struct DemoLibrary: LibrarySource {
    var failing = false

    // MARK: - The library

    static func artistId(_ name: String) -> String {
        "ar-" + name.lowercased().replacingOccurrences(of: " ", with: "-")
    }

    /// A drawn cover's path, as the models keep ECHO's.
    static func cover(_ cover: DemoCover, size: Int = 300) -> String {
        "demo:\(cover.rawValue)?size=\(size)"
    }

    static func track(_ album: DemoAlbum, _ index: Int) -> Track {
        let song = album.songs[index]
        return Track(
            id: song.id, title: song.title, artists: [ArtistRef(id: artistId(album.artist), name: album.artist)],
            album: AlbumRef(id: album.id, title: album.title, key: "navidrome:\(album.id)"),
            durationMs: song.seconds * 1000, artwork: [Artwork(url: cover(album.cover, size: 600))])
    }

    static func album(_ a: DemoAlbum, songs: Bool = false) -> Album {
        Album(
            id: a.id, title: a.title, artist: a.artist, artistId: artistId(a.artist), year: a.year, genre: a.genre,
            songCount: a.songs.count, durationSec: a.songs.reduce(0) { $0 + $1.seconds }, cover: cover(a.cover),
            tracks: songs ? a.songs.indices.map { track(a, $0) } : [])
    }

    static var albums: [Album] { Demo.albums.map { album($0) } }
    static var allTracks: [Track] { Demo.albums.flatMap { a in a.songs.indices.map { track(a, $0) } } }

    static func songs(_ ids: [String]) -> [Track] {
        let all = allTracks
        return ids.compactMap { id in all.first { $0.id == id } }
    }

    static func albums(_ ids: [String]) -> [Album] {
        let all = albums
        return ids.compactMap { id in all.first { $0.id == id } }
    }

    static var artistList: [Artist] {
        var seen: [Artist] = []
        for a in Demo.albums where !seen.contains(where: { $0.name == a.artist }) {
            seen.append(Artist(
                id: artistId(a.artist), name: a.artist, image: cover(a.cover),
                albumCount: Demo.albums.filter { $0.artist == a.artist }.count))
        }
        return seen
    }

    /// Lines written for the preview.
    static let bios: [String: String] = [
        "ar-lowfield": "Lowfield make slow, lamp-lit records in a small room by the sea: a tape machine, two guitars and whatever the harbour sounds like that night.",
        "ar-mira-sole": "Mira Sole builds bright electronic pop out of prisms, heat haze and a drum machine she has had since school.",
    ]

    static let playlistSongs: [String: [String]] = [
        "late-ferries": ["harbour-0", "harbour-4", "paper-1", "glass-2", "signal-0", "exposure-1", "harbour-5"],
        "rain-on-glass": ["glass-0", "glass-3", "exposure-0", "paper-3", "signal-2"],
    ]

    static var playlistList: [Playlist] {
        [("late-ferries", "Late Ferries", DemoCover.harbour), ("rain-on-glass", "Rain on Glass", DemoCover.glass)].map {
            id, name, art in
            let entries = songs(playlistSongs[id] ?? [])
            return Playlist(
                id: id, name: name, tracks: entries.count, cover: cover(art), owner: "ada",
                durationSec: entries.reduce(0) { $0 + $1.seconds })
        }
    }

    static let likedSongs = ["harbour-0", "harbour-3", "paper-1", "glass-2", "glass-1", "signal-0", "exposure-2", "paper-0"]

    static var mixList: [Mix] {
        [
            Mix(id: "daily-1", kind: "daily", title: "Daily Mix 1", subtitle: "Lowfield, Mira Sole and more",
                tracks: songs(["harbour-0", "glass-1", "harbour-2", "glass-3", "harbour-4", "signal-1"])),
            Mix(id: "daily-2", kind: "daily", title: "Daily Mix 2", subtitle: "The Quiet Hours, Field Ensemble and more",
                tracks: songs(["paper-0", "exposure-1", "paper-2", "exposure-2", "paper-3"])),
            Mix(id: "discover", kind: "discover", title: "Discover Weekly",
                subtitle: "Your weekly mix of music you haven’t played yet",
                tracks: songs(["signal-0", "exposure-0", "signal-2", "paper-1", "glass-0"])),
            Mix(id: "onRepeat", kind: "onRepeat", title: "On Repeat", subtitle: "The songs you can’t stop playing",
                tracks: songs(["harbour-0", "harbour-3", "glass-2", "paper-1"])),
        ]
    }

    static var wantedList: [WantedItem] {
        let now = Date()
        return [
            WantedItem(id: 3, text: "Ada Varga – Live at the Signal Box", addedBy: "sam", addedAt: now.addingTimeInterval(-2 * 86_400)),
            WantedItem(
                id: 2, text: "Mira Sole Glass Weather", addedBy: "ada", addedAt: now.addingTimeInterval(-5 * 86_400),
                found: WantedItem.Found(kind: "album", id: "glass", title: "Glass Weather", artist: "Mira Sole")),
            WantedItem(id: 1, text: "The Quiet Hours – Night Shift", addedBy: "ada", addedAt: now.addingTimeInterval(-21 * 86_400)),
        ]
    }

    // MARK: - LibrarySource

    private func check() throws {
        if failing { throw ApiError.unreachable }
    }

    private static func page(_ list: [Album], _ size: Int, _ offset: Int) -> [Album] {
        guard offset < list.count else { return [] }
        return Array(list.dropFirst(offset).prefix(size))
    }

    func albumList(_ list: AlbumList, size: Int, offset: Int) async throws -> [Album] {
        try check()
        let all = Self.albums
        let ordered: [Album]
        switch list {
        case .newest: ordered = all.reversed()
        case .alphabetical: ordered = all.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        case .byYear: ordered = all.sorted { ($0.year ?? 0) > ($1.year ?? 0) }
        case .frequent: ordered = Self.albums(["harbour", "glass", "paper", "signal", "exposure"])
        case .recent: ordered = all
        case .random: ordered = Self.albums(["glass", "exposure", "harbour", "signal", "paper"])
        case .starred: ordered = Self.albums(["harbour"])
        case .genre(let name): ordered = all.filter { $0.genre == name }
        }
        return Self.page(ordered, size, offset)
    }

    func album(id: String) async throws -> Album? {
        try check()
        return Demo.albums.first { $0.id == id }.map { Self.album($0, songs: true) }
    }

    func artists() async throws -> [Artist] {
        try check()
        return Self.artistList
    }

    func artist(id: String) async throws -> ArtistPage? {
        try check()
        guard let artist = Self.artistList.first(where: { $0.id == id }) else { return nil }
        return ArtistPage(id: id, name: artist.name, albums: Self.albums.filter { $0.artistId == id })
    }

    func artistInfo(id: String, similar: Int) async throws -> ArtistInfo {
        try check()
        let artist = Self.artistList.first { $0.id == id }
        return ArtistInfo(
            bio: Self.bios[id], image: artist?.image,
            similar: Array(Self.artistList.filter { $0.id != id }.prefix(similar)))
    }

    func topSongs(artist: String, count: Int) async throws -> [Track] {
        try check()
        return Array(Self.allTracks.filter { $0.artist == artist }.prefix(count))
    }

    func playlists() async throws -> [Playlist] {
        try check()
        return Self.playlistList
    }

    func playlist(id: String) async throws -> PlaylistDetail? {
        try check()
        guard let playlist = Self.playlistList.first(where: { $0.id == id }) else { return nil }
        let entries = Self.songs(Self.playlistSongs[id] ?? [])
        var covers: [String] = []
        for cover in entries.compactMap(\.cover) where !covers.contains(cover) { covers.append(cover) }
        return PlaylistDetail(
            playlist: playlist, comment: id == "late-ferries" ? "For the last boat home." : nil,
            covers: Array(covers.prefix(4)), entries: entries)
    }

    func starred() async throws -> Starred {
        try check()
        return Starred(
            tracks: Self.songs(Self.likedSongs), albums: Self.albums(["harbour"]),
            artists: Array(Self.artistList.prefix(1)))
    }

    func search(_ query: String, artists: Int, albums: Int, songs: Int) async throws -> SearchResult {
        try check()
        let q = query.lowercased()
        func has(_ s: String) -> Bool { s.lowercased().contains(q) }
        return SearchResult(
            tracks: Array(Self.allTracks.filter { has($0.title) || has($0.artist) || has($0.album.title) }.prefix(songs)),
            albums: Array(Self.albums.filter { has($0.title) || has($0.artist) }.prefix(albums)),
            artists: Array(Self.artistList.filter { has($0.name) }.prefix(artists)))
    }

    func setStar(_ kind: StarKind, id: String, on: Bool) async throws {
        try check()
    }

    func mixes(utcOffsetMinutes: Int) async throws -> [Mix] {
        try check()
        return Self.mixList
    }

    func wanted() async throws -> [WantedItem] {
        try check()
        return Self.wantedList
    }

    func addWanted(_ text: String) async throws -> WantedItem {
        try check()
        return WantedItem(id: Int(Date().timeIntervalSince1970), text: text, addedBy: "ada", addedAt: Date())
    }

    func removeWanted(id: Int) async throws {
        try check()
    }

    func karaokeSongs(limit: Int) async throws -> [Track] {
        try check()
        return Self.songs(["harbour-0", "glass-1", "paper-0", "signal-1"])
    }

    func coverBytes(_ path: String) async throws -> Data {
        try check()
        guard path.hasPrefix("demo:"), let name = path.dropFirst(5).split(separator: "?").first,
              let cover = DemoCover(rawValue: String(name))
        else { throw ApiError.notFound }
        guard let data = await Self.png(cover) else { throw ApiError.badResponse }
        return data
    }

    /// A drawn cover as a PNG, as ECHO would send one.
    @MainActor static func png(_ cover: DemoCover) -> Data? {
        let renderer = ImageRenderer(content: CoverArt(cover: cover, corner: 0).frame(width: 300, height: 300))
        renderer.scale = 2
        guard let image = renderer.cgImage else { return nil }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, "public.png" as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    // MARK: - The demo screens

    /// A library on the built-in albums, its covers in memory only.
    @MainActor static func library(failing: Bool = false) -> Library {
        let source = DemoLibrary(failing: failing)
        return Library(source: source, images: ImageLoader(fetch: { try await source.coverBytes($0) }), defaults: nil)
    }

    /// Where `-ECHODemo <screen>` opens the app.
    /// The group a settings screen opens scrolled to.
    static func settingsScroll(_ screen: String) -> String? {
        switch screen {
        case "settings-playback": SettingsAnchor.playback
        case "settings-lyrics": SettingsAnchor.lyrics
        default: nil
        }
    }

    static func start(_ screen: String) -> ShellStart {
        let harbour = album(Demo.harbour)
        switch screen {
        case "album":
            #if os(macOS)
            return ShellStart(page: .albums, path: [.album(harbour)])
            #else
            return ShellStart(page: .home, path: [.album(harbour)])
            #endif
        case "artist": return ShellStart(page: .home, path: [.artist(id: artistId("Lowfield"), name: "Lowfield")])
        case "playlist":
            return ShellStart(page: .playlists, path: playlistList.first.map { [Route.playlist($0)] } ?? [])
        case "library": return ShellStart(page: .playlists)
        case "albums": return ShellStart(page: .albums)
        case "artists": return ShellStart(page: .artists)
        case "liked": return ShellStart(page: .liked)
        case "wanted": return ShellStart(page: .wanted)
        case "search": return ShellStart(page: .search("harbour"))
        case "shelves": return ShellStart(page: .home, shelf: "made")
        case "mix": return ShellStart(page: .home, path: mixList.first.map { [Route.mix($0)] } ?? [])
        case "nowplaying": return ShellStart(page: .home, playing: .song)
        case "queue": return ShellStart(page: .home, playing: .queue)
        case "player": return ShellStart(page: .albums)
        case "guests":
            #if os(macOS)
            return ShellStart(page: .albums) // Guests opens in the Settings window
            #else
            return ShellStart(page: .home, path: [.settings, .guests])
            #endif
        case "settings", "settings-playback", "settings-lyrics", "lockcover":
            #if os(macOS)
            return ShellStart(page: .albums) // Settings opens in its own window
            #else
            return ShellStart(page: .home, path: [.settings])
            #endif
        case "lyrics", "lyrics-interlude", "lyrics-plain", "lyrics-menu":
            #if os(macOS)
            return ShellStart(page: .albums, playing: .lyrics)
            #else
            return ShellStart(page: .home, playing: .lyrics)
            #endif
        default: return ShellStart()
        }
    }
}
