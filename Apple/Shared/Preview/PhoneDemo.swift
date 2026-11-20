#if os(iOS)
import SwiftUI

// The approved preview's Lyrics in iOS 26's Liquid Glass (Demo.swift), until the lyrics task builds
// the real one (everything else is the real app's: DemoRoot). `-ECHODemo lyrics`.

struct PhoneDemo: View {
    let screen: String

    var body: some View {
        PhoneLyrics()
            .preferredColorScheme(.dark)
            .tint(Color.echoTint)
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
