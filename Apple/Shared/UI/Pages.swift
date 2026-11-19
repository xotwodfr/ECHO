import SwiftUI

// The library's pages (the web's LibraryViews.tsx, Android's Screens.kt, the approved preview's
// album page): each opens with its cover in the room lit by that cover, the title, the facts, the
// amber Play and the glass Shuffle, then its songs. A page that cannot load says why, with Try
// Again; one the server no longer has says so.

// MARK: - Album

struct AlbumScreen: View {
    let start: Album

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @State private var album: Album? = nil
    @State private var failure: ApiError? = nil
    @State private var missing = false
    @State private var palette: AlbumPalette? = nil

    private var shown: Album { album ?? start }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                PageHeader(
                    title: shown.title.isEmpty ? "Album" : shown.title, subtitle: shown.artist,
                    subtitleRoute: shown.artistId.map { Route.artist(id: $0, name: shown.artist) }, facts: facts
                ) {
                    Cover(path: shown.cover, corner: 18)
                } actions: {
                    PlayButtons(disabled: album?.tracks.isEmpty ?? true) {
                        if let album { Task { await player.play(album.tracks, at: 0, context: album.context) } }
                    } shuffle: {
                        if let album { Task { await player.shuffle(album.tracks, context: album.context) } }
                    }
                }
                songsSection
            }
            .padding(.horizontal, pagePadding + 4)
            .padding(.bottom, 32)
        }
        .echoRoom(strength: 0.85, height: 760, palette: palette, held: true)
        .pageTitle(shown.title)
        .clearBars()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                let saved = library.isSaved(start.id)
                Button(saved ? "Remove from Your Library" : "Save to Your Library", systemImage: saved ? "heart.fill" : "heart") {
                    Task { await library.setSaved(shown, !saved) }
                }
            }
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) {
                Menu("More", systemImage: "ellipsis") { AlbumMenu(album: shown) }
            }
        }
        .task { await load() }
        .task(id: shown.cover) {
            if let cover = shown.cover { palette = await library.images.palette(cover) }
        }
    }

    /// "Ambient · 2019 · 6 songs, 26 min".
    private var facts: String {
        let a = shown
        let count = a.tracks.isEmpty ? a.songCount : a.tracks.count
        let ms = a.tracks.isEmpty ? (a.durationSec ?? 0) * 1000 : a.tracks.reduce(0) { $0 + $1.durationMs }
        var parts: [String] = []
        if let genre = a.genre, !genre.isEmpty { parts.append(genre) }
        if let year = a.year, year > 0 { parts.append(String(year)) }
        if let count { parts.append(ms > 0 ? "\(songs(count)), \(length(ms: ms))" : songs(count)) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private var songsSection: some View {
        if let album {
            TrackList(tracks: album.tracks, context: album.context, numbered: true, showAlbum: false)
        } else if missing {
            NoteCard(icon: "square.stack", title: "Not on your server", text: "This album isn't in your Navidrome any more.")
        } else if let failure {
            ErrorCard(title: "Couldn't load this album", error: failure) { Task { await load() } }
        } else {
            LoadingView()
        }
    }

    private func load() async {
        failure = nil
        do {
            if let full = try await library.source.album(id: start.id) {
                album = full
            } else {
                missing = true
            }
        } catch is CancellationError {
        } catch {
            failure = error as? ApiError ?? .badResponse
        }
    }
}

// MARK: - Artist

/// An artist (Spotify's page, as the web's): their picture, Play and Follow, Popular, the
/// discography, fans also like, and about them.
struct ArtistScreen: View {
    let id: String
    let name: String?

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @State private var page: ArtistPage? = nil
    @State private var info: ArtistInfo? = nil
    @State private var top: [Track] = []
    @State private var failure: ApiError? = nil
    @State private var missing = false
    @State private var more = false
    @State private var palette: AlbumPalette? = nil

    private var title: String { page?.name ?? name ?? "Artist" }
    private var picture: String? { info?.image ?? page?.albums.first?.cover }
    private var context: PlayContext { PlayContext(kind: "artist", id: id, title: title) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                PageHeader(title: title, facts: page.map { albumsLine($0.albums.count) }, artWidth: 210) {
                    Cover(path: picture, round: true, symbol: "music.microphone")
                } actions: {
                    buttons
                }
                .frame(maxWidth: .infinity)
                if let page {
                    if !top.isEmpty { popular }
                    if !page.albums.isEmpty {
                        Shelf(title: "Discography") {
                            ForEach(page.albums) { album in
                                NavigationLink(value: Route.album(album)) {
                                    Card(title: album.title, subtitle: album.year.map { "\(String($0)) · Album" } ?? "Album") {
                                        Cover(path: album.cover, corner: 14)
                                    }
                                }
                                .buttonStyle(.plain)
                                .contextMenu { AlbumMenu(album: album) }
                            }
                        }
                    }
                    if let similar = info?.similar, !similar.isEmpty {
                        Shelf(title: "Fans also like") {
                            ForEach(similar.prefix(8)) { artist in
                                NavigationLink(value: Route.artist(id: artist.id, name: artist.name)) {
                                    Card(title: artist.name, subtitle: "Artist", centred: true) {
                                        Cover(path: artist.image, round: true, symbol: "music.microphone")
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    if let bio = info?.bio {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionTitle("About")
                            Text(bio)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(8)
                        }
                        .padding(20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .glassEffect(.regular, in: .rect(cornerRadius: 24))
                    }
                } else if missing {
                    NoteCard(icon: "music.microphone", title: "Not on your server", text: "This artist isn't in your Navidrome any more.")
                } else if let failure {
                    ErrorCard(title: "Couldn't load this artist", error: failure) { Task { await load() } }
                } else {
                    LoadingView()
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.bottom, 32)
        }
        .echoRoom(strength: 0.8, height: 700, palette: palette, held: true)
        .pageTitle(title)
        .clearBars()
        .task { await load() }
        .task(id: picture) {
            if let picture { palette = await library.images.palette(picture) }
        }
    }

    private var buttons: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                Button {
                    Task { await playAll() }
                } label: {
                    Label("Play", systemImage: "play.fill").frame(maxWidth: playButtonWidth)
                }
                .buttonStyle(.glassProminent)
                .tint(Color.echoAccent)
                .disabled(page == nil)
                let following = library.isFollowing(id)
                Button {
                    Task { await library.setFollowing(Artist(id: id, name: title, image: picture), !following) }
                } label: {
                    Label(following ? "Following" : "Follow", systemImage: following ? "heart.fill" : "heart")
                        .frame(maxWidth: playButtonWidth)
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
            .font(.headline)
        }
    }

    private var popular: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle("Popular")
            TrackList(tracks: Array(top.prefix(more ? 10 : 5)), context: context, numbered: false, art: true)
            if top.count > 5 {
                Button(more ? "Show less" : "See more") { more.toggle() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .buttonStyle(.plain)
            }
        }
    }

    private func albumsLine(_ n: Int) -> String {
        n == 1 ? "1 album" : "\(n) albums"
    }

    private func load() async {
        failure = nil
        let source = library.source
        let id = self.id
        async let about = outcome { try await source.artistInfo(id: id, similar: 12) }
        do {
            guard let loaded = try await source.artist(id: id) else {
                missing = true
                return
            }
            page = loaded
            top = (try? await source.topSongs(artist: loaded.name, count: 10)) ?? []
        } catch is CancellationError {
            return
        } catch {
            failure = error as? ApiError ?? .badResponse
            return
        }
        info = try? await about.get()
    }

    /// Their popular songs, else every album's songs in turn.
    private func playAll() async {
        if !top.isEmpty {
            await player.play(top, at: 0, context: context)
            return
        }
        var tracks: [Track] = []
        for album in page?.albums ?? [] {
            if let songs = await library.tracks(of: album) { tracks += songs }
        }
        if !tracks.isEmpty { await player.play(tracks, at: 0, context: context) }
    }
}

// MARK: - Playlist

struct PlaylistScreen: View {
    let start: Playlist

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @State private var detail: PlaylistDetail? = nil
    @State private var failure: ApiError? = nil
    @State private var missing = false
    @State private var palette: AlbumPalette? = nil

    private var playlist: Playlist { detail?.playlist ?? start }
    private var context: PlayContext { PlayContext(kind: "playlist", id: start.id, title: playlist.name) }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                PageHeader(title: playlist.name, subtitle: detail?.comment, facts: facts) {
                    PlaylistArt(cover: playlist.cover, covers: detail?.covers ?? [], corner: 18)
                } actions: {
                    PlayButtons(disabled: detail?.entries.isEmpty ?? true) {
                        if let detail { Task { await player.play(detail.entries, at: 0, context: context) } }
                    } shuffle: {
                        if let detail { Task { await player.shuffle(detail.entries, context: context) } }
                    }
                }
                if let detail {
                    if detail.entries.isEmpty {
                        NoteCard(icon: "music.note.list", title: "No songs yet", text: "Add songs to this playlist in ECHO on the web.")
                    } else {
                        TrackList(tracks: detail.entries, context: context, numbered: false, art: true)
                    }
                } else if missing {
                    NoteCard(icon: "music.note.list", title: "Not on your server", text: "This playlist isn't in your Navidrome any more.")
                } else if let failure {
                    ErrorCard(title: "Couldn't load this playlist", error: failure) { Task { await load() } }
                } else {
                    LoadingView()
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.bottom, 32)
        }
        .echoRoom(strength: 0.8, height: 720, palette: palette, held: true)
        .pageTitle(playlist.name)
        .clearBars()
        .task { await load() }
        .task(id: detail?.covers.first ?? start.cover) {
            if let cover = detail?.covers.first ?? start.cover { palette = await library.images.palette(cover) }
        }
    }

    /// "ada · 12 songs, 48 min".
    private var facts: String {
        let count = detail?.entries.count ?? playlist.tracks
        let ms = detail?.durationMs ?? (playlist.durationSec ?? 0) * 1000
        let size = ms > 0 ? "\(songs(count)), \(length(ms: ms))" : songs(count)
        return [playlist.owner, size].compactMap { $0 }.joined(separator: " · ")
    }

    private func load() async {
        failure = nil
        do {
            if let loaded = try await library.source.playlist(id: start.id) {
                detail = loaded
            } else {
                missing = true
            }
        } catch is CancellationError {
        } catch {
            failure = error as? ApiError ?? .badResponse
        }
    }
}

// MARK: - Liked Songs

struct LikedSongsScreen: View {
    @Environment(Library.self) private var library
    @Environment(Player.self) private var player

    private let context = PlayContext(kind: "starred", title: "Liked Songs")

    var body: some View {
        let tracks = library.starred?.tracks ?? []
        ScrollView {
            VStack(spacing: 16) {
                PageHeader(title: "Liked Songs", facts: library.starred.map { songs($0.tracks.count) }) {
                    LikedArt(corner: 18)
                } actions: {
                    PlayButtons(disabled: tracks.isEmpty) {
                        Task { await player.play(tracks, at: 0, context: context) }
                    } shuffle: {
                        Task { await player.shuffle(tracks, context: context) }
                    }
                }
                if !tracks.isEmpty {
                    TrackList(tracks: tracks, context: context, numbered: false, art: true)
                } else if let error = library.starredState.error {
                    ErrorCard(title: "Couldn't load Liked Songs", error: error) { Task { await library.loadStarred() } }
                } else if library.starred != nil {
                    NoteCard(icon: "heart", title: "Songs you like will be here", text: "Touch and hold a song, then Add to Liked Songs.")
                } else {
                    LoadingView()
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.bottom, 32)
        }
        .echoRoom(strength: 0.75, height: 680, palette: AlbumPalette.liked, held: true)
        .pageTitle("Liked Songs")
        .clearBars()
        .task { await library.loadStarred() }
    }
}

extension AlbumPalette {
    /// Liked Songs' violet.
    static let liked = AlbumPalette(base: RGB(0.33, 0.24, 0.85), accent: RGB(0.78, 0.72, 1))
}

// MARK: - Mix

struct MixScreen: View {
    let mix: Mix

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @State private var palette: AlbumPalette? = nil

    private var context: PlayContext { PlayContext(kind: "mix", id: mix.id, title: mix.title) }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                PageHeader(
                    title: mix.title, facts: [mix.subtitle, songs(mix.tracks.count)].joined(separator: " · ")
                ) {
                    MixArt(mix: mix, corner: 18, titleFont: .title.weight(.heavy))
                } actions: {
                    PlayButtons(disabled: mix.tracks.isEmpty) {
                        Task { await player.play(mix.tracks, at: 0, context: context) }
                    } shuffle: {
                        Task { await player.shuffle(mix.tracks, context: context) }
                    }
                }
                TrackList(tracks: mix.tracks, context: context, numbered: false, art: true)
            }
            .padding(.horizontal, pagePadding)
            .padding(.bottom, 32)
        }
        .echoRoom(strength: 0.8, height: 720, palette: palette, held: true)
        .pageTitle(mix.title)
        .clearBars()
        .task(id: mix.cover) {
            if let cover = mix.cover { palette = await library.images.palette(cover) }
        }
    }
}
