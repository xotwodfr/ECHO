import SwiftUI

#if os(iOS)
/// The iPhone's Search: the search field in the tab bar (the Search tab's own role), the results
/// over the room.
struct SearchScreen: View {
    let session: Session
    @Binding var query: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(connectivity: session.connectivity)
                SearchResults(query: query)
            }
            .padding(.horizontal, pagePadding)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .echoRoom(strength: 0.45, height: 560)
        .navigationTitle("Search")
        .clearBars()
        .searchable(text: $query, prompt: "Artists, songs, albums")
    }
}
#endif

/// What Navidrome's search (`search3`) finds, as the web shows it: the top result (an artist, else
/// an album, with Play), songs, artists and albums; asked 250 ms after typing stops, an answer for
/// an older query dropped. Nothing found offers the Wanted list.
struct SearchResults: View {
    let query: String

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @Environment(\.navigate) private var navigate
    @State private var state: Found = .idle
    @State private var attempt = 0

    private enum Found {
        case idle
        case searching
        case done(String, SearchResult)
        case failed(String, ApiError)
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            switch state {
            case .idle:
                NoteCard(
                    icon: "magnifyingglass", title: "Search your library",
                    text: "Songs, albums and artists from your Navidrome.")
            case .searching:
                LoadingView()
            case .failed(_, let error):
                ErrorCard(title: "Search didn't answer", error: error) { attempt += 1 }
            case .done(let q, let found):
                if found.isEmpty {
                    nothingFound(q)
                } else {
                    results(q, found)
                }
            }
        }
        .task(id: "\(attempt)\u{1}\(trimmed)") { await search(trimmed) }
    }

    private func search(_ q: String) async {
        guard !q.isEmpty else {
            state = .idle
            return
        }
        // While typing, the last results stay until the new ones come.
        if case .done = state {} else { state = .searching }
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return }
        do {
            let found = try await library.source.search(q, artists: 6, albums: 6, songs: 8)
            state = .done(q, found)
        } catch is CancellationError {
        } catch {
            state = .failed(q, error as? ApiError ?? .badResponse)
        }
    }

    @ViewBuilder private func results(_ q: String, _ found: SearchResult) -> some View {
        let context = PlayContext(kind: "search", title: q)
        if let artist = found.artists.first {
            SectionTitle("Top result")
            NavigationLink(value: Route.artist(id: artist.id, name: artist.name)) {
                topCard(cover: artist.image, round: true, title: artist.name, kind: "Artist")
            }
            .buttonStyle(.plain)
        } else if let album = found.albums.first {
            SectionTitle("Top result")
            NavigationLink(value: Route.album(album)) {
                topCard(cover: album.cover, round: false, title: album.title, kind: "Album · \(album.artist)")
            }
            .buttonStyle(.plain)
            .overlay(alignment: .trailing) {
                Button("Play \(album.title)", systemImage: "play.fill") {
                    Task {
                        if let tracks = await library.tracks(of: album) {
                            await player.play(tracks, at: 0, context: album.context)
                        }
                    }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .tint(Color.echoAccent)
                .controlSize(.large)
                .padding(.trailing, 18)
            }
            .contextMenu { AlbumMenu(album: album) }
        }
        if !found.tracks.isEmpty {
            SectionTitle("Songs")
            VStack(spacing: 0) {
                ForEach(Array(found.tracks.prefix(4).enumerated()), id: \.offset) { index, track in
                    TrackRow(track: track, art: true) {
                        Task { await player.play(found.tracks, at: index, context: context) }
                    }
                }
            }
        }
        if !found.artists.isEmpty {
            Shelf(title: "Artists") {
                ForEach(found.artists) { artist in
                    NavigationLink(value: Route.artist(id: artist.id, name: artist.name)) {
                        Card(title: artist.name, subtitle: "Artist", centred: true) {
                            Cover(path: artist.image, round: true, symbol: "music.microphone")
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        if !found.albums.isEmpty {
            Shelf(title: "Albums") {
                ForEach(found.albums) { album in
                    NavigationLink(value: Route.album(album)) {
                        Card(title: album.title, subtitle: album.artist) { Cover(path: album.cover, corner: 14) }
                    }
                    .buttonStyle(.plain)
                    .contextMenu { AlbumMenu(album: album) }
                }
            }
        }
    }

    /// The top result's card (the preview's): its cover, its name and what it is.
    private func topCard(cover: String?, round: Bool, title: String, kind: String) -> some View {
        HStack(spacing: 14) {
            Cover(path: cover, corner: 12, round: round, symbol: round ? "music.microphone" : "music.note")
                .frame(width: 84, height: 84)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.title3.bold()).lineLimit(2)
                Text(kind).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 64)
        }
        .padding(14)
        .background(.white.opacity(0.08), in: .rect(cornerRadius: 18))
        .contentShape(.rect)
    }

    /// Nothing found: put it on the Wanted list (the web's NothingFound).
    private func nothingFound(_ q: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color.amber)
            Text("No results for “\(q)”").font(.headline).multilineTextAlignment(.center)
            Text("Put it on the Wanted list: everyone on this ECHO sees it, and ECHO looks for it in your library every day.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Add to Wanted", systemImage: "plus") {
                Task { await library.addWanted(q) { navigate(.wanted) } }
            }
            .buttonStyle(.glassProminent)
            .tint(Color.echoAccent)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }
}
