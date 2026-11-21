import Foundation

// Listen together as the server tells it (src/server/together.ts, docs/TOGETHER.md, docs/api/openapi.yaml):
// the session every answer carries, the songs in its queue, who is in it, the host's controls, and
// what the event stream says. Plain values, so the tests read them from the recorded answers.

struct TogetherPerson: Codable, Equatable, Hashable, Sendable {
    var id: Int
    var username: String
}

/// Words more than one place says.
enum TogetherText {
    static let hostOnly = "Only the host controls playback."
}

/// A song as the server keeps it in a session (`TrackRef`): what a member needs to play it through
/// its own ECHO session. Only songs from the library can be shared.
struct TrackRef: Codable, Equatable, Hashable, Sendable {
    var id: String
    var title: String
    var artist: String
    var artistId: String?
    var album: String
    var albumId: String?
    var durationMs: Int
    var cover: String?

    init(
        id: String, title: String, artist: String, artistId: String? = nil, album: String = "", albumId: String? = nil,
        durationMs: Int = 0, cover: String? = nil
    ) {
        self.id = id
        self.title = title
        self.artist = artist
        self.artistId = artistId
        self.album = album
        self.albumId = albumId
        self.durationMs = durationMs
        self.cover = cover
    }

    /// What this app shares of a song it plays.
    init(_ track: Track) {
        self.init(
            id: track.id, title: track.title, artist: track.artist, artistId: track.artists.first?.id,
            album: track.album.title, albumId: track.album.id, durationMs: track.durationMs, cover: track.cover)
    }

    /// The song as this app plays it.
    var track: Track {
        Track(
            id: id, title: title, artists: artist.isEmpty ? [] : [ArtistRef(id: artistId, name: artist)],
            album: AlbumRef(id: albumId, title: album, key: "navidrome:\(albumId ?? "")"), durationMs: durationMs,
            artwork: cover.map { [Artwork(url: $0)] } ?? [])
    }
}

/// A song in the shared queue, and who added it.
struct TogetherItem: Codable, Equatable, Hashable, Sendable, Identifiable {
    var uid: String
    var track: TrackRef
    var addedBy: TogetherPerson

    var id: String { uid }
}

struct TogetherYou: Codable, Equatable, Sendable {
    var id: Int
    var host: Bool
    var member: Bool
}

struct TogetherMember: Codable, Equatable, Sendable, Identifiable {
    var id: Int
    var username: String
    var host: Bool
    /// Streaming events or asked within the last 30 s.
    var online: Bool
}

/// The state every answer and every `state` event carries.
struct TogetherState: Codable, Equatable, Sendable {
    var id: String
    /// What the QR code holds: `<origin>/together/<id>` (a path when the server does not know its origin).
    var url: String
    var host: TogetherPerson
    var you: TogetherYou
    var members: [TogetherMember]
    var now: TogetherItem?
    var queue: [TogetherItem]
    var playing: Bool
    /// Server time (ms) at which the song was at 0, while playing; null paused.
    var startedAt: Double?
    /// Where the song is at `serverTime`; where it stays while paused.
    var positionMs: Double
    var serverTime: Double
    var version: Int

    enum CodingKeys: String, CodingKey {
        case id, url, host, you, members, now, queue, playing, startedAt, positionMs, serverTime, version
    }

    init(
        id: String, url: String, host: TogetherPerson, you: TogetherYou, members: [TogetherMember] = [],
        now: TogetherItem? = nil, queue: [TogetherItem] = [], playing: Bool = false, startedAt: Double? = nil,
        positionMs: Double = 0, serverTime: Double, version: Int = 0
    ) {
        self.id = id
        self.url = url
        self.host = host
        self.you = you
        self.members = members
        self.now = now
        self.queue = queue
        self.playing = playing
        self.startedAt = startedAt
        self.positionMs = positionMs
        self.serverTime = serverTime
        self.version = version
    }

    /// Fields the server may leave out take their defaults; the ones that matter are required.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        url = (try? c.decodeIfPresent(String.self, forKey: .url)) ?? ""
        host = try c.decode(TogetherPerson.self, forKey: .host)
        you = try c.decode(TogetherYou.self, forKey: .you)
        members = (try? c.decodeIfPresent([TogetherMember].self, forKey: .members)) ?? []
        now = try? c.decodeIfPresent(TogetherItem.self, forKey: .now)
        queue = (try? c.decodeIfPresent([TogetherItem].self, forKey: .queue)) ?? []
        playing = (try? c.decodeIfPresent(Bool.self, forKey: .playing)) ?? false
        startedAt = try? c.decodeIfPresent(Double.self, forKey: .startedAt)
        positionMs = (try? c.decodeIfPresent(Double.self, forKey: .positionMs)) ?? 0
        serverTime = try c.decode(Double.self, forKey: .serverTime)
        version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? 0
    }

    /// The song that plays now, as this app plays it.
    var track: Track? { now?.track.track }

    /// "Together · 3", as Android's pill reads.
    var listeners: Int { members.count }

    /// Whether the person may take this song out of the queue: the host any, a member their own.
    func mayRemove(_ item: TogetherItem) -> Bool {
        you.host || item.addedBy.id == you.id
    }

    /// The link the QR code holds, whole: a path is made whole with the server's origin.
    func link(origin: URL) -> URL? {
        if url.hasPrefix("http://") || url.hasPrefix("https://") { return URL(string: url) }
        let base = origin.absoluteString.hasSuffix("/") ? String(origin.absoluteString.dropLast()) : origin.absoluteString
        return URL(string: base + (url.hasPrefix("/") ? url : "/" + url))
    }
}

