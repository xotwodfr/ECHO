import SwiftUI

/// What the Library lists under Liked Songs and Wanted.
enum LibraryChip: String, CaseIterable, Identifiable, Hashable {
    case playlists = "Playlists"
    case albums = "Albums"
    case artists = "Artists"

    var id: String { rawValue }
}

/// "Playlist · 48 songs" for Liked Songs; "List · 3 items · 1 in your library" for Wanted.
extension Library {
    var likedLine: String {
        guard let starred else { return "Playlist" }
        return "Playlist · \(songs(starred.tracks.count))"
    }

    var wantedLine: String {
        guard wanted.items != nil else { return "List" }
        let n = wanted.count, found = wanted.foundCount
        return "List · \(n == 1 ? "1 item" : "\(n) items")\(found > 0 ? " · \(found) in your library" : "")"
    }
}

#if os(iOS)
/// The iPhone's Library (the approved preview's): glass chips for Playlists, Albums and Artists,
/// Liked Songs and Wanted always on top, then the chip's list; the albums in the four sorts.
struct LibraryScreen: View {
    let session: Session
    @State private var chip: LibraryChip

    @Environment(Library.self) private var library

    init(session: Session, chip: LibraryChip = .playlists) {
        self.session = session
        _chip = State(initialValue: chip)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ConnectionBanner(connectivity: session.connectivity)
                    .padding(.bottom, 12)
                chips
                    .padding(.bottom, 16)
                NavigationLink(value: Route.liked) {
                    LibraryRow(title: "Liked Songs", subtitle: library.likedLine) { LikedArt() }
                }
                .buttonStyle(.plain)
                NavigationLink(value: Route.wanted) {
                    LibraryRow(title: "Wanted", subtitle: library.wantedLine) { WantedArt() }
                }
                .buttonStyle(.plain)
                switch chip {
                case .playlists: playlistRows
                case .albums: albumRows
                case .artists: artistRows
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.bottom, 32)
        }
        .background(alignment: .top) {
            LinearGradient(colors: [Color(hex: 0x3A2A80).opacity(0.6), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 380)
                .ignoresSafeArea()
        }
        .background(Color.echoFloor)
        .navigationTitle("Library")
        .clearBars()
        .toolbar {
            ToolbarItem(placement: .primaryAction) { sortMenu }
        }
        .task(id: chip) { await load(chip) }
        .refreshable { await reload() }
    }

    private var chips: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                ForEach(LibraryChip.allCases) { option in
                    if option == chip {
                        Button(option.rawValue) { chip = option }.buttonStyle(.glassProminent)
                    } else {
                        Button(option.rawValue) { chip = option }.buttonStyle(.glass)
                    }
                }
            }
        }
    }

    /// The albums' four sorts (choosing one shows the albums).
    private var sortMenu: some View {
        Menu {
            Picker(
                "Sort albums",
                selection: Binding(
                    get: { library.albumSort },
                    set: { sort in
                        library.setSort(sort)
                        chip = .albums
                    })
            ) {
                ForEach(AlbumSort.allCases) { sort in
                    Text(sort.label).tag(sort)
                }
            }
        } label: {
            Label("Sort", systemImage: "arrow.up.arrow.down")
        }
    }

    @ViewBuilder private var playlistRows: some View {
        if library.playlists.isEmpty {
            placeholder(library.playlistsState, what: "your playlists", empty: "No playlists yet. Make one in ECHO on the web.") {
                await library.loadPlaylists()
            }
        } else {
            ForEach(library.playlists) { playlist in
                NavigationLink(value: Route.playlist(playlist)) {
                    LibraryRow(title: playlist.name, subtitle: "Playlist · \(playlist.owner ?? songs(playlist.tracks))") {
                        Cover(path: playlist.cover, corner: 10, symbol: "music.note.list")
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var albumRows: some View {
        Text(library.albumSort.label)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 14)
            .padding(.bottom, 2)
        if library.albums.isEmpty {
            placeholder(library.albumsState, what: "your albums", empty: "No albums yet.") {
                await library.loadAlbums().value
            }
        } else {
            ForEach(library.albums) { album in
                NavigationLink(value: Route.album(album)) {
                    LibraryRow(title: album.title, subtitle: "Album · \(album.artist)") {
                        Cover(path: album.cover, corner: 10)
                    }
                }
                .buttonStyle(.plain)
                .contextMenu { AlbumMenu(album: album) }
            }
        }
    }

    @ViewBuilder private var artistRows: some View {
        let rows = library.artistRows
        if rows.isEmpty {
            placeholder(library.artistsState, what: "the artists", empty: "No artists yet.") {
                await library.loadArtists()
            }
        } else {
            ForEach(rows) { artist in
                NavigationLink(value: Route.artist(id: artist.id, name: artist.name)) {
                    LibraryRow(title: artist.name, subtitle: artistLine(artist)) {
                        Cover(path: artist.image, round: true, symbol: "music.microphone")
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func artistLine(_ artist: ArtistRow) -> String {
        if artist.followedOnly { return "Artist · Following" }
        return artist.albums == 1 ? "Artist · 1 album" : "Artist · \(artist.albums) albums"
    }

    @ViewBuilder
    private func placeholder(_ state: LoadState, what: String, empty: String, retry: @escaping () async -> Void) -> some View {
        switch state {
        case .failed(let error):
            ErrorCard(title: "Couldn't load \(what)", error: error) { Task { await retry() } }
                .padding(.top, 12)
        case .ready:
            NoteCard(icon: "square.stack", title: "Nothing here yet", text: empty)
                .padding(.top, 12)
        case .idle, .loading:
            LoadingView()
        }
    }

    private func load(_ chip: LibraryChip) async {
        switch chip {
        case .playlists:
            if library.playlistsState == .idle { await library.loadPlaylists() }
        case .albums:
            if library.albumsState == .idle { await library.loadAlbums().value }
        case .artists:
            if library.artistsState == .idle { await library.loadArtists() }
        }
    }

    private func reload() async {
        switch chip {
        case .playlists: await library.loadPlaylists()
        case .albums: await library.loadAlbums().value
        case .artists: await library.loadArtists()
        }
        await library.loadStarred()
        await library.wanted.load()
    }
}
#endif
