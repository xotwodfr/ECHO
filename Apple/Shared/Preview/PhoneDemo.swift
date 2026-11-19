#if os(iOS)
import SwiftUI

// The approved preview's Now Playing and Lyrics in iOS 26's Liquid Glass (Demo.swift), and its mini
// player for the tab bar's bottom accessory, until the playback and lyrics tasks build the real ones
// (Home, Library, Search and the pages are the real app's: DemoRoot). `-ECHODemo nowplaying|lyrics`.

struct PhoneDemo: View {
    let screen: String

    var body: some View {
        Group {
            if screen == "lyrics" {
                PhoneLyrics()
            } else {
                PhoneNowPlaying()
            }
        }
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
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
        .foregroundStyle(.white)
        .tint(.white)
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

                GlassEffectContainer {
                    HStack(spacing: 22) {
                        transport("backward.fill", "Previous", size: 60)
                        transport("pause.fill", "Pause", size: 72)
                        transport("forward.fill", "Next", size: 60)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 6)
                    .glassEffect(.regular.interactive(), in: .capsule)
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

    /// One control in the transport capsule: at least 44 pt to tap, the capsule is the only glass.
    private func transport(_ icon: String, _ label: String, size: CGFloat) -> some View {
        Button {} label: {
            Image(systemName: icon)
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
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
#endif
