import SwiftUI

/// The signed-in app: on the iPhone the system's glass tab bar (Home, Library, and Search in its
/// own place), on the Mac the glass sidebar, as in the approved preview. Each tab or sidebar page
/// has its own stack the library's pages open on (Route).
struct AppShell: View {
    let session: Session
    var start = ShellStart()
    /// A link into the app to open (the iPhone's widget opens Now Playing); the shell clears it.
    var link: Binding<AppLink?> = .constant(nil)

    var body: some View {
        #if os(iOS)
        PhoneShell(session: session, start: start, link: link)
        #else
        MacShell(session: session, start: start)
        #endif
    }
}

/// Where the signed-in app opens: Home, or (the `-ECHODemo` screens) another page of it.
struct ShellStart {
    enum Page: Hashable {
        case home
        case search(String)
        case playlists, albums, artists, liked, wanted
    }

    /// Now Playing open over it (the iPhone), on the song, on Up next or with its lyrics over it;
    /// on the Mac, the lyrics over the window.
    enum Playing: Hashable {
        case song, queue, lyrics
    }

    var page: Page = .home
    /// Pages open on top of it.
    var path: [Route] = []
    /// A Home shelf to open scrolled to.
    var shelf: String? = nil
    var playing: Playing? = nil
}

#if os(iOS)
struct PhoneShell: View {
    enum Section: Hashable { case home, library, search }

    let session: Session
    @Binding private var link: AppLink?
    private let chip: LibraryChip
    private let shelf: String?
    private let playing: ShellStart.Playing?
    @State private var tab: Section
    @State private var homePath: [Route]
    @State private var libraryPath: [Route]
    @State private var searchPath: [Route]
    @State private var query: String
    @State private var nowPlaying = false
    @State private var showsQueue = false
    @State private var showsLyrics = false
    /// A guest link opened while signed in: the scanner says why it cannot be used here.
    @State private var scan: ScanFlow? = nil
    @Namespace private var playerSpace

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @Environment(Lyrics.self) private var lyrics
    @Environment(\.lyricsMenuOnOpen) private var lyricsMenuOnOpen

    init(session: Session, start: ShellStart = ShellStart(), link: Binding<AppLink?> = .constant(nil)) {
        self.session = session
        _link = link
        playing = start.playing
        var tab = Section.home
        var chip = LibraryChip.playlists
        var query = ""
        var home: [Route] = []
        var library: [Route] = []
        var search: [Route] = []
        switch start.page {
        case .home: home = start.path
        case .search(let q):
            tab = .search
            query = q
            search = start.path
        case .playlists:
            tab = .library
            library = start.path
        case .albums:
            tab = .library
            chip = .albums
            library = start.path
        case .artists:
            tab = .library
            chip = .artists
            library = start.path
        case .liked:
            tab = .library
            library = [.liked] + start.path
        case .wanted:
            tab = .library
            library = [.wanted] + start.path
        }
        self.chip = chip
        shelf = start.shelf
        _tab = State(initialValue: tab)
        _homePath = State(initialValue: home)
        _libraryPath = State(initialValue: library)
        _searchPath = State(initialValue: search)
        _query = State(initialValue: query)
    }

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house.fill", value: Section.home) {
                NavigationStack(path: $homePath) {
                    HomeScreen(session: session, scrolledTo: shelf).libraryRoutes()
                }
                .environment(\.navigate, NavigateAction { homePath.append($0) })
            }
            Tab("Library", systemImage: "square.stack.fill", value: Section.library) {
                NavigationStack(path: $libraryPath) {
                    LibraryScreen(session: session, chip: chip).libraryRoutes()
                }
                .environment(\.navigate, NavigateAction { libraryPath.append($0) })
            }
            Tab("Search", systemImage: "magnifyingglass", value: Section.search, role: .search) {
                NavigationStack(path: $searchPath) {
                    SearchScreen(session: session, query: $query).libraryRoutes()
                }
                .environment(\.navigate, NavigateAction { searchPath.append($0) })
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .modifier(PlayerAccessory(shown: player.track != nil) {
            MiniPlayer {
                showsQueue = false
                showsLyrics = false
                nowPlaying = true
            }
            .matchedTransitionSource(id: "player", in: playerSpace)
        })
        .overlay { ToastLayer(bottom: player.track == nil ? 76 : 136) }
        .fullScreenCover(isPresented: $nowPlaying) {
            NowPlayingScreen(showsQueue: $showsQueue, showsLyrics: $showsLyrics)
                .navigationTransition(.zoom(sourceID: "player", in: playerSpace))
                .environment(library)
                .environment(player)
                .environment(lyrics)
                .environment(\.lyricsMenuOnOpen, lyricsMenuOnOpen)
                .environment(\.navigate, NavigateAction { route in
                    nowPlaying = false
                    go(route)
                })
        }
        .fullScreenCover(item: $scan) { flow in
            ScanScreen(flow: flow) { scan = nil }
        }
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
        .task {
            // The demo screens that open on Now Playing (`-ECHODemo nowplaying`, `queue`, and the
            // lyrics over it: `lyrics`, `lyrics-interlude`, `lyrics-plain`, `lyrics-menu`).
            guard let playing, player.track != nil else { return }
            try? await Task.sleep(for: .milliseconds(400))
            showsQueue = playing == .queue
            nowPlaying = true
            guard playing == .lyrics else { return }
            try? await Task.sleep(for: .milliseconds(900))
            showsLyrics = true
        }
        .task(id: link) { await follow(link) }
    }

    /// A link into the app: Now Playing (the widget's tap) opens over the page in front, once there
    /// is a song (launched for the link, the saved queue may take a moment: 5 s at most).
    private func follow(_ link: AppLink?) async {
        guard let link else { return }
        switch link {
        case .nowPlaying:
            var waited = 0
            while player.track == nil, waited < 50, !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                waited += 1
            }
            if player.track != nil {
                showsQueue = false
                showsLyrics = false
                nowPlaying = true
            }
        case .guest:
            // Signed in already: the scanner, given the pass, says to sign out first.
            let flow = ScanFlow(purpose: .signInComputer, session: session)
            scan = flow
            await flow.scanned(link.url.absoluteString)
        }
        self.link = nil
    }

    /// A page from Now Playing's menu, on the tab in front.
    private func go(_ route: Route) {
        switch tab {
        case .home: homePath.append(route)
        case .library: libraryPath.append(route)
        case .search: searchPath.append(route)
        }
    }
}
#endif

