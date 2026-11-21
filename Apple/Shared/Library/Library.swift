import Foundation
import Observation

// The signed-in user's library as the screens see it (the web's src/client/library-navidrome.ts and
// shell/collections.ts, Android's library/Library.kt): the hearts (Liked Songs, saved albums,
// followed artists), the playlists, the albums in the four sorts, the artists, Home's shelves and
// the Wanted list, from a LibrarySource; a heart changes at once and goes back if the server
// refuses. The screens load the pages themselves (an album, an artist, a playlist, a search).

/// Something said for a moment at the bottom of the screen, perhaps with an action (Undo, Open).
struct Toast: Identifiable, Equatable {
    let id = UUID()
    var message: String
    var action: String? = nil
    var run: (@MainActor () -> Void)? = nil

    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}

/// Where a list stands.
enum LoadState: Equatable, Sendable {
    case idle, loading, ready
    case failed(ApiError)

    var error: ApiError? {
        if case .failed(let error) = self { return error }
        return nil
    }
}

/// Home's shelves: album lists (getAlbumList2's kinds), Made For You and the Karaoke shelf.
struct HomeShelves: Equatable, Sendable {
    var recent: [Album] = []
    var newest: [Album] = []
    var frequent: [Album] = []
    var random: [Album] = []
    var mixes: [Mix] = []
    var karaoke: [Track] = []

    /// The artists of the most played albums, each once (the web's ArtistShelf).
    var artists: [Artist] {
        var seen = Set<String>()
        return frequent.compactMap { a in
            guard let id = a.artistId, seen.insert(id).inserted else { return nil }
            return Artist(id: id, name: a.artist, image: a.cover)
        }
    }
}

@MainActor @Observable
final class Library {
    let source: any LibrarySource
    let images: ImageLoader
    let wanted: WantedList

    /// Everything hearted; nil until it first loads.
    private(set) var starred: Starred? = nil
    private(set) var starredState: LoadState = .idle
    private(set) var likedIds: Set<String> = []
    private(set) var savedIds: Set<String> = []
    private(set) var followedIds: Set<String> = []

    private(set) var playlists: [Playlist] = []
    private(set) var playlistsState: LoadState = .idle

    private(set) var albumSort: AlbumSort
    private(set) var albums: [Album] = []
    private(set) var albumsState: LoadState = .idle

    /// The server's own artist list (`getArtists`).
    private(set) var artists: [Artist] = []
    private(set) var artistsState: LoadState = .idle

    private(set) var home: HomeShelves? = nil
    private(set) var homeState: LoadState = .idle

    private(set) var toast: Toast? = nil

    /// Signed in with a guest pass (Session.isGuest): it listens only. The screens hide the hearts
    /// and the Wanted list's changes, and a change asked for anyway (the lock screen's Love) is
    /// refused here, without asking the server, which would refuse it too (403 guest).
    var listensOnly = false

    /// The Library's artists: the server's list with the followed artists it lacks, A–Z.
    var artistRows: [ArtistRow] { ArtistRows.merge(server: artists, followed: starred?.artists ?? []) }

    private let albumPage: Int
    private let defaults: UserDefaults?
    @ObservationIgnored private var albumsTask: Task<Void, Never>? = nil
    @ObservationIgnored private var albumsGeneration = 0
    @ObservationIgnored private var toastTask: Task<Void, Never>? = nil
    private static let sortKey = "echo.albumSort"

    /// - Parameters:
    ///   - defaults: where the album sort is kept for the next start; nil keeps nothing.
    ///   - albumPage: albums asked for at once (Navidrome allows 500).
    init(
        source: any LibrarySource, images: ImageLoader, defaults: UserDefaults? = .standard, albumPage: Int = 500,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.source = source
        self.images = images
        self.defaults = defaults
        self.albumPage = albumPage
        wanted = WantedList(source: source, sleep: sleep)
        albumSort = defaults?.string(forKey: Self.sortKey).flatMap(AlbumSort.init(rawValue:)) ?? .newest
    }

    /// What every screen leans on: the hearts, the playlists and the Wanted list.
    func start() async {
        async let hearts: Void = self.loadStarred()
        async let lists: Void = self.loadPlaylists()
        async let wanted: Void = self.wanted.load()
        _ = await (hearts, lists, wanted)
    }

