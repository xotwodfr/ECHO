import SwiftUI

/// The Wanted list (the web's WantedView, layout A): what it is, a field to add something, then one
/// list, newest first. Each item says who added it and when; once the library has it, it opens and
/// plays from its album. Anyone removes anything, with Undo while the toast shows.
struct WantedScreen: View {
    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @State private var text = ""

    private static let ago: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.dateTimeStyle = .named
        f.unitsStyle = .full
        return f
    }()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Music that isn't in Navidrome yet. Everyone on this server shares this list, and ECHO looks for each item in your library every day and when you open it.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                addField
                list
            }
            .padding(.horizontal, pagePadding)
            .padding(.top, 4)
            .padding(.bottom, 32)
        }
        .echoRoom(strength: 0.5, height: 520)
        .navigationTitle("Wanted")
        .clearBars()
        .task { await library.wanted.load() }
        .refreshable { await library.wanted.load() }
    }

    private var addField: some View {
        HStack(spacing: 10) {
            TextField("Artist and song, or an album", text: $text)
                .textFieldStyle(.plain)
                .submitLabel(.done)
                .onSubmit(add)
                .padding(.horizontal, 18)
                .frame(height: 46)
                .glassEffect(.regular, in: .capsule)
            Button("Add", action: add)
                .buttonStyle(.glassProminent)
                .tint(Color.echoAccent)
                .controlSize(.large)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    @ViewBuilder private var list: some View {
        if let items = library.wanted.items {
            if items.isEmpty {
                NoteCard(
                    icon: "music.note.list", title: "Nothing wanted yet",
                    text: "Add music that isn't in Navidrome here, or from a search that finds nothing.")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(items) { item in row(item) }
                }
            }
        } else if let failure = library.wanted.failure {
            ErrorCard(title: "Couldn't load the Wanted list", error: failure) {
                Task { await library.wanted.load() }
            }
        } else {
            LoadingView()
        }
    }

    private func row(_ item: WantedItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: item.found == nil ? "magnifyingglass" : "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(item.found == nil ? Color.secondary : Color.amber)
                .frame(width: 30)
            if let found = item.found, let albumId = found.album {
                NavigationLink(
                    value: Route.album(Album(id: albumId, title: found.kind == "album" ? found.title : "", artist: found.artist))
                ) {
                    texts(item)
                }
                .buttonStyle(.plain)
                Button("Play \(found.title)", systemImage: "play.fill") { play(found) }
                    .labelStyle(.iconOnly)
                    .echoGlass(circle: true)
            } else {
                texts(item)
            }
            if !library.listensOnly {
                Button("Remove \(item.text) from Wanted", systemImage: "xmark") { library.removeWanted(item) }
                    .labelStyle(.iconOnly)
                    .echoGlass(circle: true)
                    .tint(.white)
            }
        }
        .padding(.vertical, 10)
        .frame(minHeight: 66)
        .contextMenu {
            if !library.listensOnly {
                Button("Remove from Wanted", systemImage: "trash", role: .destructive) { library.removeWanted(item) }
            }
        }
    }

    private func texts(_ item: WantedItem) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.text).font(.body.weight(.semibold)).lineLimit(2)
            Text(item.found == nil ? "Not in Navidrome yet" : "In your library")
                .font(.footnote.weight(.medium))
                .foregroundStyle(item.found == nil ? Color.secondary : Color.amber)
            Text("Added by \(item.addedBy ?? "a former user") · \(Self.ago.localizedString(for: item.addedAt, relativeTo: .now))")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }

    private func add() {
        let wanted = text
        text = ""
        Task { await library.addWanted(wanted) }
    }

    /// What the library matched: an album from its start, a song in its album.
    private func play(_ found: WantedItem.Found) {
        guard let albumId = found.album else { return }
        Task {
            let album = Album(id: albumId, title: found.title, artist: found.artist)
            guard let tracks = await library.tracks(of: album) else { return }
            let index = found.kind == "song" ? (tracks.firstIndex { $0.id == found.id } ?? 0) : 0
            await player.play(tracks, at: index, context: PlayContext(kind: "album", id: albumId, title: found.title))
        }
    }
}