#if os(macOS)
/// A page of the Mac's sidebar.
enum MacItem: Hashable {
    case home, search, albums, artists, liked, wanted
    case playlist(Playlist)
}

struct MacShell: View {
    let session: Session
    private let shelf: String?
    @State private var selection: MacItem?
    @State private var path: [Route]
    @State private var query: String
    /// The lyrics over the window (the player bar's Lyrics button).
    @State private var showsLyrics: Bool

    @Environment(Library.self) private var libraryModel
    @Environment(Player.self) private var player
    @Environment(\.openSettings) private var openSettings

    init(session: Session, start: ShellStart = ShellStart()) {
        self.session = session
        var item = MacItem.home
        var query = ""
        switch start.page {
        case .home: item = .home
        case .search(let q):
            item = .search
            query = q
        case .playlists, .albums: item = .albums
        case .artists: item = .artists
        case .liked: item = .liked
        case .wanted: item = .wanted
        }
        shelf = start.shelf
        _selection = State(initialValue: item)
        _path = State(initialValue: start.path)
        _query = State(initialValue: query)
        _showsLyrics = State(initialValue: start.playing == .lyrics)
    }

    var body: some View {
        Group {
            // The lyrics in the whole window, in place of the library (its toolbar, title and search
            // go with it): the room under the title bar and its window controls, as the approved
            // preview has them. The library's place is kept in the shell (selection, path, query).
            if showsLyrics, player.track != nil {
                MacLyricsView(shown: $showsLyrics)
                    .toolbar(removing: .title)
                    .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
                    .transition(.opacity)
            } else {
                library
                    .transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.35), value: showsLyrics)
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
    }

