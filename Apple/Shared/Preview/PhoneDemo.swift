#if os(iOS)
import SwiftUI

// The iPhone preview in iOS 26's Liquid Glass (Demo.swift): the system's own glass tab bar with
// Search as its separate role, the mini player as the tab bar's bottom accessory, glass toolbar
// and transport controls over the album's light. `-ECHODemo home|album|nowplaying|lyrics|library|search`.

struct PhoneDemo: View {
    enum Section: Hashable { case home, library, search }

    let screen: String
    @State private var tab: Section
    @State private var path: [DemoAlbum]
    @State private var query: String
    @State private var player = false

    init(screen: String) {
        self.screen = screen
        _tab = State(initialValue: screen == "library" ? .library : screen == "search" ? .search : .home)
        _path = State(initialValue: screen == "album" ? [Demo.harbour] : [])
        _query = State(initialValue: screen == "search" ? "harbour" : "")
    }

    var body: some View {
        Group {
            switch screen {
            case "nowplaying": PhoneNowPlaying()
            case "lyrics": PhoneLyrics()
            default: tabs
            }
        }
        .preferredColorScheme(.dark)
        .tint(Color(hex: 0xE8B65C))
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house.fill", value: Section.home) {
                NavigationStack(path: $path) {
                    PhoneHome()
                        .navigationDestination(for: DemoAlbum.self) { PhoneAlbum(album: $0) }
                }
            }
            Tab("Library", systemImage: "square.stack.fill", value: Section.library) {
                NavigationStack { PhoneLibrary() }
            }
            Tab("Search", systemImage: "magnifyingglass", value: Section.search, role: .search) {
                NavigationStack { PhoneSearch(query: $query) }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory {
            PhoneMiniPlayer().onTapGesture { player = true }
        }
        .fullScreenCover(isPresented: $player) { PhoneNowPlaying() }
    }
}

// MARK: - Home

struct PhoneHome: View {
    private let grid = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                LazyVGrid(columns: grid, spacing: 8) {
                    shortcut("Liked Songs") {
                        LinearGradient(colors: [Color(hex: 0x6D4CFF), Color(hex: 0xC7B8FF)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                            .overlay(Image(systemName: "heart.fill").foregroundStyle(.white))
                    }
                    ForEach(Demo.albums) { album in
                        NavigationLink(value: album) {
                            shortcutLabel(album.title) { CoverArt(cover: album.cover, corner: 0) }
                        }
                        .buttonStyle(.plain)
                    }
                }
                shelf("Recently played", Demo.albums)
                shelf("New in your library", Array(Demo.albums.reversed()))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(alignment: .top) {
            AlbumLight(strength: 0.55).frame(height: 560).mask(
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                .ignoresSafeArea()
        }
        .background(Color(hex: 0x0C0E13))
        .navigationTitle("Good evening")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Account", systemImage: "person.crop.circle") {}
            }
        }
    }

    private func shortcut<Art: View>(_ title: String, @ViewBuilder art: () -> Art) -> some View {
        shortcutLabel(title, art: art)
    }

    private func shortcutLabel<Art: View>(_ title: String, @ViewBuilder art: () -> Art) -> some View {
        HStack(spacing: 10) {
            art().frame(width: 56, height: 56)
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(2)
            Spacer(minLength: 0)
        }
        .background(.white.opacity(0.08))
        .clipShape(.rect(cornerRadius: 12))
    }

