import SwiftUI

// The signed-in app's pages, as placeholders in the approved look: the room's light under the
// bars, the large title over it, glass on top. The library task (Home's shelves, the Library's
// lists, Search) fills them; until then they say what will be there, and nothing made up.

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

#if os(iOS)
struct HomeScreen: View {
    let session: Session
    @Binding var account: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ConnectionBanner(connectivity: session.connectivity)
                ComingSoon(
                    icon: "music.note.house", title: "Your music",
                    text: "Recently played, new in your library and Made for you will be here.")
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .echoRoom(strength: 0.55, height: 560)
        .navigationTitle(Greeting.at())
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Account", systemImage: "person.crop.circle") { account = true }
            }
        }
    }
}

struct LibraryScreen: View {
    let session: Session
    @State private var filter = "Albums"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ConnectionBanner(connectivity: session.connectivity)
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(["Playlists", "Albums", "Artists"], id: \.self) { name in
                            if name == filter {
                                Button(name) { filter = name }.buttonStyle(.glassProminent)
                            } else {
                                Button(name) { filter = name }.buttonStyle(.glass)
                            }
                        }
                    }
                }
                ComingSoon(
                    icon: "square.stack.fill", title: filter,
                    text: "Your \(filter.lowercased()), Liked Songs and Wanted will be here.")
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(alignment: .top) {
            LinearGradient(colors: [Color(hex: 0x3A2A80).opacity(0.6), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 380).ignoresSafeArea()
        }
        .background(Color.echoFloor)
        .navigationTitle("Library")
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
    }
}

struct SearchScreen: View {
    let session: Session
    @Binding var query: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(connectivity: session.connectivity)
                ComingSoon(
                    icon: "magnifyingglass", title: "Search your library",
                    text: "Songs, albums and artists from your Navidrome will be found here.")
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .echoRoom(strength: 0.45, height: 560)
        .navigationTitle("Search")
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        .searchable(text: $query, prompt: "Artists, songs, albums")
    }
}
#endif

#if os(macOS)
/// A page of the Mac's sidebar.
struct MacPage: View {
    enum Item: Hashable { case home, search, albums, artists, liked, wanted }

    let item: Item
    let session: Session

    private var title: String {
        switch item {
        case .home: Greeting.at()
        case .search: "Search"
        case .albums: "Albums"
        case .artists: "Artists"
        case .liked: "Liked Songs"
        case .wanted: "Wanted"
        }
    }

    private var placeholder: (icon: String, title: String, text: String) {
        switch item {
        case .home: ("music.note.house", "Your music", "Recently played, new in your library and Made for you will be here.")
        case .search: ("magnifyingglass", "Search your library", "Songs, albums and artists from your Navidrome will be found here.")
        case .albums: ("square.stack", "Albums", "Your albums, in the four sorts, will be here.")
        case .artists: ("music.microphone", "Artists", "Every artist on your server will be here.")
        case .liked: ("heart", "Liked Songs", "The songs you heart will be here.")
        case .wanted: ("music.note.list", "Wanted", "The shared list of music to find will be here.")
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ConnectionBanner(connectivity: session.connectivity)
                ComingSoon(icon: placeholder.icon, title: placeholder.title, text: placeholder.text)
                    .frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 28)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .echoRoom(strength: 0.5, height: 560)
        .navigationTitle(title)
    }
}
#endif
