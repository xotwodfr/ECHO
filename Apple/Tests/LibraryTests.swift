import Foundation
import Testing

// The library against ECHO's recorded answers: Made For You, the Wanted list and the Karaoke shelf;
// the albums in the Library's four sorts, page by page; the artists from the server's list with the
// followed ones; hearts that show at once and go back when refused; Home's shelves; and the Wanted
// list's Undo, which reaches the server only once it can no longer be undone (src/client/shell/
// wanted.ts).

/// A sleep that lasts until the test lets it go (or its task is cancelled).
final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var open = false

    var sleep: @Sendable (Duration) async throws -> Void {
        { [self] _ in
            while !lock.withLock({ open }) {
                try Task.checkCancellation()
                try await Task.sleep(for: .milliseconds(5))
            }
        }
    }

    func release() {
        lock.withLock { open = true }
    }
}

@Suite("Library calls")
struct FeedsTests {
    let stub = Stub()

    var client: EchoClient { EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session) }

    @Test("Made For You: each mix with its songs as the player plays them, the device's offset sent")
    func mixes() async throws {
        stub.on("GET", "/me/mixes", .fixture("me-mixes"))
        let mixes = try await client.mixes(utcOffsetMinutes: -60)
        #expect(mixes.map(\.id) == ["daily-1", "discover"])
        let daily = try #require(mixes.first)
        #expect(daily.kind == "daily")
        #expect(daily.title == "Daily Mix 1")
        #expect(daily.subtitle == "Lowfield, Mira Sole, Field Ensemble and more")
        #expect(daily.tracks.count == 15)
        let first = try #require(daily.tracks.first)
        #expect(first.key == "navidrome:al-1-t1")
        #expect(first.title == "Harbour Lights 1")
        #expect(first.artists == [ArtistRef(id: "ar-1", name: "Lowfield")])
        #expect(first.album == AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"))
        #expect(first.durationMs == 20000)
        #expect(first.cover == "/api/v1/navidrome/cover/al-1?size=600")
        #expect(daily.cover == first.cover)
        let sent = try #require(stub.requests.first)
        #expect(sent.query == ["tz": "-60"])
        #expect(sent.bearer == "echo_dt_test")
        #expect(EchoClient.utcOffsetMinutes == -TimeZone.current.secondsFromGMT() / 60)
    }

    @Test("The Wanted list, newest first: who added each and when, and what the library has")
    func wanted() async throws {
        stub.on("GET", "/wanted", .fixture("wanted"))
        let items = try await client.wanted()
        #expect(items.map(\.id) == [2, 1])
        #expect(items[0].text == "The Quiet Hours – Paper Satellites")
        #expect(items[0].addedBy == "ada")
        #expect(items[0].addedAt == Date(timeIntervalSince1970: 1_800_001_150))
        #expect(items[0].found == nil)
        let found = try #require(items[1].found)
        #expect(found == WantedItem.Found(kind: "album", id: "al-1", title: "Harbour Lights", artist: "Lowfield"))
        #expect(found.album == "al-1")
        let song = WantedItem.Found(kind: "song", id: "al-1-t2", title: "Two", artist: "Lowfield", albumId: "al-1")
        #expect(song.album == "al-1")
    }

    @Test("Adding sends the text; the same words again answer with the item already there")
    func addWanted() async throws {
        stub.on("POST", "/wanted", .fixture("wanted-added", status: 201), .fixture("wanted-known"))
        let added = try await client.addWanted("Lowfield Harbour Lights")
        let again = try await client.addWanted("lowfield, harbour lights!")
        #expect(added.id == 1)
        #expect(added.found?.album == "al-1")
        #expect(again == added)
        let texts = stub.requests("POST", "/wanted").map { $0.json?["text"] as? String }
        #expect(texts == ["Lowfield Harbour Lights", "lowfield, harbour lights!"])
    }

    @Test("Text without words is refused")
    func addWantedRefused() async {
        stub.on("POST", "/wanted", .fixture("wanted-bad", status: 400))
        await #expect(throws: ApiError.server(status: 400, code: "bad_wanted")) {
            try await client.addWanted("!!!")
        }
    }

    @Test("Removing is a DELETE of that item; one removed already is not found")
    func removeWanted() async throws {
        stub.on("DELETE", "/wanted/1", .fixture("wanted-removed"), .fixture("wanted-not-found", status: 404))
        try await client.removeWanted(id: 1)
        await #expect(throws: ApiError.notFound) { try await client.removeWanted(id: 1) }
        #expect(stub.requests("DELETE", "/wanted/1").count == 2)
    }

    @Test("The Karaoke shelf: the songs ready to sing, newest first, as tracks")
    func karaoke() async throws {
        stub.on("GET", "/karaoke/ready", .fixture("karaoke-ready"))
        let songs = try await client.karaokeSongs()
        #expect(songs.map(\.id) == ["al-1-t3", "al-3-t2"])
        #expect(songs.first?.album == AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"))
        #expect(songs.first?.cover == "/api/v1/navidrome/cover/al-1?size=600")
        #expect(stub.requests.first?.query == ["limit": "30"])
    }

    @Test("The Library's four sorts, each as Navidrome's album list asks for it", arguments: [
        (AlbumSort.newest, ["type": "newest"]),
        (AlbumSort.alphabetical, ["type": "alphabeticalByName"]),
        (AlbumSort.year, ["type": "byYear", "fromYear": "9999", "toYear": "0"]),
        (AlbumSort.mostPlayed, ["type": "frequent"]),
    ])
    func sorts(sort: AlbumSort, query: [String: String]) async throws {
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture("getAlbumList2"))
        let albums = try await client.albumList(sort.list, size: 500, offset: 0)
        #expect(albums.count == 4)
        var expected = query
        expected["size"] = "500"
        expected["offset"] = "0"
        #expect(stub.requests.first?.query == expected)
    }

    @Test("Artists: the server's list with the followed artists it lacks, A–Z, each once")
    func artistsMerge() {
        let server = [
            Artist(id: "ar-2", name: "Mira Sole", albumCount: 1), Artist(id: "ar-1", name: "lowfield", albumCount: 2),
        ]
        let followed = [Artist(id: "ar-1", name: "Lowfield"), Artist(id: "ar-9", name: "Ada Varga", image: "/x")]
        let rows = ArtistRows.merge(server: server, followed: followed)
        #expect(rows.map(\.id) == ["ar-9", "ar-1", "ar-2"])
        #expect(rows.map(\.followedOnly) == [true, false, false])
        #expect(rows.map(\.albums) == [0, 2, 1])
        #expect(rows.first?.image == "/x")
        #expect(ArtistRows.merge(server: [], followed: []).isEmpty)
    }
}

