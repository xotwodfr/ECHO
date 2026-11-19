import Foundation

// The user's Navidrome through ECHO's allow-listed Subsonic proxy (`/navidrome/rest/<method>`,
// src/server/navidrome/routes.ts), mapped into the library's models as the web does
// (src/client/library-navidrome.ts) and Android (library/Library.kt). Navidrome refuses a request
// with HTTP 200 and `status: "failed"`: that is ApiError.subsonic here, never an empty answer, and
// "not found" (70) is nil where a missing thing is an answer.

// MARK: - The calls

extension EchoClient {
    /// A Subsonic method through the proxy: reads as GET, writes (star, scrobble, playlists) as POST.
    func subsonic<Body: Decodable>(
        _ method: String, _ query: [(String, String)] = [], as type: Body.Type, write: Bool = false
    ) async throws -> Body {
        let raw = try await data(
            write ? "POST" : "GET", "/navidrome/rest/\(method)", query: query, body: write ? Data("{}".utf8) : nil)
        let status = try Self.decode(Envelope<SubStatus>.self, from: raw).body
        if status.status == "failed" {
            throw ApiError.subsonic(code: status.error?.code ?? 0, message: status.error?.message)
        }
        return try Self.decode(Envelope<Body>.self, from: raw).body
    }

    /// Nil when Navidrome says there is no such thing (70); every other refusal is an error.
    private func found<T>(_ call: () async throws -> T?) async throws -> T? {
        do {
            return try await call()
        } catch ApiError.subsonic(70, _) {
            return nil
        }
    }

    /// One page of an album list (500 at most, as Navidrome allows).
    func albumList(_ list: AlbumList, size: Int = 500, offset: Int = 0) async throws -> [Album] {
        let body = try await subsonic(
            "getAlbumList2", list.query + [("size", String(size)), ("offset", String(offset))], as: AlbumListBody.self)
        return (body.albumList2?.album?.items ?? []).map(Subsonic.album)
    }

    /// An album with its songs.
    func album(id: String) async throws -> Album? {
        try await found { () async throws -> Album? in
            try await subsonic("getAlbum", [("id", id)], as: AlbumBody.self).album.map(Subsonic.album)
        }
    }

    /// The server's whole artist list, in its order (`getArtists`' letter index, flattened).
    func artists() async throws -> [Artist] {
        let body = try await subsonic("getArtists", as: ArtistsBody.self)
        return (body.artists?.index?.items ?? []).flatMap { $0.artist?.items ?? [] }.map(Subsonic.artist)
    }

    func artist(id: String) async throws -> ArtistPage? {
        try await found { () async throws -> ArtistPage? in
            guard let a = try await subsonic("getArtist", [("id", id)], as: ArtistBody.self).artist else { return nil }
            return ArtistPage(id: a.id, name: a.name, albums: (a.album?.items ?? []).map(Subsonic.album))
        }
    }

    func artistInfo(id: String, similar: Int = 12) async throws -> ArtistInfo {
        let info = try await subsonic(
            "getArtistInfo2", [("id", id), ("count", String(similar))], as: ArtistInfoBody.self
        ).artistInfo2
        let bio = info?.biography.map(Subsonic.plain) ?? ""
        return ArtistInfo(
            bio: bio.isEmpty ? nil : bio,
            image: Subsonic.cover("ar-\(id)", size: 600),
            similar: (info?.similarArtist?.items ?? []).filter { !$0.id.isEmpty }.map(Subsonic.artist))
    }

    func playlists() async throws -> [Playlist] {
        let body = try await subsonic("getPlaylists", as: PlaylistsBody.self)
        return (body.playlists?.playlist?.items ?? []).map(Subsonic.playlist)
    }

    func playlist(id: String) async throws -> PlaylistDetail? {
        try await found { () async throws -> PlaylistDetail? in
            guard let p = try await subsonic("getPlaylist", [("id", id)], as: PlaylistBody.self).playlist else {
                return nil
            }
            let entries = Subsonic.songs(p.entry?.items)
            var covers: [String] = []
            for cover in entries.compactMap(\.cover) where !covers.contains(cover) { covers.append(cover) }
            return PlaylistDetail(
                playlist: Subsonic.playlist(p), comment: (p.comment?.isEmpty ?? true) ? nil : p.comment,
                covers: Array(covers.prefix(4)), entries: entries)
        }
    }