    private func shelf(_ title: String, _ albums: [DemoAlbum]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title2.bold())
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(albums) { album in
                        NavigationLink(value: album) {
                            VStack(alignment: .leading, spacing: 4) {
                                CoverArt(cover: album.cover, corner: 14).frame(width: 148)
                                Text(album.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(album.artist).font(.footnote).foregroundStyle(.secondary)
                            }
                            .frame(width: 148, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }
}

// MARK: - Album

struct PhoneAlbum: View {
    let album: DemoAlbum

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                CoverArt(cover: album.cover, corner: 18)
                    .frame(width: 250)
                    .shadow(color: .black.opacity(0.5), radius: 30, y: 20)
                    .padding(.top, 8)
                VStack(spacing: 4) {
                    Text(album.title).font(.title2.bold())
                    Text(album.artist).font(.title3.weight(.medium)).foregroundStyle(Color.amber)
                    Text("\(album.genre) · \(String(album.year)) · \(album.songs.count) songs, \(album.minutes) min")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                GlassEffectContainer(spacing: 12) {
                    HStack(spacing: 12) {
                        Button {} label: {
                            Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                        .tint(Color(hex: 0xC4964A))
                        Button {} label: {
                            Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                    }
                    .controlSize(.large)
                    .font(.headline)
                }
                VStack(spacing: 0) {
                    ForEach(Array(album.songs.enumerated()), id: \.element.id) { index, song in
                        HStack(spacing: 14) {
                            Group {
                                if index == 0 {
                                    Image(systemName: "chart.bar.fill").foregroundStyle(Color.amber)
                                } else {
                                    Text("\(index + 1)").foregroundStyle(.secondary)
                                }
                            }
                            .frame(width: 24)
                            Text(song.title)
                                .fontWeight(index == 0 ? .semibold : .regular)
                                .foregroundStyle(index == 0 ? Color.amber : .primary)
                            Spacer()
                            Text(mmssDemo(song.seconds)).foregroundStyle(.secondary).monospacedDigit()
                        }
                        .frame(height: 54)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .background(alignment: .top) {
            AlbumLight(strength: 0.85).frame(height: 760).mask(
                LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
                .ignoresSafeArea()
        }
        .background(Color(hex: 0x0B1520))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add to Library", systemImage: "plus") {}
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                Menu("More", systemImage: "ellipsis") {
                    Button("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") {}
                    Button("Start Radio", systemImage: "dot.radiowaves.left.and.right") {}
                }
            }
        }
    }
}

// MARK: - Mini player (the tab bar's accessory)

struct PhoneMiniPlayer: View {
    var body: some View {
        HStack(spacing: 10) {
            CoverArt(cover: Demo.harbour.cover, corner: 8).frame(width: 34)
            VStack(alignment: .leading, spacing: 0) {
                Text(Demo.nowPlaying.title).font(.subheadline.weight(.semibold))
                Text(Demo.harbour.artist).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Pause", systemImage: "pause.fill") {}.labelStyle(.iconOnly)
            Button("Next", systemImage: "forward.fill") {}.labelStyle(.iconOnly)
        }
        .font(.title3)
        .padding(.horizontal, 14)
    }
}

// MARK: - Now Playing

struct PhoneNowPlaying: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            AlbumLight()
            VStack(spacing: 22) {
                HStack {
                    Button("Close", systemImage: "chevron.down") { dismiss() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                    Spacer()
                    VStack(spacing: 0) {
                        Text("PLAYING FROM ALBUM").font(.caption2).foregroundStyle(.secondary)
                        Text(Demo.harbour.title).font(.footnote.bold())
                    }
                    Spacer()
                    Button("More", systemImage: "ellipsis") {}
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                }
                .controlSize(.large)

                CoverArt(cover: Demo.harbour.cover, corner: 22)
                    .shadow(color: .black.opacity(0.45), radius: 34, y: 24)

                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Demo.nowPlaying.title).font(.title2.bold())
                        Text(Demo.harbour.artist).font(.title3).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Love", systemImage: "heart.fill") {}
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .tint(Color.amber)
                        .controlSize(.large)
                }

                VStack(spacing: 6) {
                    ProgressView(value: 84, total: 221).tint(.white)
                    HStack {
                        Text("1:24")
                        Spacer()
                        Text("-2:17")
                    }
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }

                GlassEffectContainer(spacing: 18) {
                    HStack(spacing: 18) {
                        transport("backward.fill", "Previous", size: 64)
                        transport("pause.fill", "Pause", size: 84)
                        transport("forward.fill", "Next", size: 64)
                    }
                }

                Spacer(minLength: 0)

                HStack {
                    ForEach([("quote.bubble", "Lyrics"), ("airplay.audio", "AirPlay"),
                             ("music.mic", "Karaoke"), ("list.bullet", "Queue")], id: \.1) { icon, label in
                        Button(label, systemImage: icon) {}
                            .labelStyle(.iconOnly)
                            .buttonStyle(.glass)
                            .buttonBorderShape(.circle)
                            .controlSize(.extraLarge)
                        if label != "Queue" { Spacer() }
                    }
                }
            }
            .padding(.horizontal, 26)
            .padding(.top, 8)
            .padding(.bottom, 12)
        }
        .preferredColorScheme(.dark)
    }

    private func transport(_ icon: String, _ label: String, size: CGFloat) -> some View {
        Button {} label: {
            Image(systemName: icon)
                .font(.system(size: size * 0.38, weight: .semibold))
                .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel(label)
    }
}

// MARK: - Lyrics

struct PhoneLyrics: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            AlbumLight()
            VStack(alignment: .leading, spacing: 22) {
                ForEach(Array(Demo.lyrics.enumerated()), id: \.offset) { index, line in
                    lyric(line, index: index)
                }
            }
            .padding(.horizontal, 28)
            .frame(maxHeight: .infinity, alignment: .center)
            .padding(.bottom, 120)

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    CoverArt(cover: Demo.harbour.cover, corner: 10).frame(width: 46)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(Demo.nowPlaying.title).font(.subheadline.weight(.semibold))
                        Text(Demo.harbour.artist).font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Previous", systemImage: "backward.fill") {}
                    Button("Pause", systemImage: "pause.fill") {}.font(.title)
                    Button("Next", systemImage: "forward.fill") {}
                }
                .labelStyle(.iconOnly)
                .font(.title3)
                .foregroundStyle(.white)
                ProgressView(value: 84, total: 221).tint(.white)
            }
            .padding(16)
            .glassEffect(.regular, in: .rect(cornerRadius: 30))
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .overlay(alignment: .top) {
            HStack {
                Button("Close", systemImage: "chevron.down") {}
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                Spacer()
                Label("Word-synced · LRCLIB", systemImage: "info.circle")
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .glassEffect()
            }
            .padding(.horizontal, 16)
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func lyric(_ line: String, index: Int) -> some View {
        let distance = abs(index - Demo.activeLine)
        if index == Demo.activeLine {
            // The sung words lit, the word being sung half lit, the rest waiting.
            Text("\(Text("Every light along the ").foregroundStyle(.white))\(Text("water").foregroundStyle(LinearGradient(stops: [.init(color: .white, location: 0.55), .init(color: .white.opacity(0.45), location: 0.55)], startPoint: .leading, endPoint: .trailing)))\(Text(" calls your name").foregroundStyle(.white.opacity(0.45)))")
                .font(.system(size: 34, weight: .heavy))
                .shadow(color: Color.amber.opacity(0.45), radius: 18)
        } else {
            Text(line)
                .font(.system(size: 26, weight: .heavy))
                .foregroundStyle(.white.opacity(distance == 1 ? 0.5 : 0.28))
                .blur(radius: index < Demo.activeLine ? CGFloat(distance) * 0.8 : 0)
        }
    }
}

// MARK: - Library

struct PhoneLibrary: View {
    @State private var filter = "Albums"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
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
                VStack(spacing: 0) {
                    row(title: "Liked Songs", sub: "Playlist · 48 songs") {
                        LinearGradient(colors: [Color(hex: 0x6D4CFF), Color(hex: 0xC7B8FF)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                            .overlay(Image(systemName: "heart.fill").foregroundStyle(.white))
                            .clipShape(.rect(cornerRadius: 10))
                    }
                    row(title: "Wanted", sub: "List · 3 items · 1 in your library") {
                        RoundedRectangle(cornerRadius: 10).fill(.white.opacity(0.1))
                            .overlay(Image(systemName: "music.note.list"))
                    }
                    ForEach(Demo.albums) { album in
                        row(title: album.title, sub: "Album · \(album.artist)") {
                            CoverArt(cover: album.cover, corner: 10)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
        }
        .background(alignment: .top) {
            LinearGradient(colors: [Color(hex: 0x3A2A80).opacity(0.6), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 380).ignoresSafeArea()
        }
        .background(Color(hex: 0x0C0E13))
        .navigationTitle("Library")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Sort", systemImage: "arrow.up.arrow.down") {} }
            ToolbarItem(placement: .topBarTrailing) { Button("New Playlist", systemImage: "plus") {} }
        }
    }

    private func row<Art: View>(title: String, sub: String, @ViewBuilder art: () -> Art) -> some View {
        HStack(spacing: 12) {
            art().frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold))
                Text(sub).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .frame(height: 64)
    }
}

// MARK: - Search

struct PhoneSearch: View {
    @Binding var query: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if query.isEmpty {
                    Text("Search your library").foregroundStyle(.secondary)
                } else {
                    Text("Top result").font(.title3.bold())
                    HStack(spacing: 14) {
                        CoverArt(cover: Demo.harbour.cover, corner: 12).frame(width: 84)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(Demo.harbour.title).font(.title3.bold())
                            Text("Album · \(Demo.harbour.artist)").font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Play", systemImage: "play.fill") {}
                            .labelStyle(.iconOnly)
                            .buttonStyle(.glassProminent)
                            .buttonBorderShape(.circle)
                            .tint(Color(hex: 0xC4964A))
                            .controlSize(.large)
                    }
                    .padding(14)
                    .background(.white.opacity(0.08), in: .rect(cornerRadius: 18))

                    Text("Songs").font(.title3.bold())
                    ForEach([0, 3, 4], id: \.self) { i in
                        let song = Demo.harbour.songs[i]
                        HStack(spacing: 12) {
                            CoverArt(cover: .harbour, corner: 8).frame(width: 48)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(song.title).font(.body.weight(.semibold))
                                Text(Demo.harbour.artist).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(mmssDemo(song.seconds)).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(alignment: .top) {
            AlbumLight(strength: 0.45).frame(height: 560).mask(
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                .ignoresSafeArea()
        }
        .background(Color(hex: 0x0C0E13))
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Artists, songs, albums")
    }
}
#endif