    /// Forgets the account's library, its covers included (signing out).
    func reset() {
        albumsTask?.cancel()
        albumsGeneration += 1
        apply(nil)
        starredState = .idle
        playlists = []
        playlistsState = .idle
        albums = []
        albumsState = .idle
        artists = []
        artistsState = .idle
        home = nil
        homeState = .idle
        wanted.reset()
        images.clear()
        toast = nil
    }

    /// A failure as a state to show; nil for a request given up on (the screen went away).
    private func failure(_ error: Error) -> LoadState? {
        if error is CancellationError { return nil }
        return .failed(error as? ApiError ?? .badResponse)
    }

    // MARK: - Hearts

    func isLiked(_ track: Track) -> Bool { likedIds.contains(track.id) }
    func isSaved(_ albumId: String) -> Bool { savedIds.contains(albumId) }
    func isFollowing(_ artistId: String) -> Bool { followedIds.contains(artistId) }

    func loadStarred() async {
        if starred == nil { starredState = .loading }
        do {
            let loaded = try await source.starred()
            apply(loaded)
            starredState = .ready
        } catch {
            if starred == nil, let state = failure(error) { starredState = state }
        }
    }

    func setLiked(_ track: Track, _ on: Bool) async {
        await change(.track, id: track.id, on: on, said: on ? "Added to Liked Songs" : "Removed from Liked Songs") {
            $0.tracks.removeAll { $0.id == track.id }
            if on { $0.tracks.insert(track, at: 0) }
        }
    }

    func setSaved(_ album: Album, _ on: Bool) async {
        await change(
            .album, id: album.id, on: on, said: on ? "Saved to Your Library" : "Removed from Your Library"
        ) {
            $0.albums.removeAll { $0.id == album.id }
            if on { $0.albums.insert(album, at: 0) }
        }
    }

    func setFollowing(_ artist: Artist, _ on: Bool) async {
        await change(
            .artist, id: artist.id, on: on, said: on ? "Following \(artist.name)" : "Unfollowed \(artist.name)"
        ) {
            $0.artists.removeAll { $0.id == artist.id }
            if on { $0.artists.insert(artist, at: 0) }
        }
    }

    /// A heart on or off: here at once, on the server after; back as it was if the server refuses.
    private func change(_ kind: StarKind, id: String, on: Bool, said: String, edit: (inout Starred) -> Void) async {
        if listensOnly { return refusedForGuest() }
        let before = starred
        var after = starred ?? Starred()
        edit(&after)
        apply(after)
        do {
            try await source.setStar(kind, id: id, on: on)
            show(Toast(message: said))
        } catch {
            apply(before)
            show(Toast(message: "Couldn't save that. Try again."))
        }
    }

    private func apply(_ s: Starred?) {
        starred = s
        likedIds = Set(s?.tracks.map(\.id) ?? [])
        savedIds = Set(s?.albums.map(\.id) ?? [])
        followedIds = Set(s?.artists.map(\.id) ?? [])
    }

    // MARK: - Playlists and artists

    func loadPlaylists() async {
        if playlistsState != .ready { playlistsState = .loading }
        do {
            playlists = try await source.playlists()
            playlistsState = .ready
        } catch {
            if playlists.isEmpty, let state = failure(error) { playlistsState = state }
        }
    }

    func loadArtists() async {
        if artistsState != .ready { artistsState = .loading }
        do {
            artists = try await source.artists()
            artistsState = .ready
        } catch {
            if artists.isEmpty, let state = failure(error) { artistsState = state }
        }
    }

    // MARK: - Albums

    /// A new order: the list is asked for again in it (the task loading it; nil when unchanged).
    @discardableResult
    func setSort(_ sort: AlbumSort) -> Task<Void, Never>? {
        guard sort != albumSort else { return nil }
        albumSort = sort
        defaults?.set(sort.rawValue, forKey: Self.sortKey)
        return loadAlbums()
    }

