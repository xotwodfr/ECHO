#if os(macOS)
import SwiftUI

// The Mac preview in macOS 26's Liquid Glass (Demo.swift): the system's floating glass sidebar,
// glass toolbar controls, the album grid, a glass player bar over the page, and the lyrics window
// lit by the album. `-ECHODemo library|lyrics`.

struct MacDemo: View {
    let screen: String

    var body: some View {
        Group {
            if screen == "lyrics" {
                MacLyrics()
            } else {
                MacLibrary()
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct MacLibrary: View {
    enum Item: Hashable { case home, search, albums, artists, liked, wanted, playlist(String) }

    @State private var selection: Item? = .albums
    @State private var sort = "Recently added"
    @State private var query = ""

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Label("Home", systemImage: "house").tag(Item.home)
                Label("Search", systemImage: "magnifyingglass").tag(Item.search)
                Section("Library") {
                    Label("Albums", systemImage: "square.stack").tag(Item.albums)
                    Label("Artists", systemImage: "music.microphone").tag(Item.artists)
                    Label("Liked Songs", systemImage: "heart").tag(Item.liked)
                    Label("Wanted", systemImage: "music.note.list").tag(Item.wanted)
                }
                Section("Playlists") {
                    Label("Late Ferries", systemImage: "music.note.list").tag(Item.playlist("ferries"))
                    Label("Rain on Glass", systemImage: "music.note.list").tag(Item.playlist("rain"))
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 220)
        } detail: {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 22)], spacing: 22) {
                    ForEach(Demo.albums) { album in
                        VStack(alignment: .leading, spacing: 6) {
                            CoverArt(cover: album.cover, corner: 10)
                            Text(album.title).font(.callout.weight(.semibold)).lineLimit(1)
                            Text(album.artist).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 28)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .background(alignment: .top) {
                AlbumLight(strength: 0.5).frame(height: 560).mask(
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                    .ignoresSafeArea()
            }
            .background(Color(hex: 0x101319))
            .overlay(alignment: .bottom) { MacPlayerBar().padding(16) }
            .navigationTitle("Albums")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Picker("Sort", selection: $sort) {
                        ForEach(["Recently added", "A–Z", "Year", "Most played"], id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .searchable(text: $query, placement: .toolbar, prompt: "Search")
        }
    }
}

struct MacPlayerBar: View {
    var body: some View {
        HStack(spacing: 16) {
            HStack(spacing: 12) {
                CoverArt(cover: Demo.harbour.cover, corner: 8).frame(width: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Demo.nowPlaying.title).font(.callout.weight(.semibold))
                    Text("\(Demo.harbour.artist) · \(Demo.harbour.title)").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(width: 250, alignment: .leading)
            VStack(spacing: 6) {
                HStack(spacing: 14) {
                    Button("Shuffle", systemImage: "shuffle") {}
                    Button("Previous", systemImage: "backward.fill") {}
                    Button("Pause", systemImage: "pause.fill") {}.font(.title2)
                    Button("Next", systemImage: "forward.fill") {}
                    Button("Repeat", systemImage: "repeat") {}
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                HStack(spacing: 8) {
                    Text("1:24")
                    ProgressView(value: 84, total: 221).tint(.white)
                    Text("3:41")
                }
                .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                .frame(maxWidth: 440)
            }
            .frame(maxWidth: .infinity)
            HStack(spacing: 10) {
                Button("Lyrics", systemImage: "quote.bubble") {}
                Button("Queue", systemImage: "list.bullet") {}
                Button("Volume", systemImage: "speaker.wave.2.fill") {}
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

struct MacLyrics: View {
    var body: some View {
        ZStack {
            AlbumLight()
            HStack(alignment: .center, spacing: 72) {
                VStack(alignment: .leading, spacing: 18) {
                    CoverArt(cover: Demo.harbour.cover, corner: 20)
                        .shadow(color: .black.opacity(0.45), radius: 34, y: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Demo.nowPlaying.title).font(.title.bold())
                        Text("\(Demo.harbour.artist) · \(Demo.harbour.title)").font(.title3).foregroundStyle(.secondary)
                    }
                    ProgressView(value: 84, total: 221).tint(.white)
                    GlassEffectContainer(spacing: 10) {
                        HStack(spacing: 10) {
                            ForEach([("backward.fill", "Previous", 48.0), ("pause.fill", "Pause", 60.0),
                                     ("forward.fill", "Next", 48.0), ("music.mic", "Karaoke", 48.0),
                                     ("list.bullet", "Queue", 48.0)], id: \.1) { icon, label, size in
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
                    }
                }
                .frame(width: 360)

                VStack(alignment: .leading, spacing: 26) {
                    ForEach(Array(Demo.lyrics.enumerated()), id: \.offset) { index, line in
                        if index == Demo.activeLine {
                            Text("\(Text("Every light along the ").foregroundStyle(.white))\(Text("water").foregroundStyle(LinearGradient(stops: [.init(color: .white, location: 0.55), .init(color: .white.opacity(0.45), location: 0.55)], startPoint: .leading, endPoint: .trailing)))\(Text(" calls your name").foregroundStyle(.white.opacity(0.45)))")
                                .font(.system(size: 46, weight: .heavy))
                                .shadow(color: Color.amber.opacity(0.45), radius: 22)
                        } else {
                            let distance = abs(index - Demo.activeLine)
                            Text(line)
                                .font(.system(size: 34, weight: .heavy))
                                .foregroundStyle(.white.opacity(distance == 1 ? 0.5 : 0.28))
                                .blur(radius: index < Demo.activeLine ? CGFloat(distance) * 0.8 : 0)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 80)
            .padding(.vertical, 56)
        }
        .overlay(alignment: .topTrailing) {
            Label("Word-synced · LRCLIB", systemImage: "info.circle")
                .font(.callout.weight(.medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .glassEffect()
                .padding(20)
        }
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
    }
}
#endif