@Suite("Library")
@MainActor
struct LibraryModelTests {
    let stub = Stub()

    var client: EchoClient { EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session) }

    func library(page: Int = 500, sleep: @escaping @Sendable (Duration) async throws -> Void = { _ in }) -> Library {
        let client = self.client
        return Library(
            source: client, images: ImageLoader(fetch: { try await client.fetch($0) }), defaults: nil, albumPage: page,
            sleep: sleep)
    }

    static let noAlbums = #"{"subsonic-response":{"status":"ok","albumList2":{"album":[]}}}"#

    @Test("A new sort asks for every page in that order, a page at a time, and replaces the list")
    func sortPages() async throws {
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture("getAlbumList2"), .body(Self.noAlbums))
        let lib = library(page: 4)
        #expect(lib.albumSort == .newest)
        let loading = try #require(lib.setSort(.alphabetical))
        await loading.value
        #expect(lib.albumSort == .alphabetical)
        #expect(lib.albums.map(\.title) == ["Copper Rain", "Glass Weather", "Harbour Lights", "Long Exposure"])
        #expect(lib.albumsState == .ready)
        let asked = stub.requests("GET", "/navidrome/rest/getAlbumList2")
        #expect(asked.map { $0.query["offset"] } == ["0", "4"])
        #expect(asked.allSatisfy { $0.query["type"] == "alphabeticalByName" && $0.query["size"] == "4" })
        // The same sort again asks for nothing.
        #expect(lib.setSort(.alphabetical) == nil)
        #expect(stub.requests.count == 2)
    }

    @Test("A sort whose first page fails says why")
    func sortFails() async {
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture("navidrome-unreachable", status: 502))
        let lib = library()
        await lib.loadAlbums().value
        #expect(lib.albums.isEmpty)
        #expect(lib.albumsState == .failed(.navidrome(
            code: "navidrome.unreachable", message: "The Navidrome server could not be reached.")))
    }

    @Test("The Library's artists: the server's list with a followed artist it lacks")
    func artists() async {
        stub.on("GET", "/navidrome/rest/getArtists", .fixture("getArtists"))
        stub.on("GET", "/navidrome/rest/getStarred2", .body("""
        {"subsonic-response":{"status":"ok","starred2":{"artist":[{"id":"ar-9","name":"Ada Varga"},{"id":"ar-1","name":"Lowfield"}]}}}
        """))
        let lib = library()
        await lib.loadArtists()
        await lib.loadStarred()
        #expect(lib.artistsState == .ready)
        #expect(lib.artistRows.map(\.name) == ["Ada Varga", "Field Ensemble", "Lowfield", "Mira Sole"])
        #expect(lib.artistRows.filter(\.followedOnly).map(\.id) == ["ar-9"])
        #expect(lib.isFollowing("ar-1"))
        #expect(!lib.isFollowing("ar-2"))
    }

    @Test("A heart shows at once and goes up as a star; a refusal puts it back and says so")
    func hearts() async throws {
        stub.on("GET", "/navidrome/rest/getStarred2", .fixture("getStarred2"))
        stub.on("POST", "/navidrome/rest/star", .fixture("star"))
        stub.on("POST", "/navidrome/rest/unstar", .fixture("navidrome-unreachable", status: 502))
        let lib = library()
        await lib.loadStarred()
        let liked = try #require(lib.starred?.tracks.first)
        #expect(liked.id == "al-1-t2")
        #expect(lib.isLiked(liked))

        let other = Track(
            id: "al-1-t1", title: "Harbour Lights 1", artists: [ArtistRef(id: "ar-1", name: "Lowfield")],
            album: AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"), durationMs: 20000)
        await lib.setLiked(other, true)
        #expect(lib.isLiked(other))
        #expect(lib.starred?.tracks.first?.id == "al-1-t1")
        #expect(stub.requests("POST", "/navidrome/rest/star").last?.query == ["id": "al-1-t1"])
        #expect(lib.toast?.message == "Added to Liked Songs")

        let album = Album(id: "al-1", title: "Harbour Lights", artist: "Lowfield")
        await lib.setSaved(album, true)
        #expect(lib.isSaved("al-1"))
        #expect(stub.requests("POST", "/navidrome/rest/star").last?.query == ["albumId": "al-1"])

        await lib.setLiked(liked, false)
        #expect(lib.isLiked(liked))
        #expect(stub.requests("POST", "/navidrome/rest/unstar").first?.query == ["id": "al-1-t2"])
        #expect(lib.toast?.message == "Couldn't save that. Try again.")
    }

    @Test("Home's shelves come at once; a shelf that fails is left out")
    func home() async {
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture("getAlbumList2"))
        stub.on("GET", "/me/mixes", .fixture("me-mixes"))
        stub.on("GET", "/karaoke/ready", .failure(.timedOut))
        let lib = library()
        await lib.loadHome()
        #expect(lib.homeState == .ready)
        #expect(lib.home?.recent.count == 4)
        #expect(lib.home?.mixes.map(\.id) == ["daily-1", "discover"])
        #expect(lib.home?.karaoke.isEmpty == true)
        #expect(lib.home?.artists.map(\.name) == ["Lowfield", "Mira Sole", "Field Ensemble"])
        let kinds = Set(stub.requests("GET", "/navidrome/rest/getAlbumList2").compactMap { $0.query["type"] })
        #expect(kinds == ["recent", "newest", "frequent", "random"])
        #expect(stub.requests("GET", "/karaoke/ready").first?.query == ["limit": "30"])
    }

    @Test("Home says why only when every album list fails")
    func homeFails() async {
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture("navidrome-not-connected", status: 409))
        let lib = library()
        await lib.loadHome()
        #expect(lib.home == nil)
        #expect(lib.homeState == .failed(.navidromeNotConnected))
    }

    // MARK: Wanted's Undo

    @Test("Removing takes the item off at once; Undo puts it back where it was, and nothing is sent")
    func wantedUndo() async {
        stub.on("GET", "/wanted", .fixture("wanted"))
        stub.on("DELETE", "/wanted/2", .fixture("wanted-removed"))
        let gate = Gate()
        let list = WantedList(source: client, sleep: gate.sleep)
        await list.load()
        #expect(list.items?.map(\.id) == [2, 1])
        #expect(list.count == 2)
        #expect(list.foundCount == 1)
        let removal = list.remove(2)
        #expect(list.items?.map(\.id) == [1])
        #expect(list.isPending(2))
        list.undo(2)
        #expect(list.items?.map(\.id) == [2, 1])
        #expect(!list.isPending(2))
        #expect(await removal.value == .undone)
        gate.release()
        #expect(stub.requests("DELETE", "/wanted/2").isEmpty)
    }

    @Test("Once the Undo has gone, the removal reaches the server")
    func wantedRemoved() async {
        stub.on("GET", "/wanted", .fixture("wanted"))
        stub.on("DELETE", "/wanted/2", .fixture("wanted-removed"))
        let list = WantedList(source: client, sleep: { _ in })
        await list.load()
        let removal = list.remove(2)
        #expect(await removal.value == .removed)
        #expect(list.items?.map(\.id) == [1])
        #expect(stub.requests("DELETE", "/wanted/2").count == 1)
        #expect(!list.isPending(2))
    }

    @Test("Undo waits as long as its toast shows")
    func undoWindow() {
        #expect(WantedList.undoWindow == .seconds(4))
    }

    @Test("A removal the server refuses puts the item back; one removed elsewhere meanwhile is gone")
    func wantedRefused() async {
        stub.on("GET", "/wanted", .fixture("wanted"))
        stub.on("DELETE", "/wanted/2", .failure(.timedOut))
        stub.on("DELETE", "/wanted/1", .fixture("wanted-not-found", status: 404))
        let list = WantedList(source: client, sleep: { _ in })
        await list.load()
        #expect(await list.remove(2).value == .failed)
        #expect(list.items?.map(\.id) == [2, 1])
        #expect(await list.remove(1).value == .removed)
        #expect(list.items?.map(\.id) == [2])
    }

    @Test("While a removal waits, a reload does not bring it back; leaving sends it at once")
    func wantedFlush() async {
        stub.on("GET", "/wanted", .fixture("wanted"))
        stub.on("DELETE", "/wanted/2", .fixture("wanted-removed"))
        let list = WantedList(source: client, sleep: Gate().sleep)
        await list.load()
        list.remove(2)
        await list.load()
        #expect(list.items?.map(\.id) == [1])
        #expect(stub.requests("DELETE", "/wanted/2").isEmpty)
        await list.flush()
        #expect(stub.requests("DELETE", "/wanted/2").count == 1)
        #expect(!list.isPending(2))
        #expect(list.items?.map(\.id) == [1])
    }

    @Test("Adding again what was just removed keeps it, at the top")
    func wantedAddAgain() async throws {
        stub.on("GET", "/wanted", .fixture("wanted"))
        stub.on("POST", "/wanted", .fixture("wanted-known"))
        let gate = Gate()
        let list = WantedList(source: client, sleep: gate.sleep)
        await list.load()
        let removal = list.remove(1)
        let added = try await list.add("lowfield, harbour lights!")
        #expect(added.known)
        #expect(added.item.id == 1)
        #expect(list.items?.map(\.id) == [1, 2])
        #expect(await removal.value == .undone)
        gate.release()
        #expect(stub.requests("DELETE", "/wanted/1").isEmpty)
    }

    @Test("The library's removal shows a toast whose Undo puts the item back")
    func wantedToast() async throws {
        stub.on("GET", "/wanted", .fixture("wanted"))
        let lib = library(sleep: Gate().sleep)
        await lib.wanted.load()
        let item = try #require(lib.wanted.items?.first)
        lib.removeWanted(item)
        #expect(lib.wanted.items?.map(\.id) == [1])
        #expect(lib.toast?.message == "Removed “The Quiet Hours – Paper Satellites” from Wanted")
        #expect(lib.toast?.action == "Undo")
        lib.toast?.run?()
        #expect(lib.wanted.items?.map(\.id) == [2, 1])
        #expect(lib.toast == nil)
        #expect(stub.requests("DELETE", "/wanted/2").isEmpty)
    }

    @Test("Signing out forgets the library")
    func reset() async {
        stub.on("GET", "/navidrome/rest/getStarred2", .fixture("getStarred2"))
        stub.on("GET", "/wanted", .fixture("wanted"))
        let lib = library()
        await lib.loadStarred()
        await lib.wanted.load()
        lib.reset()
        #expect(lib.starred == nil)
        #expect(lib.likedIds.isEmpty)
        #expect(lib.wanted.items == nil)
        #expect(lib.starredState == .idle)
    }
}