    /// Everything the user hearted.
    func starred() async throws -> Starred {
        let s = try await subsonic("getStarred2", as: StarredBody.self).starred2
        return Starred(
            tracks: Subsonic.songs(s?.song?.items),
            albums: (s?.album?.items ?? []).map(Subsonic.album),
            artists: (s?.artist?.items ?? []).map(Subsonic.artist))
    }

    /// Navidrome's search (`search3`), as the web asks it: a few of each.
    func search(_ query: String, artists: Int = 6, albums: Int = 6, songs: Int = 6) async throws -> SearchResult {
        let r = try await subsonic(
            "search3",
            [("query", query), ("artistCount", String(artists)), ("albumCount", String(albums)),
             ("songCount", String(songs))],
            as: SearchBody.self
        ).searchResult3
        return SearchResult(
            tracks: Subsonic.songs(r?.song?.items),
            albums: (r?.album?.items ?? []).map(Subsonic.album),
            artists: (r?.artist?.items ?? []).map(Subsonic.artist))
    }

    func song(id: String) async throws -> Track? {
        try await found { () async throws -> Track? in
            try await subsonic("getSong", [("id", id)], as: SongBody.self).song.map { Subsonic.songs([$0])[0] }
        }
    }

    func topSongs(artist: String, count: Int = 10) async throws -> [Track] {
        let body = try await subsonic(
            "getTopSongs", [("artist", artist), ("count", String(count))], as: TopSongsBody.self)
        return Subsonic.songs(body.topSongs?.song?.items)
    }

    func randomSongs(count: Int = 20) async throws -> [Track] {
        let body = try await subsonic("getRandomSongs", [("size", String(count))], as: RandomSongsBody.self)
        return Subsonic.songs(body.randomSongs?.song?.items)
    }

    func similarSongs(id: String, count: Int = 20) async throws -> [Track] {
        let body = try await subsonic(
            "getSimilarSongs2", [("id", id), ("count", String(count))], as: SimilarSongsBody.self)
        return Subsonic.songs(body.similarSongs2?.song?.items)
    }

    /// The genres that have albums, the biggest first.
    func genres() async throws -> [Genre] {
        let list = try await subsonic("getGenres", as: GenresBody.self).genres?.genre?.items ?? []
        return list
            .map { Genre(name: $0.value, albums: $0.albumCount ?? 0, songs: $0.songCount ?? 0) }
            .filter { !$0.name.isEmpty && $0.albums > 0 }
            .sorted { $0.albums > $1.albums }
    }

    /// A heart on or off.
    func setStar(_ kind: StarKind, id: String, on: Bool) async throws {
        _ = try await subsonic(on ? "star" : "unstar", [(kind.parameter, id)], as: SubStatus.self, write: true)
    }

    /// Tells Navidrome a song is playing (`submission` false) or was played.
    func scrobble(id: String, submission: Bool) async throws {
        _ = try await subsonic(
            "scrobble", [("id", id), ("submission", submission ? "true" : "false")], as: SubStatus.self, write: true)
    }
}

// MARK: - Mapping into the models

enum Subsonic {
    /// A cover's server path: through ECHO, which signs it with the user's Navidrome.
    static func cover(_ id: String?, size: Int = 300) -> String? {
        guard let id, !id.isEmpty else { return nil }
        return "/api/v1/navidrome/cover/\(EchoClient.encode(id))?size=\(size)"
    }

    /// A song of an album: its own fields first, the album's where it has none.
    static func track(_ s: SubSong, albumId: String?, albumTitle: String?, albumArtist: String?, albumCover: String?) -> Track {
        let art = cover(s.coverArt ?? albumCover, size: 600)
        let id = albumId ?? s.albumId
        return Track(
            id: s.id,
            title: s.title,
            artists: [ArtistRef(id: s.artistId, name: s.artist ?? albumArtist ?? "")],
            album: AlbumRef(id: id, title: s.album ?? albumTitle ?? "", key: "navidrome:\(id ?? "")"),
            durationMs: (s.duration ?? 0) * 1000,
            artwork: art.map { [Artwork(url: $0)] } ?? [],
            isrc: s.isrc,
            replayGain: s.replayGain,
            contentType: s.contentType,
            suffix: s.suffix?.lowercased())
    }

    /// Songs on their own (a playlist, search, Liked), each with its album from its own fields.
    static func songs(_ list: [SubSong]?) -> [Track] {
        (list ?? []).map { track($0, albumId: nil, albumTitle: nil, albumArtist: nil, albumCover: nil) }
    }