    /// The whole album list in the chosen order, a page at a time (each shown as it comes); a newer
    /// sort supersedes it. A later page that fails leaves the ones before it.
    @discardableResult
    func loadAlbums() -> Task<Void, Never> {
        albumsTask?.cancel()
        albumsGeneration += 1
        let generation = albumsGeneration
        let sort = albumSort
        let size = albumPage
        let source = self.source
        albumsState = .loading
        let task = Task {
            var all: [Album] = []
            var offset = 0
            while true {
                let page: [Album]
                do {
                    page = try await source.albumList(sort.list, size: size, offset: offset)
                } catch {
                    guard generation == albumsGeneration, let state = failure(error) else { return }
                    if all.isEmpty {
                        albums = []
                        albumsState = state
                    } else {
                        albumsState = .ready
                    }
                    return
                }
                guard generation == albumsGeneration else { return }
                all += page
                albums = all
                albumsState = .ready
                if page.count < size { return }
                offset += size
            }
        }
        albumsTask = task
        return task
    }

    /// An album with its songs: as it is when it has them, else from the server (nil with a toast
    /// when that fails).
    func tracks(of album: Album) async -> [Track]? {
        if !album.tracks.isEmpty { return album.tracks }
        do {
            if let full = try await source.album(id: album.id), !full.tracks.isEmpty { return full.tracks }
        } catch is CancellationError {
            return nil
        } catch {}
        show(Toast(message: "Couldn't load this album."))
        return nil
    }

    // MARK: - Home

    /// Home's shelves, all asked for at once; a shelf that fails is left out, and only when every
    /// album list fails does Home say so.
    func loadHome() async {
        if home == nil { homeState = .loading }
        let source = self.source
        let offset = EchoClient.utcOffsetMinutes
        async let recent = outcome { try await source.albumList(.recent, size: 12, offset: 0) }
        async let newest = outcome { try await source.albumList(.newest, size: 12, offset: 0) }
        async let frequent = outcome { try await source.albumList(.frequent, size: 12, offset: 0) }
        async let random = outcome { try await source.albumList(.random, size: 12, offset: 0) }
        async let mixes = outcome { try await source.mixes(utcOffsetMinutes: offset) }
        async let karaoke = outcome { try await source.karaokeSongs(limit: 30) }
        let lists = await [recent, newest, frequent, random]
        let (made, sing) = await (mixes, karaoke)
        if Task.isCancelled { return }
        let albums = lists.map { (try? $0.get()) ?? [] }
        let errors = lists.compactMap { result -> ApiError? in
            if case .failure(let error) = result { return error }
            return nil
        }
        if errors.count == lists.count, let first = errors.first {
            homeState = .failed(first)
            return
        }
        home = HomeShelves(
            recent: albums[0], newest: albums[1], frequent: albums[2], random: albums[3],
            mixes: (try? made.get()) ?? [], karaoke: (try? sing.get()) ?? [])
        homeState = .ready
    }

    private func refusedForGuest() {
        show(Toast(message: ApiError.guestNotAllowed.userMessage))
    }

    // MARK: - Wanted

    /// Adds to the Wanted list with a toast that says so (and opens the list, given `open`).
    func addWanted(_ text: String, open: (@MainActor () -> Void)? = nil) async {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if listensOnly { return refusedForGuest() }
        do {
            let added = try await wanted.add(text)
            show(Toast(message: added.known ? "Already on the Wanted list" : "Added to Wanted", action: open == nil ? nil : "Open", run: open))
        } catch {
            show(Toast(message: "Couldn't change the Wanted list. Try again."))
        }
    }

    /// Takes an item off the Wanted list, with Undo for as long as the toast shows.
    func removeWanted(_ item: WantedItem) {
        if listensOnly { return refusedForGuest() }
        let removal = wanted.remove(item.id)
        show(Toast(message: "Removed “\(item.text)” from Wanted", action: "Undo") { [weak self] in
            self?.wanted.undo(item.id)
            self?.dismissToast()
        })
        Task { [weak self] in
            if await removal.value == .failed {
                self?.show(Toast(message: "Couldn't change the Wanted list. Try again."))
            }
        }
    }

    // MARK: - Toasts

    func show(_ toast: Toast) {
        toastTask?.cancel()
        self.toast = toast
        let id = toast.id
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: WantedList.undoWindow)
            guard !Task.isCancelled, let self, self.toast?.id == id else { return }
            self.toast = nil
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toast = nil
    }
}