    private var library: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Label("Home", systemImage: "house").tag(MacItem.home)
                Label("Search", systemImage: "magnifyingglass").tag(MacItem.search)
                Section("Library") {
                    Label("Albums", systemImage: "square.stack").tag(MacItem.albums)
                    Label("Artists", systemImage: "music.microphone").tag(MacItem.artists)
                    Label("Liked Songs", systemImage: "heart").tag(MacItem.liked)
                    Label("Wanted", systemImage: "music.note.list").tag(MacItem.wanted)
                }
                if !libraryModel.playlists.isEmpty {
                    Section("Playlists") {
                        ForEach(libraryModel.playlists) { playlist in
                            Label(playlist.name, systemImage: "music.note.list").tag(MacItem.playlist(playlist))
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 220)
        } detail: {
            NavigationStack(path: $path) {
                MacPage(item: selection ?? .home, session: session, query: query, shelf: shelf)
                    .libraryRoutes()
            }
            .environment(\.navigate, NavigateAction { path.append($0) })
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if player.track != nil {
                    MacPlayerBar(showsLyrics: $showsLyrics)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 14)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.smooth, value: player.track == nil)
            .overlay { ToastLayer(bottom: player.track == nil ? 20 : 112) }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Settings", systemImage: "gearshape") { openSettings() }
            }
        }
        .searchable(text: $query, placement: .toolbar, prompt: "Search")
        .onChange(of: selection) { path = [] }
        .onChange(of: query) {
            if !query.isEmpty, selection != .search { selection = .search }
        }
    }
}

/// What a sidebar page shows.
struct MacPage: View {
    let item: MacItem
    let session: Session
    let query: String
    var shelf: String? = nil

    var body: some View {
        switch item {
        case .home: HomeScreen(session: session, scrolledTo: shelf)
        case .search: MacSearch(session: session, query: query)
        case .albums: MacAlbums(session: session)
        case .artists: MacArtists(session: session)
        case .liked: LikedSongsScreen()
        case .wanted: WantedScreen()
        case .playlist(let playlist): PlaylistScreen(start: playlist).id(playlist.id)
        }
    }
}

/// Search under the toolbar's field.
struct MacSearch: View {
    let session: Session
    let query: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(connectivity: session.connectivity)
                SearchResults(query: query)
            }
            .padding(.horizontal, pagePadding)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .echoRoom(strength: 0.45, height: 560)
        .navigationTitle("Search")
    }
}

/// The albums as a grid of covers, the four sorts in the toolbar (the approved preview's).
struct MacAlbums: View {
    let session: Session

    @Environment(Library.self) private var library

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(connectivity: session.connectivity)
                if library.albums.isEmpty {
                    if let error = library.albumsState.error {
                        ErrorCard(title: "Couldn't load your albums", error: error) { _ = library.loadAlbums() }
                    } else if library.albumsState == .ready {
                        NoteCard(icon: "square.stack", title: "No albums yet", text: "Your Navidrome has no albums.")
                    } else {
                        LoadingView()
                    }
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 22)], spacing: 22) {
                        ForEach(library.albums) { album in
                            NavigationLink(value: Route.album(album)) {
                                Card(title: album.title, subtitle: album.artist, width: nil) {
                                    Cover(path: album.cover, corner: 10)
                                }
                            }
                            .buttonStyle(.plain)
                            .contextMenu { AlbumMenu(album: album) }
                        }
                    }
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .echoRoom(strength: 0.5, height: 560)
        .navigationTitle("Albums")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Picker("Sort", selection: Binding(get: { library.albumSort }, set: { _ = library.setSort($0) })) {
                    ForEach(AlbumSort.allCases) { sort in
                        Text(sort.label).tag(sort)
                    }
                }
                .pickerStyle(.segmented)
            }
        }
        .task { if library.albumsState == .idle { library.loadAlbums() } }
    }
}

/// Every artist on the server, with the ones followed, as round pictures.
struct MacArtists: View {
    let session: Session

    @Environment(Library.self) private var library

    var body: some View {
        let rows = library.artistRows
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(connectivity: session.connectivity)
                if rows.isEmpty {
                    if let error = library.artistsState.error {
                        ErrorCard(title: "Couldn't load the artists", error: error) { Task { await library.loadArtists() } }
                    } else if library.artistsState == .ready {
                        NoteCard(icon: "music.microphone", title: "No artists yet", text: "Your Navidrome has no artists.")
                    } else {
                        LoadingView()
                    }
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 22)], spacing: 26) {
                        ForEach(rows) { artist in
                            NavigationLink(value: Route.artist(id: artist.id, name: artist.name)) {
                                Card(
                                    title: artist.name,
                                    subtitle: artist.followedOnly
                                        ? "Following" : artist.albums == 1 ? "1 album" : "\(artist.albums) albums",
                                    width: nil, centred: true
                                ) {
                                    Cover(path: artist.image, round: true, symbol: "music.microphone")
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .echoRoom(strength: 0.5, height: 560)
        .navigationTitle("Artists")
        .task { if library.artistsState == .idle { await library.loadArtists() } }
    }
}
#endif
