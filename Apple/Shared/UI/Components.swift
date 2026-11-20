import SwiftUI

// The library's pieces in the approved look (Apple/Screenshots, the preview's Apple/Shared/Preview):
// covers through the image loader, cards and shelves, song rows with their menu, the page header
// with the amber Play and the glass Shuffle, and the states between (loading, an error with Try
// Again, nothing here yet, a toast).

// MARK: - Navigation

/// A page the library opens on top of a tab, or of a Mac sidebar page.
enum Route: Hashable {
    /// An album as a list knows it; its songs load on the page.
    case album(Album)
    case artist(id: String, name: String?)
    case playlist(Playlist)
    case liked
    case wanted
    case mix(Mix)
    /// Settings (Home's account button on the iPhone).
    case settings
}

/// Opens a page on the current stack, from where a NavigationLink cannot be (a menu, a toast).
struct NavigateAction {
    let go: @MainActor (Route) -> Void

    @MainActor func callAsFunction(_ route: Route) { go(route) }
}

extension EnvironmentValues {
    @Entry var navigate: NavigateAction = NavigateAction(go: { _ in })
}

extension View {
    /// The library's pages, pushed on this stack.
    func libraryRoutes() -> some View {
        navigationDestination(for: Route.self) { RouteScreen(route: $0) }
    }

    /// A pushed page's title: the window's on the Mac; on the iPhone the page shows it large itself
    /// and the bar stays clear (the preview's album page).
    func pageTitle(_ title: String) -> some View {
        #if os(macOS)
        return navigationTitle(title)
        #else
        return navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

struct RouteScreen: View {
    let route: Route

    var body: some View {
        switch route {
        case .album(let album): AlbumScreen(start: album)
        case .artist(let id, let name): ArtistScreen(id: id, name: name)
        case .playlist(let playlist): PlaylistScreen(start: playlist)
        case .liked: LikedSongsScreen()
        case .wanted: WantedScreen()
        case .mix(let mix): MixScreen(mix: mix)
        case .settings: SettingsScreen()
        }
    }
}

// MARK: - Sizes

#if os(macOS)
/// A shelf card's width.
let cardWidth: CGFloat = 168
/// The space each side of a page.
let pagePadding: CGFloat = 28
/// The Play and Shuffle buttons' width (the Mac's are side by side under the title).
let playButtonWidth: CGFloat? = 120
#else
let cardWidth: CGFloat = 148
let pagePadding: CGFloat = 20
let playButtonWidth: CGFloat? = .infinity
#endif

/// "3:41".
func mmss(_ seconds: Int) -> String {
    String(format: "%d:%02d", seconds / 60, seconds % 60)
}

/// "26 min", "1 hr 12 min".
func length(ms: Int) -> String {
    let minutes = Int((Double(ms) / 60_000).rounded())
    return minutes >= 60 ? "\(minutes / 60) hr \(minutes % 60) min" : "\(minutes) min"
}

/// "1 song", "12 songs".
func songs(_ n: Int) -> String {
    n == 1 ? "1 song" : "\(n) songs"
}

extension Album {
    var context: PlayContext { PlayContext(kind: "album", id: id, title: title) }
}

// MARK: - Covers

/// A cover from ECHO by its server path, through the library's image loader (the bearer header,
/// memory and disk); a quiet tile while it loads, or when there is none.
struct Cover: View {
    let path: String?
    var corner: CGFloat = 12
    var round = false
    var symbol = "music.note"

    @Environment(Library.self) private var library
    @State private var loaded: Loaded? = nil

    private struct Loaded {
        let path: String
        let image: CoverImage
    }

    var body: some View {
        let image = shown
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    Image(decorative: image.cgImage, scale: 1)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        LinearGradient(
                            colors: [.white.opacity(0.13), .white.opacity(0.05)], startPoint: .topLeading,
                            endPoint: .bottomTrailing)
                        Image(systemName: symbol)
                            .font(.title2)
                            .foregroundStyle(.white.opacity(0.35))
                    }
                }
            }
            .clipShape(round ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: corner, style: .continuous)))
            .task(id: path) { await load() }
            .accessibilityHidden(true)
    }

    private var shown: CoverImage? {
        guard let path else { return nil }
        if let loaded, loaded.path == path { return loaded.image }
        return library.images.cached(path)
    }

    private func load() async {
        guard let path, loaded?.path != path else { return }
        if let image = await library.images.image(path) {
            loaded = Loaded(path: path, image: image)
        }
    }
}