    static func album(_ a: SubAlbum) -> Album {
        Album(
            id: a.id, title: a.name, artist: a.artist ?? "", artistId: a.artistId, year: a.year, genre: a.genre,
            songCount: a.songCount, durationSec: a.duration, cover: cover(a.coverArt),
            tracks: (a.song?.items ?? []).map {
                track($0, albumId: a.id, albumTitle: a.name, albumArtist: a.artist, albumCover: a.coverArt)
            })
    }

    static func artist(_ a: SubArtist) -> Artist {
        Artist(id: a.id, name: a.name, image: cover(a.coverArt ?? "ar-\(a.id)"), albumCount: a.albumCount)
    }

    static func playlist(_ p: SubPlaylist) -> Playlist {
        Playlist(
            id: p.id, name: p.name, tracks: p.songCount ?? 0, cover: cover(p.coverArt), owner: p.owner,
            durationSec: p.duration)
    }

    /// The text of an HTML snippet (Last.fm's biographies end in a "Read more" link).
    static func plain(_ html: String) -> String {
        var s = html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (entity, char) in [("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"), ("&lt;", "<"), ("&gt;", ">"),
                               ("&nbsp;", " "), ("&amp;", "&")] {
            s = s.replacingOccurrences(of: entity, with: char)
        }
        s = s.replacingOccurrences(
            of: "\\s*Read more on Last\\.fm\\.?\\s*$", with: "", options: [.regularExpression, .caseInsensitive])
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - What Navidrome sends

/// `{ "subsonic-response": … }`, the proxy's answer.
struct Envelope<Body: Decodable>: Decodable {
    let body: Body
    enum CodingKeys: String, CodingKey { case body = "subsonic-response" }
}

struct SubStatus: Decodable {
    let status: String?
    let error: Failure?
    struct Failure: Decodable {
        let code: Int?
        let message: String?
    }
}

struct SubSong: Decodable, Sendable {
    let id: String
    let title: String
    let artist: String?
    let artistId: String?
    let album: String?
    let albumId: String?
    let coverArt: String?
    let duration: Int?
    let track: Int?
    let discNumber: Int?
    let year: Int?
    let genre: String?
    let suffix: String?
    let contentType: String?
    /// One code, though OpenSubsonic sends a list.
    let isrc: String?
    let replayGain: ReplayGain?

    enum CodingKeys: String, CodingKey {
        case id, title, artist, artistId, album, albumId, coverArt, duration, track, discNumber, year, genre,
             suffix, contentType, isrc, replayGain
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.text(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "a song without an id")
        }
        self.id = id
        title = c.text(.title) ?? ""
        artist = c.text(.artist)
        artistId = c.text(.artistId)
        album = c.text(.album)
        albumId = c.text(.albumId)
        coverArt = c.text(.coverArt)
        duration = c.number(.duration)
        track = c.number(.track)
        discNumber = c.number(.discNumber)
        year = c.number(.year)
        genre = c.text(.genre)
        suffix = c.text(.suffix)
        contentType = c.text(.contentType)
        isrc = ((try? c.decodeIfPresent([String].self, forKey: .isrc)) ?? nil)?.first ?? c.text(.isrc)
        replayGain = (try? c.decodeIfPresent(ReplayGain.self, forKey: .replayGain)) ?? nil
    }
}

struct SubAlbum: Decodable, Sendable {
    let id: String
    let name: String
    let artist: String?
    let artistId: String?
    let coverArt: String?
    let songCount: Int?
    let duration: Int?
    let year: Int?
    let genre: String?
    let song: LossyList<SubSong>?

    enum CodingKeys: String, CodingKey {
        case id, name, title, artist, artistId, coverArt, songCount, duration, year, genre, song
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.text(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "an album without an id")
        }
        self.id = id
        name = c.text(.name) ?? c.text(.title) ?? ""
        artist = c.text(.artist)
        artistId = c.text(.artistId)
        coverArt = c.text(.coverArt)
        songCount = c.number(.songCount)
        duration = c.number(.duration)
        year = c.number(.year)
        genre = c.text(.genre)
        song = (try? c.decodeIfPresent(LossyList<SubSong>.self, forKey: .song)) ?? nil
    }
}

