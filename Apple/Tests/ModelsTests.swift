import Foundation
import Testing

// The library's models from the Subsonic proxy's recorded answers, mapped as the web maps them
// (src/client/library-navidrome.ts): covers as server paths, songs with their album, Navidrome's
// refusals as errors and "not found" as nil.

@Suite("Models")
struct ModelsTests {
    let stub = Stub()

    var client: EchoClient { EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session) }

    @Test("An album list: the albums with their covers, the sort and page asked")
    func albumList() async throws {
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture("getAlbumList2"))
        let albums = try await client.albumList(.alphabetical, size: 500, offset: 0)
        #expect(albums.map(\.title) == ["Copper Rain", "Glass Weather", "Harbour Lights", "Long Exposure"])
        let copper = try #require(albums.first)
        #expect(copper.id == "al-2")
        #expect(copper.artist == "Lowfield")
        #expect(copper.artistId == "ar-1")
        #expect(copper.year == 2015)
        #expect(copper.genre == "Folk")
        #expect(copper.songCount == 3)
        #expect(copper.durationSec == 75)
        #expect(copper.cover == "/api/v1/navidrome/cover/al-2?size=300")
        #expect(copper.key == "navidrome:al-2")
        #expect(copper.tracks.isEmpty)
        let q = try #require(stub.requests.first?.query)
        #expect(q == ["type": "alphabeticalByName", "size": "500", "offset": "0"])
    }

    @Test("The year sort asks for its range; without it Navidrome refuses (code 10)")
    func yearSort() async throws {
        #expect(AlbumSort.year.list.query.contains { $0 == ("fromYear", "9999") })
        #expect(AlbumSort.allCases.map(\.label) == ["Recently added", "A–Z", "Year", "Most played"])
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture("getAlbumList2-byYear-missing-range"))
        await #expect(throws: ApiError.subsonic(code: 10, message: "missing parameter: 'fromYear'")) {
            try await client.albumList(.byYear)
        }
    }

    @Test("An album with its songs")
    func album() async throws {
        stub.on("GET", "/navidrome/rest/getAlbum", .fixture("getAlbum"))
        let loaded = try await client.album(id: "al-1")
        let album = try #require(loaded)
        #expect(album.title == "Harbour Lights")
        #expect(album.tracks.count == 4)
        let first = try #require(album.tracks.first)
        #expect(first.id == "al-1-t1")
        #expect(first.key == "navidrome:al-1-t1")
        #expect(first.provider == "navidrome")
        #expect(first.title == "Harbour Lights 1")
        #expect(first.artists == [ArtistRef(id: "ar-1", name: "Lowfield")])
        #expect(first.album == AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"))
        #expect(first.durationMs == 20000)
        #expect(first.seconds == 20)
        #expect(first.cover == "/api/v1/navidrome/cover/al-1?size=600")
        #expect(first.suffix == "wav")
        #expect(first.contentType == "audio/wav")
        #expect(first.replayGain == ReplayGain(trackGain: -6, albumGain: -7, trackPeak: 0.9, albumPeak: 0.95))
        #expect(stub.requests.first?.query["id"] == "al-1")
    }

    @Test("No such album is nil, not an error")
    func albumNotFound() async throws {
        stub.on("GET", "/navidrome/rest/getAlbum", .fixture("getAlbum-not-found"))
        let missing = try await client.album(id: "nope")
        #expect(missing == nil)
    }

    @Test("The artists: the letter index flattened, in the server's order, with pictures")
    func artists() async throws {
        stub.on("GET", "/navidrome/rest/getArtists", .fixture("getArtists"))
        let artists = try await client.artists()
        #expect(artists.map(\.name) == ["Lowfield", "Mira Sole", "Field Ensemble"])
        #expect(artists.first == Artist(id: "ar-1", name: "Lowfield", image: "/api/v1/navidrome/cover/ar-ar-1?size=300", albumCount: 2))
    }

    @Test("An artist's page and their information")
    func artist() async throws {
        stub.on("GET", "/navidrome/rest/getArtist", .fixture("getArtist"))
        stub.on("GET", "/navidrome/rest/getArtistInfo2", .fixture("getArtistInfo2"))
        stub.on("GET", "/navidrome/rest/getTopSongs", .fixture("getTopSongs"))
        let loaded = try await client.artist(id: "ar-1")
        let page = try #require(loaded)
        #expect(page.name == "Lowfield")
        #expect(page.albums.map(\.title).sorted() == ["Copper Rain", "Harbour Lights"])
        let info = try await client.artistInfo(id: "ar-1")
        #expect(info.bio == "Lowfield make records in a small room by the sea.")
        #expect(info.image == "/api/v1/navidrome/cover/ar-ar-1?size=600")
        #expect(info.similar.map(\.name) == ["Mira Sole", "Field Ensemble"])
        let top = try await client.topSongs(artist: "Lowfield")
        #expect(!top.isEmpty)
        #expect(top.allSatisfy { $0.artist == "Lowfield" })
    }

    @Test("Playlists, and one with its songs")
    func playlists() async throws {
        stub.on("GET", "/navidrome/rest/getPlaylists", .fixture("getPlaylists"))
        stub.on("GET", "/navidrome/rest/getPlaylist", .fixture("getPlaylist"))
        let lists = try await client.playlists()
        #expect(lists == [Playlist(id: "pl-1", name: "Evening", tracks: 3, cover: "/api/v1/navidrome/cover/pl-pl-1?size=300", owner: "ada", durationSec: 75)])
        let loaded = try await client.playlist(id: "pl-1")
        let detail = try #require(loaded)
        #expect(detail.entries.count == 3)
        #expect(detail.comment == nil)
        #expect(detail.covers == ["/api/v1/navidrome/cover/al-1?size=600"])
        #expect(detail.durationMs == detail.entries.reduce(0) { $0 + $1.durationMs })
        // A playlist's songs carry their own album.
        #expect(detail.entries.first?.album == AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"))
    }

    @Test("Liked songs, albums and artists")
    func starred() async throws {
        stub.on("GET", "/navidrome/rest/getStarred2", .fixture("getStarred2"))
        let liked = try await client.starred()
        #expect(liked.tracks.map(\.id) == ["al-1-t2"])
        #expect(liked.albums.isEmpty)
    }

    @Test("Search: songs, albums and artists from search3")
    func search() async throws {
        stub.on("GET", "/navidrome/rest/search3", .fixture("search3"))
        let found = try await client.search("harbour")
        #expect(found.albums.map(\.title) == ["Harbour Lights"])
        #expect(found.tracks.count == 4)
        #expect(found.artists.isEmpty)
        #expect(!found.isEmpty)
        let q = try #require(stub.requests.first?.query)
        #expect(q == ["query": "harbour", "artistCount": "6", "albumCount": "6", "songCount": "6"])
    }

    @Test("A song on its own, and the genres that have albums, the biggest first")
    func songAndGenres() async throws {
        stub.on("GET", "/navidrome/rest/getSong", .fixture("getSong"))
        stub.on("GET", "/navidrome/rest/getGenres", .fixture("getGenres"))
        let loaded = try await client.song(id: "al-1-t1")
        let song = try #require(loaded)
        #expect(song.album.id == "al-1")
        #expect(song.cover == "/api/v1/navidrome/cover/al-1?size=600")
        let genres = try await client.genres()
        #expect(genres.first == Genre(name: "Ambient", albums: 2, songs: 7))
        #expect(genres.map(\.albums) == genres.map(\.albums).sorted(by: >))
    }

    @Test("A heart goes up as a POST through the proxy")
    func star() async throws {
        stub.on("POST", "/navidrome/rest/star", .fixture("star"))
        try await client.setStar(.album, id: "al-1", on: true)
        let sent = try #require(stub.requests.first)
        #expect(sent.method == "POST")
        #expect(sent.query == ["albumId": "al-1"])
    }

    @Test("Answers from other Subsonic servers: numeric ids, ISRC lists, unknown fields, a broken item")
    func tolerant() async throws {
        stub.on("GET", "/navidrome/rest/getAlbum", .body("""
        {"subsonic-response":{"status":"ok","album":{"id":7,"name":"Seven","coverArt":"al-7","song":[
          {"id":71,"title":"One","duration":61.6,"isrc":["GBUM71029604","X"],"track":"1","played":"2026-01-01T00:00:00Z"},
          {"title":"no id"},
          {"id":"72","title":"Two","isrc":"USRC17607839"}
        ]}}}
        """))
        let loaded = try await client.album(id: "7")
        let album = try #require(loaded)
        #expect(album.id == "7")
        #expect(album.artist == "")
        #expect(album.tracks.map(\.id) == ["71", "72"])
        #expect(album.tracks[0].isrc == "GBUM71029604")
        #expect(album.tracks[0].durationMs == 61000)
        #expect(album.tracks[1].isrc == "USRC17607839")
        #expect(album.tracks[1].cover == "/api/v1/navidrome/cover/al-7?size=600")
    }

    @Test("A track in the shape every ECHO client saves (src/shared/types.ts)")
    func trackShape() throws {
        let track = Track(
            id: "al-1-t1", title: "Harbour Lights 1", artists: [ArtistRef(id: "ar-1", name: "Lowfield")],
            album: AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"), durationMs: 20000,
            artwork: [Artwork(url: "/api/v1/navidrome/cover/al-1?size=600")])
        let encoded = try JSONEncoder().encode(track)
        let object = try JSONSerialization.jsonObject(with: encoded)
        let json = try #require(object as? [String: Any])
        #expect(Set(json.keys) == ["key", "provider", "id", "title", "artists", "album", "durationMs", "artwork"])
        #expect(json["key"] as? String == "navidrome:al-1-t1")
        // One the web saved, without the fields it leaves out.
        let web = """
        {"key":"navidrome:9","provider":"navidrome","id":"9","title":"Nine","artists":[{"name":"N"}],
         "album":{"title":"A","key":"navidrome:a"},"durationMs":1000,"artwork":[]}
        """
        let decoded = try JSONDecoder().decode(Track.self, from: Data(web.utf8))
        #expect(decoded.artist == "N")
        #expect(decoded.album.id == nil)
        #expect(decoded.cover == nil)
        let roundTrip = try JSONDecoder().decode(Track.self, from: encoded)
        #expect(roundTrip == track)
    }

    @Test("Last.fm's biography as text")
    func plainBio() {
        let html = #"Lowfield &amp; friends <b>make</b> records. <a href="https://last.fm/x">Read more on Last.fm</a>"#
        #expect(Subsonic.plain(html) == "Lowfield & friends make records.")
    }
}