/// Liked Songs' cover: violet to lilac, a white heart (the preview's).
struct LikedArt: View {
    var corner: CGFloat = 10

    var body: some View {
        LinearGradient(
            colors: [Color(hex: 0x6D4CFF), Color(hex: 0xC7B8FF)], startPoint: .topLeading, endPoint: .bottomTrailing
        )
        .aspectRatio(1, contentMode: .fit)
        .overlay {
            GeometryReader { g in
                Image(systemName: "heart.fill")
                    .font(.system(size: g.size.width * 0.36))
                    .foregroundStyle(.white)
                    .frame(width: g.size.width, height: g.size.height)
            }
        }
        .clipShape(.rect(cornerRadius: corner))
        .accessibilityHidden(true)
    }
}

/// The Wanted list's tile: a list on dark glass.
struct WantedArt: View {
    var corner: CGFloat = 10

    var body: some View {
        RoundedRectangle(cornerRadius: corner)
            .fill(.white.opacity(0.1))
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                GeometryReader { g in
                    Image(systemName: "music.note.list")
                        .font(.system(size: g.size.width * 0.34, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: g.size.width, height: g.size.height)
                }
            }
            .accessibilityHidden(true)
    }
}

/// A mix's cover: its first song's cover under a colour of its own, its title over it.
struct MixArt: View {
    let mix: Mix
    var corner: CGFloat = 14
    var titleFont: Font = .headline.weight(.heavy)

    var body: some View {
        Cover(path: mix.cover, corner: corner)
            .overlay {
                LinearGradient(colors: [hue.opacity(0.2), hue.opacity(0.9)], startPoint: .top, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                Text(mix.title)
                    .font(titleFont)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .padding(10)
            }
            .clipShape(.rect(cornerRadius: corner))
    }

    /// The same colour for the same mix, as the web's (a hash of its id).
    private var hue: Color {
        let h = mix.id.unicodeScalars.reduce(UInt32(7)) { $0 &* 31 &+ $1.value }
        return Color(hue: Double(h % 360) / 360, saturation: 0.65, brightness: 0.5)
    }
}

/// A playlist's cover: a mosaic of its first four albums when it has them (the web's), else one.
struct PlaylistArt: View {
    let cover: String?
    let covers: [String]
    var corner: CGFloat = 12

    var body: some View {
        if covers.count >= 4 {
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    Cover(path: covers[0], corner: 0)
                    Cover(path: covers[1], corner: 0)
                }
                GridRow {
                    Cover(path: covers[2], corner: 0)
                    Cover(path: covers[3], corner: 0)
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .clipShape(.rect(cornerRadius: corner))
        } else {
            Cover(path: cover ?? covers.first, corner: corner, symbol: "music.note.list")
        }
    }
}

// MARK: - Cards and shelves

/// A cover with a title and a line under it: a shelf's album, playlist, mix or artist.
struct Card<Art: View>: View {
    let title: String
    let subtitle: String
    var width: CGFloat? = cardWidth
    var centred = false
    @ViewBuilder let art: () -> Art

    var body: some View {
        VStack(alignment: centred ? .center : .leading, spacing: 3) {
            art()
                .padding(.bottom, 4)
            Text(title)
                .font(Self.titleFont)
                .lineLimit(1)
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(width: width, alignment: centred ? .center : .leading)
        .contentShape(.rect)
    }

    private static var titleFont: Font {
        #if os(macOS)
        return .callout.weight(.semibold)
        #else
        return .subheadline.weight(.semibold)
        #endif
    }
}

/// A row of cards under a title, scrolling sideways.
struct Shelf<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title2.bold())
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 14) { content }
            }
            .scrollIndicators(.never)
            .scrollClipDisabled()
        }
    }
}

/// Home's shortcut: a small cover and a bold title on a raised strip (the preview's).
struct ShortcutTile<Art: View>: View {
    let title: String
    @ViewBuilder let art: () -> Art

    var body: some View {
        HStack(spacing: 10) {
            art().frame(width: 56, height: 56)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .background(.white.opacity(0.08))
        .clipShape(.rect(cornerRadius: 12))
        .contentShape(.rect)
    }
}

/// A row of the Library: a cover, a title and what it is.
struct LibraryRow<Art: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let art: () -> Art

    var body: some View {
        HStack(spacing: 12) {
            art().frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold)).lineLimit(1)
                Text(subtitle).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 64)
        .contentShape(.rect)
    }
}

struct SectionTitle: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.title3.bold())
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Songs