struct SubArtist: Decodable, Sendable {
    let id: String
    let name: String
    let coverArt: String?
    let albumCount: Int?
    let album: LossyList<SubAlbum>?

    enum CodingKeys: String, CodingKey { case id, name, coverArt, albumCount, album }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.text(.id) else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "an artist without an id")
        }
        self.id = id
        name = c.text(.name) ?? ""
        coverArt = c.text(.coverArt)
        albumCount = c.number(.albumCount)
        album = (try? c.decodeIfPresent(LossyList<SubAlbum>.self, forKey: .album)) ?? nil
    }
}

struct SubPlaylist: Decodable, Sendable {
    let id: String
    let name: String
    let comment: String?
    let owner: String?
    let songCount: Int?
    let duration: Int?
    let coverArt: String?
    let entry: LossyList<SubSong>?

    enum CodingKeys: String, CodingKey { case id, name, comment, owner, songCount, duration, coverArt, entry }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.text(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "a playlist without an id")
        }
        self.id = id
        name = c.text(.name) ?? ""
        comment = c.text(.comment)
        owner = c.text(.owner)
        songCount = c.number(.songCount)
        duration = c.number(.duration)
        coverArt = c.text(.coverArt)
        entry = (try? c.decodeIfPresent(LossyList<SubSong>.self, forKey: .entry)) ?? nil
    }
}

struct SubGenre: Decodable, Sendable {
    let value: String
    let albumCount: Int?
    let songCount: Int?
}

struct SongList: Decodable { let song: LossyList<SubSong>? }
struct AlbumListBody: Decodable {
    let albumList2: Albums?
    struct Albums: Decodable { let album: LossyList<SubAlbum>? }
}
struct AlbumBody: Decodable { let album: SubAlbum? }
struct ArtistsBody: Decodable {
    let artists: Index?
    struct Index: Decodable { let index: LossyList<Letter>? }
    struct Letter: Decodable { let artist: LossyList<SubArtist>? }
}
struct ArtistBody: Decodable { let artist: SubArtist? }
struct ArtistInfoBody: Decodable {
    let artistInfo2: Info?
    struct Info: Decodable {
        let biography: String?
        let similarArtist: LossyList<SubArtist>?
    }
}
struct PlaylistsBody: Decodable {
    let playlists: Lists?
    struct Lists: Decodable { let playlist: LossyList<SubPlaylist>? }
}
struct PlaylistBody: Decodable { let playlist: SubPlaylist? }
struct StarredBody: Decodable { let starred2: Mixed? }
struct SearchBody: Decodable { let searchResult3: Mixed? }
struct Mixed: Decodable {
    let song: LossyList<SubSong>?
    let album: LossyList<SubAlbum>?
    let artist: LossyList<SubArtist>?
}
struct SongBody: Decodable { let song: SubSong? }
struct TopSongsBody: Decodable { let topSongs: SongList? }
struct RandomSongsBody: Decodable { let randomSongs: SongList? }
struct SimilarSongsBody: Decodable { let similarSongs2: SongList? }
struct GenresBody: Decodable {
    let genres: Genres?
    struct Genres: Decodable { let genre: LossyList<SubGenre>? }
}

/// A list whose unreadable items are left out rather than failing the whole answer.
struct LossyList<Element: Decodable>: Decodable {
    var items: [Element]

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var items: [Element] = []
        while !c.isAtEnd {
            if let item = try? c.decode(Element.self) {
                items.append(item)
            } else {
                _ = try? c.decode(Skip.self) // a failed decode does not move on; this does
            }
        }
        self.items = items
    }

    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }
}

extension LossyList: Sendable where Element: Sendable {}

extension KeyedDecodingContainer {
    /// A string, or a number written as one (Subsonic servers differ on ids).
    func text(_ key: Key) -> String? {
        if let s = (try? decodeIfPresent(String.self, forKey: key)) ?? nil { return s }
        if let i = (try? decodeIfPresent(Int.self, forKey: key)) ?? nil { return String(i) }
        return nil
    }

    /// A whole number, or one written as a string or with a fraction.
    func number(_ key: Key) -> Int? {
        if let i = (try? decodeIfPresent(Int.self, forKey: key)) ?? nil { return i }
        if let d = (try? decodeIfPresent(Double.self, forKey: key)) ?? nil, d.isFinite { return Int(d) }
        if let s = (try? decodeIfPresent(String.self, forKey: key)) ?? nil { return Int(s) }
        return nil
    }
}
