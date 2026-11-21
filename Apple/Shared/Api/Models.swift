import Foundation

// The library as the web and Android apps model it (src/shared/types.ts, src/client/library.ts,
// Android's api/Models.kt). Artwork and covers are server paths ("/api/v1/navidrome/cover/…"), as
// the web keeps them, so a queue saved on one device plays on another (`/me/queue`, task 3);
// EchoClient.url(_:) makes them whole.

struct ArtistRef: Codable, Hashable, Sendable {
    var id: String?
    var name: String
}

struct AlbumRef: Codable, Hashable, Sendable {
    var id: String?
    var title: String
    /// `navidrome:<album id>`: the palette's and the motion cover's key.
    var key: String
}

struct Artwork: Codable, Hashable, Sendable {
    var url: String
    var width: Int?
    var height: Int?
}

struct ReplayGain: Codable, Hashable, Sendable {
    var trackGain: Double?
    var albumGain: Double?
    var trackPeak: Double?
    var albumPeak: Double?
}

/// A song, in the shape every ECHO client saves and shares (`Track` in src/shared/types.ts).
struct Track: Codable, Hashable, Identifiable, Sendable {
    /// `<provider>:<id>`.
    var key: String
    var provider: String
    var id: String
    var title: String
    var artists: [ArtistRef]
    var album: AlbumRef
    var durationMs: Int
    var artwork: [Artwork]
    var isrc: String?
    var replayGain: ReplayGain?
    /// The file as Navidrome stores it ("audio/flac"; "flac"): whether AVPlayer plays it as it is.
    var contentType: String?
    var suffix: String?

    init(
        id: String, title: String, artists: [ArtistRef], album: AlbumRef, durationMs: Int,
        artwork: [Artwork] = [], isrc: String? = nil, replayGain: ReplayGain? = nil,
        contentType: String? = nil, suffix: String? = nil, provider: String = "navidrome"
    ) {
        self.key = "\(provider):\(id)"
        self.provider = provider
        self.id = id
        self.title = title
        self.artists = artists
        self.album = album
        self.durationMs = durationMs
        self.artwork = artwork
        self.isrc = isrc
        self.replayGain = replayGain
        self.contentType = contentType
        self.suffix = suffix
    }

    /// A track as another client saved it: the fields it may leave out take their defaults.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        provider = (try? c.decodeIfPresent(String.self, forKey: .provider)) ?? "navidrome"
        key = (try? c.decodeIfPresent(String.self, forKey: .key)) ?? "\(provider):\(id)"
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        artists = (try? c.decodeIfPresent([ArtistRef].self, forKey: .artists)) ?? []
        album = (try? c.decodeIfPresent(AlbumRef.self, forKey: .album))
            ?? AlbumRef(id: nil, title: "", key: "\(provider):")
        durationMs = (try? c.decodeIfPresent(Int.self, forKey: .durationMs)) ?? 0
        artwork = (try? c.decodeIfPresent([Artwork].self, forKey: .artwork)) ?? []
        isrc = try? c.decodeIfPresent(String.self, forKey: .isrc)
        replayGain = try? c.decodeIfPresent(ReplayGain.self, forKey: .replayGain)
        contentType = try? c.decodeIfPresent(String.self, forKey: .contentType)
        suffix = try? c.decodeIfPresent(String.self, forKey: .suffix)
    }

    /// The artists as one line ("A, B").
    var artist: String { artists.map(\.name).joined(separator: ", ") }
    /// The cover's server path, if there is one.
    var cover: String? { artwork.first?.url }
    var seconds: Int { durationMs / 1000 }
}

struct Album: Identifiable, Hashable, Sendable {
    var id: String
    var title: String
    var artist: String
    var artistId: String?
    var year: Int?
    var genre: String?
    var songCount: Int?
    var durationSec: Int?
    /// The cover's server path (300 px).
    var cover: String?
    /// The songs, once the album was opened (`getAlbum`); a list's albums have none.
    var tracks: [Track] = []

    var key: String { "navidrome:\(id)" }
}

/// An artist with a picture: the library's list, search, similar artists, Liked.
struct Artist: Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var image: String?
    var albumCount: Int?
}

struct ArtistPage: Hashable, Sendable {
    var id: String
    var name: String
    var albums: [Album]
}

struct ArtistInfo: Hashable, Sendable {
    /// Last.fm's biography as text, without its "Read more" link.
    var bio: String?
    var image: String?
    var similar: [Artist]
}

