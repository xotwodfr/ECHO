import SwiftUI

// Karaoke mode's controls (docs/KARAOKE.md), as the web and Android lay them out: the Vocals slider
// (0 % is the instrumental, 100 % the song as recorded) with the Key under it (up or down by up to six
// semitones, same tempo) and a line saying where the karaoke version is. Now Playing and the
// lyrics show the panel while Karaoke is on; the Mac's player bar has the compact pair.

/// The Vocals slider, the Key and what Karaoke says, on a glass card (Now Playing, the Mac's lyrics).
struct KaraokePanel: View {
    var corner: CGFloat = 22

    @Environment(Player.self) private var player
    @Environment(\.theme) private var theme

    var body: some View {
        let karaoke = player.karaoke
        VStack(alignment: .leading, spacing: 6) {
            row("Vocals", icon: "music.mic", value: KaraokeMath.percent(karaoke.level)) {
                Slider(
                    value: Binding(get: { karaoke.level }, set: { karaoke.setLevel($0) }), in: 0...1
                )
                .tint(theme.accent)
                .accessibilityLabel("Vocals")
                .accessibilityValue(KaraokeMath.percent(karaoke.level))
            }
            row("Key", icon: "plusminus", value: KaraokeMath.keyValue(karaoke.key)) {
                Slider(
                    value: Binding(get: { Double(karaoke.key) }, set: { karaoke.setKey(Int($0.rounded())) }),
                    in: -Double(KaraokeMath.keyRange)...Double(KaraokeMath.keyRange), step: 1
                )
                .tint(theme.accent)
                .accessibilityLabel("Key")
                .accessibilityValue(KaraokeMath.keyText(karaoke.key))
            }
            if let note = KaraokeNote.text(status: karaoke.status, ahead: karaoke.ahead, server: karaoke.server) {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 30)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .themedGlass(corner)
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private func row(_ title: String, icon: String, value: String, @ViewBuilder slider: () -> some View) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            slider()
            Text(value)
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 46, alignment: .trailing)
        }
    }
}

/// The Karaoke button of Now Playing and the player bar: on or off, the accent's glass when on.
struct KaraokeButton: View {
    @Environment(Feedback.self) private var feedback: Feedback?
    @Environment(Player.self) private var player

    var body: some View {
        let on = player.karaoke.isOn
        Button(on ? "Karaoke on" : "Karaoke off", systemImage: "music.mic") {
            feedback?.toggle(!on)
            withAnimation(.smooth) { player.karaoke.setOn(!on) }
        }
        .labelStyle(.iconOnly)
        .glassToggle(on)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Karaoke's key as a menu (the Mac's bar): the shift shown, the choices Original and ±1…6.
struct KaraokeKeyMenu: View {
    @Environment(Player.self) private var player

    var body: some View {
        let karaoke = player.karaoke
        Menu {
            Picker(
                "Key",
                selection: Binding(get: { karaoke.key }, set: { karaoke.setKey($0) })
            ) {
                ForEach(Array((-KaraokeMath.keyRange...KaraokeMath.keyRange).reversed()), id: \.self) { key in
                    Text(KaraokeMath.keyText(key)).tag(key)
                }
            }
        } label: {
            Text("Key \(KaraokeMath.keyValue(karaoke.key))")
                .font(.caption.weight(.medium))
                .monospacedDigit()
        }
        .menuStyle(.button)
        .fixedSize()
        .accessibilityLabel("Key")
        .accessibilityValue(KaraokeMath.keyText(karaoke.key))
    }
}
