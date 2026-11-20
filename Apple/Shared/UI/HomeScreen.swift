import SwiftUI

/// "Good morning", "Good afternoon" or "Good evening", by this device's clock.
enum Greeting {
    static func at(_ date: Date = .now) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<12: "Good morning"
        case 12..<18: "Good afternoon"
        default: "Good evening"
        }
    }
}

/// Home (the web's HomeView, Android's HomeScreen, the approved preview's layout): shortcuts to
/// Liked Songs and the albums played last, then shelves: recently played, new in the library, Made
/// for you, Karaoke, the playlists, most played, something different and the artists played.
struct HomeScreen: View {
    let session: Session
    /// A shelf to open scrolled to (the `-ECHODemo shelves` screen: Made for you).
    var scrolledTo: String? = nil

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @Environment(\.navigate) private var navigate

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    ConnectionBanner(connectivity: session.connectivity)
                    if let pass = session.guest { GuestBanner(pass: pass) }
                    content
                }
                .padding(.horizontal, pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .task(id: library.home == nil) {
                guard library.home != nil, let scrolledTo else { return }
                try? await Task.sleep(for: .milliseconds(300))
                proxy.scrollTo(scrolledTo, anchor: .top)
            }
        }
        .echoRoom(strength: 0.55, height: 560)
        .navigationTitle(Greeting.at())
        .clearBars()
        #if os(iOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Settings", systemImage: "person.crop.circle") { navigate(.settings) }
            }
        }
        #endif
        .task { if library.home == nil { await library.loadHome() } }
        .refreshable { await library.loadHome() }
    }

    @ViewBuilder private var content: some View {
        if let home = library.home {
            shortcuts(home)
            albumShelf("Recently played", home.recent)
            albumShelf("New in your library", home.newest)
            if !home.mixes.isEmpty {
                Shelf(title: "Made for you") {
                    ForEach(home.mixes) { mix in
                        NavigationLink(value: Route.mix(mix)) {
                            Card(title: mix.title, subtitle: mix.subtitle) { MixArt(mix: mix) }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .id("made")
            }
            if !home.karaoke.isEmpty {
                karaokeShelf(home.karaoke)
            }
            if !library.playlists.isEmpty {
                Shelf(title: "Your playlists") {
                    ForEach(library.playlists) { playlist in
                        NavigationLink(value: Route.playlist(playlist)) {
                            Card(title: playlist.name, subtitle: playlist.owner ?? songs(playlist.tracks)) {
                                Cover(path: playlist.cover, corner: 14, symbol: "music.note.list")
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            albumShelf("Your most played", home.frequent)
            albumShelf("Something different", home.random)
            let artists = home.artists
            if artists.count >= 2 {
                Shelf(title: "Artists you play") {
                    ForEach(artists) { artist in
                        NavigationLink(value: Route.artist(id: artist.id, name: artist.name)) {
                            Card(title: artist.name, subtitle: "Artist", centred: true) {
                                Cover(path: artist.image, round: true, symbol: "music.microphone")
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        } else if let error = library.homeState.error {
            ErrorCard(title: "Couldn't load your music", error: error) {
                Task { await library.loadHome() }
            }
        } else {
            LoadingView()
        }
    }

    /// Liked Songs and the albums played last (else the newest), two or four to a row.
    private func shortcuts(_ home: HomeShelves) -> some View {
        #if os(macOS)
        let columns = 4
        #else
        let columns = 2
        #endif
        let albums = Array((home.recent.isEmpty ? home.newest : home.recent).prefix(columns * 3 - 1))
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8) {
            NavigationLink(value: Route.liked) {
                ShortcutTile(title: "Liked Songs") { LikedArt(corner: 0) }
            }
            .buttonStyle(.plain)
            ForEach(albums) { album in
                NavigationLink(value: Route.album(album)) {
                    ShortcutTile(title: album.title) { Cover(path: album.cover, corner: 0) }
                }
                .buttonStyle(.plain)
                .contextMenu { AlbumMenu(album: album) }
            }
        }
    }

    @ViewBuilder private func albumShelf(_ title: String, _ albums: [Album]) -> some View {
        if !albums.isEmpty {
            Shelf(title: title) {
                ForEach(albums) { album in
                    NavigationLink(value: Route.album(album)) {
                        Card(title: album.title, subtitle: album.artist) { Cover(path: album.cover, corner: 14) }
                    }
                    .buttonStyle(.plain)
                    .contextMenu { AlbumMenu(album: album) }
                }
            }
        }
    }

    /// Songs whose karaoke version is ready. Playing one plays the shelf (Karaoke mode itself, the
    /// Vocals slider and the key, is the karaoke task's).
    private func karaokeShelf(_ tracks: [Track]) -> some View {
        Shelf(title: "Karaoke") {
            ForEach(Array(tracks.enumerated()), id: \.element.key) { index, track in
                Button {
                    Task { await player.play(tracks, at: index, context: PlayContext(kind: "karaoke", title: "Karaoke")) }
                } label: {
                    Card(title: track.title, subtitle: track.artist) {
                        Cover(path: track.cover, corner: 14)
                            .overlay(alignment: .bottomTrailing) {
                                Image(systemName: "music.mic")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 34, height: 34)
                                    .glassEffect(.regular, in: .circle)
                                    .padding(8)
                            }
                    }
                }
                .buttonStyle(.plain)
                .contextMenu { TrackMenu(track: track) }
            }
        }
    }
}