/// What the host's player says to the session (`POST /together/:id/control`).
enum TogetherAction: Equatable, Sendable {
    case play
    case pause
    case seek(positionMs: Double)
    /// Skip. With `from`, only if that song is still the one playing (the host's player says its
    /// song ended: ignored when the session moved on already).
    case next(from: String?)
    case previous
    /// Play a queued song now.
    case jump(uid: String)
}

/// What the host starts a session on: the song playing, where, and what is up next.
struct TogetherSeed: Equatable, Sendable {
    var track: TrackRef?
    var positionMs: Double = 0
    var playing = false
    var queue: [TrackRef] = []
    /// The server takes up to 500; the app shares what is next up to this many.
    static let queueMax = 100
}

/// What the event stream says: `state` first and on every change, `ping` every 15 s, `end`.
enum TogetherEvent: Equatable, Sendable {
    case state(TogetherState)
    case ping(serverTime: Double, version: Int)
    case end
}

/// Why a call did not go (the server's `error` and status).
enum TogetherError: Error, Equatable, Sendable {
    /// 404: no such session (it ended, or the link is old).
    case gone
    /// 403 not_member: the person is not in the session (any more).
    case notMember
    /// 403 host_only.
    case hostOnly
    /// 409 other_library: the person's Navidrome is not the host's; the host's name.
    case otherLibrary(host: String?)
    /// 409 no_library: nothing of the person's own to share.
    case noLibrary
    /// 409 full: 50 members.
    case full
    /// 409 queue_full: 500 songs.
    case queueFull
    /// 409 nothing_to_play.
    case nothingToPlay
    /// 503 too_many_sessions: 200 on the server.
    case tooManySessions
    /// 400: a song or a position the server did not take.
    case refused(String?)
    /// 429, with the wait the server asked for (Retry-After, seconds).
    case rateLimited(retryAfter: Int)
    case api(ApiError)

    /// What to tell the person.
    var userMessage: String {
        switch self {
        case .gone: "This listening session has ended."
        case .notMember: "You are not in this listening session."
        case .hostOnly: TogetherText.hostOnly
        case .otherLibrary(let host):
            "Joining needs the same library: \(host ?? "the host")'s songs come from a Navidrome server you aren't connected to."
        case .noLibrary: "Connect your Navidrome library first."
        case .full: "This listening session is full."
        case .queueFull: "The shared queue is full."
        case .nothingToPlay: "Nothing to play yet."
        case .tooManySessions: "This server has too many listening sessions right now. Try again later."
        case .refused: "That didn't work. Try again."
        case .rateLimited(let s): "Too many requests. Try again in \(s < 60 ? "\(s) s" : "a minute")."
        case .api(let e): e.userMessage
        }
    }

    /// The session is over for this person: stop following it.
    var endsSession: Bool { self == .gone || self == .notMember }

    /// From the server's answer to a call that was refused.
    init(status: Int, body: Data, retryAfter: String?) {
        let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        let code = object?["error"] as? String
        switch (status, code) {
        case (404, _): self = .gone
        case (403, "not_member"): self = .notMember
        case (403, "host_only"): self = .hostOnly
        case (409, "other_library"): self = .otherLibrary(host: object?["host"] as? String)
        case (409, "no_library"): self = .noLibrary
        case (409, "full"): self = .full
        case (409, "queue_full"): self = .queueFull
        case (409, "nothing_to_play"): self = .nothingToPlay
        case (503, "too_many_sessions"): self = .tooManySessions
        case (400, _): self = .refused(code)
        case (429, _):
            self = .rateLimited(retryAfter: retryAfter.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }.map { max(1, $0) } ?? 1)
        default: self = .api(.server(status: status, code: code))
        }
    }
}

/// A link or a scan before joining: whose session it is, or why it cannot be joined.
enum TogetherOffer: Equatable, Sendable {
    case loading(id: String)
    case ready(id: String, host: String, members: Int)
    case otherLibrary(id: String, host: String)
    case gone(id: String)
    case failed(id: String, message: String)

    var id: String {
        switch self {
        case .loading(let id), .ready(let id, _, _), .otherLibrary(let id, _), .gone(let id), .failed(let id, _): id
        }
    }

    /// What the offer sheet says.
    var text: String {
        switch self {
        case .loading: "Checking the code…"
        case .ready(_, let host, let members):
            "\(host) invited you to listen together\(members > 2 ? " with \(members - 1) others" : members == 2 ? " with 1 other" : ""). Your music follows theirs while you're in."
        case .otherLibrary(_, let host):
            "Joining needs the same library: \(host)'s songs come from a Navidrome server you aren't connected to."
        case .gone: "This listening session has ended."
        case .failed(_, let message): message
        }
    }
}