/// A song: its number on an album (or the bars while it plays), its cover elsewhere, the title in
/// amber while it plays, a heart once liked, its length; tap plays, a long press opens its menu.
struct TrackRow: View {
    let track: Track
    var number: Int? = nil
    var art = false
    var showAlbum = true
    let play: () -> Void

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player

    var body: some View {
        let now = player.track?.key == track.key
        Button(action: play) {
            HStack(spacing: 14) {
                if art {
                    Cover(path: track.cover, corner: 8).frame(width: 48, height: 48)
                } else if let number {
                    Group {
                        if now {
                            Image(systemName: "chart.bar.fill").foregroundStyle(Color.amber)
                        } else {
                            Text("\(number)").foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    .frame(width: 26)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title)
                        .font(art ? .body.weight(.semibold) : .body)
                        .fontWeight(now ? .semibold : nil)
                        .foregroundStyle(now ? Color.amber : Color.primary)
                        .lineLimit(1)
                    if art || number == nil {
                        Text(track.artist).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if library.isLiked(track) {
                    Image(systemName: "heart.fill")
                        .font(.caption)
                        .foregroundStyle(Color.amber)
                        .accessibilityLabel("Liked")
                }
                Text(mmss(track.seconds))
                    .font(art ? .footnote : .body)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .frame(minHeight: art ? 64 : 54)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contextMenu { TrackMenu(track: track, showAlbum: showAlbum) }
    }
}

/// Songs one under another; a tap plays them from that one.
struct TrackList: View {
    let tracks: [Track]
    let context: PlayContext
    var numbered = true
    var art = false
    var showAlbum = true

    @Environment(Player.self) private var player

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(tracks.enumerated()), id: \.offset) { index, track in
                TrackRow(track: track, number: numbered ? index + 1 : nil, art: art, showAlbum: showAlbum) {
                    Task { await player.play(tracks, at: index, context: context) }
                }
            }
        }
    }
}

/// A song's menu (the web's and Android's): the queue, the heart, where it came from. Now Playing's
/// leaves out the queue (`queueing` false): the song is playing.
struct TrackMenu: View {
    let track: Track
    var showAlbum = true
    var queueing = true

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @Environment(\.navigate) private var navigate

    var body: some View {
        if queueing {
            Button("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") { player.playNext([track]) }
            Button("Add to Queue", systemImage: "text.line.last.and.arrowtriangle.forward") { player.addToQueue([track]) }
        }
        let liked = library.isLiked(track)
        Button(liked ? "Remove from Liked Songs" : "Add to Liked Songs", systemImage: liked ? "heart.slash" : "heart") {
            Task { await library.setLiked(track, !liked) }
        }
        if let artist = track.artists.first, let id = artist.id {
            Button("Go to Artist", systemImage: "music.microphone") { navigate(.artist(id: id, name: artist.name)) }
        }
        if showAlbum, let id = track.album.id {
            Button("Go to Album", systemImage: "square.stack") {
                navigate(.album(Album(id: id, title: track.album.title, artist: track.artist)))
            }
        }
    }
}

/// An album's menu (a card's long press, the album page's More): play it, the queue, saving it,
/// its artist. A list's album has no songs yet: they load when a choice needs them.
struct AlbumMenu: View {
    let album: Album

    @Environment(Library.self) private var library
    @Environment(Player.self) private var player
    @Environment(\.navigate) private var navigate

    var body: some View {
        Button("Play", systemImage: "play.fill") {
            Task { if let tracks = await library.tracks(of: album) { await player.play(tracks, at: 0, context: album.context) } }
        }
        Button("Shuffle", systemImage: "shuffle") {
            Task { if let tracks = await library.tracks(of: album) { await player.shuffle(tracks, context: album.context) } }
        }
        Button("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") {
            Task { if let tracks = await library.tracks(of: album) { player.playNext(tracks, label: album.title) } }
        }
        Button("Add to Queue", systemImage: "text.line.last.and.arrowtriangle.forward") {
            Task { if let tracks = await library.tracks(of: album) { player.addToQueue(tracks, label: album.title) } }
        }
        let saved = library.isSaved(album.id)
        Button(saved ? "Remove from Your Library" : "Save to Your Library", systemImage: saved ? "heart.slash" : "heart") {
            Task { await library.setSaved(album, !saved) }
        }
        if let id = album.artistId {
            Button("Go to Artist", systemImage: "music.microphone") { navigate(.artist(id: id, name: album.artist)) }
        }
    }
}

// MARK: - Glass buttons

extension View {
    /// A glass button with an amber label (the preview's Shuffle). The iPhone's system glass style;
    /// on the Mac the same glass drawn here, since the Mac's system style fills itself with the tint.
    func echoGlass(circle: Bool = false) -> some View {
        #if os(macOS)
        return buttonStyle(MacGlassButton(circle: circle))
        #else
        return buttonStyle(.glass).buttonBorderShape(circle ? .circle : .automatic)
        #endif
    }
}

#if os(macOS)
struct MacGlassButton: ButtonStyle {
    var circle = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.echoTint)
            .padding(.horizontal, circle ? 7 : 14)
            .padding(.vertical, 7)
            .glassEffect(.regular.interactive(), in: .capsule)
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(.capsule)
    }
}
#endif

