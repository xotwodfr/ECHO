import Foundation

// ECHO's own lists beside the user's Navidrome (docs/api/openapi.yaml): Made For You (`/me/mixes`,
// src/server/plays.ts), the shared Wanted list (`/wanted`, src/server/wanted.ts) and the Karaoke
// shelf (`/karaoke/ready`, src/server/karaoke.ts), read as the web reads them (src/client/shell/
// mixes.ts, wanted.ts, Karaoke.tsx).

extension EchoClient {
    /// The mixes made from the user's plays. `utcOffsetMinutes` is the device's offset as the web's
    /// getTimezoneOffset gives it (minutes west of UTC), for the daylist.
    func mixes(utcOffsetMinutes: Int) async throws -> [Mix] {
        let body: MixesBody = try await get("/me/mixes", query: [("tz", String(utcOffsetMinutes))])
        return (body.mixes?.items ?? []).map { wire in
            Mix(
                id: wire.id, kind: wire.kind, title: wire.title, subtitle: wire.subtitle,
                tracks: (wire.tracks?.items ?? []).map(Self.track))
        }
    }

    /// This device's offset as `GET /me/mixes` wants it (getTimezoneOffset: minutes west of UTC).
    static var utcOffsetMinutes: Int { -TimeZone.current.secondsFromGMT() / 60 }

    /// The Wanted list, newest first (opening it has the server look for what is still missing).
    func wanted() async throws -> [WantedItem] {
        let list: LossyList<WantedWire> = try await get("/wanted")
        return list.items.map(\.item)
    }

    private struct WantedText: Encodable {
        let text: String
    }

    /// Adds `text` to the Wanted list; the same words (case, accents and punctuation aside) answer
    /// with the item already there. Empty or wordless text is refused (`bad_wanted`), as is a 201st
    /// item of one user's (`wanted_full`).
    func addWanted(_ text: String) async throws -> WantedItem {
        let wire = try await send("POST", "/wanted", json: WantedText(text: text), as: WantedWire.self)
        return wire.item
    }

    /// Removes an item for everyone (the list is shared; anyone may).
    func removeWanted(id: Int) async throws {
        _ = try await data("DELETE", "/wanted/\(id)")
    }

    /// Songs whose karaoke version is ready on the user's own Navidrome, newest first.
    func karaokeSongs(limit: Int = 30) async throws -> [Track] {
        let body: KaraokeBody = try await get("/karaoke/ready", query: [("limit", String(min(60, max(1, limit))))])
        return Subsonic.songs(body.songs?.items)
    }

    /// A song of the play history as the player plays it (the web's trackOf, src/client/shell/mixes.ts).
    static func track(_ r: TrackRefWire) -> Track {
        Track(
            id: r.id, title: r.title, artists: [ArtistRef(id: r.artistId, name: r.artist)],
            album: AlbumRef(id: r.albumId, title: r.album, key: "navidrome:\(r.albumId ?? r.id)"),
            durationMs: r.durationMs, artwork: r.cover.map { [Artwork(url: $0)] } ?? [])
    }
}

// MARK: - What the server sends

struct MixesBody: Decodable {
    let mixes: LossyList<MixWire>?
}

struct MixWire: Decodable {
    let id: String
    let kind: String
    let title: String
    let subtitle: String
    let tracks: LossyList<TrackRefWire>?

    enum CodingKeys: String, CodingKey { case id, kind, title, subtitle, tracks }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.text(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "a mix without an id")
        }
        self.id = id
        kind = c.text(.kind) ?? ""
        title = c.text(.title) ?? ""
        subtitle = c.text(.subtitle) ?? ""
        tracks = (try? c.decodeIfPresent(LossyList<TrackRefWire>.self, forKey: .tracks)) ?? nil
    }
}

/// `TrackRef` (src/shared/types.ts): a song of the play history.
struct TrackRefWire: Decodable, Sendable {
    let id: String
    let title: String
    let artist: String
    let artistId: String?
    let album: String
    let albumId: String?
    let durationMs: Int
    let cover: String?

    enum CodingKeys: String, CodingKey { case id, title, artist, artistId, album, albumId, durationMs, cover }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.text(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "a song without an id")
        }
        self.id = id
        title = c.text(.title) ?? ""
        artist = c.text(.artist) ?? ""
        artistId = c.text(.artistId)
        album = c.text(.album) ?? ""
        albumId = c.text(.albumId)
        durationMs = c.number(.durationMs) ?? 0
        cover = c.text(.cover)
    }
}

struct WantedWire: Decodable {
    let item: WantedItem

    enum CodingKeys: String, CodingKey { case id, text, addedBy, addedAt, found }
    enum FoundKeys: String, CodingKey { case kind, id, title, artist, albumId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.number(.id) else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "an item without an id")
        }
        var found: WantedItem.Found?
        if let f = try? c.nestedContainer(keyedBy: FoundKeys.self, forKey: .found), let foundId = f.text(.id) {
            found = WantedItem.Found(
                kind: f.text(.kind) ?? "album", id: foundId, title: f.text(.title) ?? "", artist: f.text(.artist) ?? "",
                albumId: f.text(.albumId))
        }
        item = WantedItem(
            id: id, text: c.text(.text) ?? "", addedBy: c.text(.addedBy),
            addedAt: Date(timeIntervalSince1970: Double(c.number(.addedAt) ?? 0) / 1000), found: found)
    }
}

struct KaraokeBody: Decodable {
    let songs: LossyList<SubSong>?
}
