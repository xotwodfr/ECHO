import SwiftUI

/// The signed-in app: on the iPhone the system's glass tab bar (Home, Library, and Search in its
/// own place), on the Mac the glass sidebar, as in the approved preview (Apple/Shared/Preview). The
/// pages are placeholders the library, playback and lyrics tasks fill.
struct AppShell: View {
    let session: Session

    var body: some View {
        #if os(iOS)
        PhoneShell(session: session)
        #else
        MacShell(session: session)
        #endif
    }
}

#if os(iOS)
struct PhoneShell: View {
    enum Section: Hashable { case home, library, search }

    let session: Session
    @State private var tab = Section.home
    @State private var query = ""
    @State private var account = false

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house.fill", value: Section.home) {
                NavigationStack { HomeScreen(session: session, account: $account) }
            }
            Tab("Library", systemImage: "square.stack.fill", value: Section.library) {
                NavigationStack { LibraryScreen(session: session) }
            }
            Tab("Search", systemImage: "magnifyingglass", value: Section.search, role: .search) {
                NavigationStack { SearchScreen(session: session, query: $query) }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(isPresented: $account) { AccountView(session: session) }
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
    }
}
#endif

#if os(macOS)
struct MacShell: View {
    let session: Session
    @State private var selection: MacPage.Item? = .home
    @State private var query = ""
    @State private var account = false

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Label("Home", systemImage: "house").tag(MacPage.Item.home)
                Label("Search", systemImage: "magnifyingglass").tag(MacPage.Item.search)
                Section("Library") {
                    Label("Albums", systemImage: "square.stack").tag(MacPage.Item.albums)
                    Label("Artists", systemImage: "music.microphone").tag(MacPage.Item.artists)
                    Label("Liked Songs", systemImage: "heart").tag(MacPage.Item.liked)
                    Label("Wanted", systemImage: "music.note.list").tag(MacPage.Item.wanted)
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 220)
        } detail: {
            MacPage(item: selection ?? .home, session: session)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Account", systemImage: "person.crop.circle") { account = true }
                    }
                }
                .searchable(text: $query, placement: .toolbar, prompt: "Search")
        }
        .sheet(isPresented: $account) { AccountView(session: session) }
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
    }
}
#endif