struct Playlist: Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    /// How many songs it holds.
    var tracks: Int
    var cover: String?
    var owner: String?
    var durationSec: Int?
}

struct PlaylistDetail: Hashable, Sendable {
    var playlist: Playlist
    var comment: String?
    /// Up to four different covers of its songs, for a mosaic.
    var covers: [String]
    var entries: [Track]

    var durationMs: Int { entries.reduce(0) { $0 + $1.durationMs } }
}

/// What the user hearted (`getStarred2`).
struct Starred: Hashable, Sendable {
    var tracks: [Track] = []
    var albums: [Album] = []
    var artists: [Artist] = []
}

struct SearchResult: Hashable, Sendable {
    var tracks: [Track] = []
    var albums: [Album] = []
    var artists: [Artist] = []

    var isEmpty: Bool { tracks.isEmpty && albums.isEmpty && artists.isEmpty }
}

struct Genre: Hashable, Sendable {
    var name: String
    var albums: Int
    var songs: Int
}

/// Who is signed in (`GET /me`).
struct Account: Codable, Equatable, Sendable {
    var username: String
    var role: String

    var isAdmin: Bool { role == "admin" }
}

/// A stream URL AVPlayer opens without a header: signed for this song and user, for 6 hours.
struct SignedStream: Equatable, Sendable {
    var url: URL
    var expiresAt: Date
}

/// What a heart is on (Subsonic's star and unstar take each as its own parameter).
enum StarKind: Sendable {
    case track, album, artist

    var parameter: String {
        switch self {
        case .track: "id"
        case .album: "albumId"
        case .artist: "artistId"
        }
    }
}

/// An album list (`getAlbumList2`): Home's shelves and the Library's sorts.
enum AlbumList: Hashable, Sendable {
    case newest, alphabetical, byYear, frequent, recent, random, starred
    case genre(String)

    var query: [(String, String)] {
        switch self {
        case .newest: [("type", "newest")]
        case .alphabetical: [("type", "alphabeticalByName")]
        // The year sort needs its range: newest first, albums without a year last.
        case .byYear: [("type", "byYear"), ("fromYear", "9999"), ("toYear", "0")]
        case .frequent: [("type", "frequent")]
        case .recent: [("type", "recent")]
        case .random: [("type", "random")]
        case .starred: [("type", "starred")]
        case .genre(let name): [("type", "byGenre"), ("genre", name)]
        }
    }
}

/// The Library's four album sorts, as on the web and Android.
enum AlbumSort: String, CaseIterable, Identifiable, Sendable {
    case newest, alphabetical, year, mostPlayed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .newest: "Recently added"
        case .alphabetical: "A–Z"
        case .year: "Year"
        case .mostPlayed: "Most played"
        }
    }

    var list: AlbumList {
        switch self {
        case .newest: .newest
        case .alphabetical: .alphabetical
        case .year: .byYear
        case .mostPlayed: .frequent
        }
    }
}

/// Where a queue was started from (`PlayContext` in src/shared/types.ts): an album, a playlist, an
/// artist, a search, Liked Songs, a mix, the Karaoke shelf.
struct PlayContext: Codable, Hashable, Sendable {
    var kind: String
    var id: String?
    var title: String
}

/// One of the Made For You mixes the server makes from the user's plays (`GET /me/mixes`): Daily
/// Mixes, Discover Weekly, On Repeat, Repeat Rewind and the daylist.
struct Mix: Identifiable, Hashable, Sendable {
    var id: String
    /// daily, discover, onRepeat, rewind or daylist.
    var kind: String
    var title: String
    var subtitle: String
    var tracks: [Track]

    /// The first of its songs' covers.
    var cover: String? { tracks.lazy.compactMap(\.cover).first }
}

/// An item on the Wanted list (`/wanted`): one list for everyone on the server, of music that is not
/// in Navidrome yet; ECHO marks it found once an album, else a song, has all of its words.
struct WantedItem: Identifiable, Hashable, Sendable {
    var id: Int
    var text: String
    /// The username; nil once that user is deleted.
    var addedBy: String?
    var addedAt: Date
    var found: Found?

    struct Found: Hashable, Sendable {
        /// "album" or "song".
        var kind: String
        var id: String
        var title: String
        var artist: String
        /// A song's album.
        var albumId: String?

        /// The album that has it: the album itself, or the song's.
        var album: String? { kind == "album" ? id : albumId }
    }
}