// MARK: - Page header

/// The amber Play and the glass Shuffle (the preview's album page).
struct PlayButtons: View {
    var disabled = false
    let play: () -> Void
    let shuffle: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                Button(action: play) {
                    Label("Play", systemImage: "play.fill").frame(maxWidth: playButtonWidth)
                }
                .buttonStyle(.glassProminent)
                .tint(Color.echoAccent)
                Button(action: shuffle) {
                    Label("Shuffle", systemImage: "shuffle").frame(maxWidth: playButtonWidth)
                }
                .echoGlass()
            }
            .controlSize(.large)
            .font(.headline)
        }
        .disabled(disabled)
    }
}

/// A page's head: its cover with a shadow, the title, a line in amber (an album's artist), the
/// facts, and the actions. Stacked and centred on the iPhone; side by side on the Mac.
struct PageHeader<Art: View, Actions: View>: View {
    let title: String
    var subtitle: String? = nil
    var subtitleRoute: Route? = nil
    var facts: String? = nil
    var artWidth: CGFloat = 250
    @ViewBuilder let art: () -> Art
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        #if os(macOS)
        HStack(alignment: .bottom, spacing: 28) {
            art()
                .frame(width: 210, height: 210)
                .shadow(color: .black.opacity(0.45), radius: 24, y: 14)
            VStack(alignment: .leading, spacing: 6) {
                texts(.leading)
                actions().padding(.top, 10)
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
        #else
        VStack(spacing: 16) {
            art()
                .frame(width: artWidth, height: artWidth)
                .shadow(color: .black.opacity(0.5), radius: 30, y: 20)
                .padding(.top, 8)
            texts(.center)
            actions()
        }
        #endif
    }

    private func texts(_ alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 4) {
            Text(title)
                .font(Self.titleFont)
                .multilineTextAlignment(alignment == .center ? .center : .leading)
            if let subtitle, !subtitle.isEmpty {
                if let subtitleRoute {
                    NavigationLink(value: subtitleRoute) {
                        Text(subtitle).font(.title3.weight(.medium)).foregroundStyle(Color.amber)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(subtitle).font(.title3.weight(.medium)).foregroundStyle(Color.amber)
                }
            }
            if let facts, !facts.isEmpty {
                Text(facts)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(alignment == .center ? .center : .leading)
            }
        }
    }

    private static var titleFont: Font {
        #if os(macOS)
        return .largeTitle.bold()
        #else
        return .title2.bold()
        #endif
    }
}

// MARK: - States

struct LoadingView: View {
    var body: some View {
        ProgressView()
            .controlSize(.large)
            .tint(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 60)
    }
}

/// Something could not load: what, why, and Try Again.
struct ErrorCard: View {
    let title: String
    let error: ApiError
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color.amber)
            Text(title).font(.headline)
            Text(error.userMessage)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try Again", systemImage: "arrow.clockwise", action: retry)
                .echoGlass()
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
        .accessibilityElement(children: .contain)
    }
}

/// A message for a moment, over the bottom of the screen, with its action (Undo, Open).
struct ToastView: View {
    let toast: Toast

    var body: some View {
        HStack(spacing: 16) {
            Text(toast.message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .lineLimit(2)
            if let action = toast.action, let run = toast.run {
                Button(action) { run() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.amber)
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
        .glassEffect(.regular, in: .capsule)
    }
}

/// Where toasts show: above the tab bar on the iPhone, at the bottom of the page on the Mac.
struct ToastLayer: View {
    var bottom: CGFloat

    @Environment(Library.self) private var library

    var body: some View {
        ZStack {
            if let toast = library.toast {
                ToastView(toast: toast)
                    .padding(.horizontal, 20)
                    .padding(.bottom, bottom)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(.smooth, value: library.toast)
    }
}
