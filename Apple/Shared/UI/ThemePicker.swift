import SwiftUI

/// Settings → Appearance → Theme: one small preview of each theme made, drawn from its own tokens in
/// the variant now in use (light or dark), the chosen one ringed. A choice is the user's: it is saved
/// to the account (`UserSettings.appearance.theme`, through the editor: one key, in order, put back
/// if the server refuses) and shows at once.
struct ThemePicker: View {
    let editor: SettingsEditor
    @Environment(\.theme) private var theme
    @Environment(Feedback.self) private var feedback: Feedback?

    private let columns = [GridItem(.adaptive(minimum: 120, maximum: 190), spacing: 14, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Theme")
            LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                ForEach(Theme.made) { option in
                    ThemeChoice(option: option, dark: theme.dark, selected: option.id == theme.theme.id) { choose(option) }
                }
            }
            .padding(.vertical, 4)
            SettingsHint("\(theme.theme.name): \(theme.theme.blurb). A theme brings its own glass, lyrics and sounds, and follows your account to every device.")
        }
        .padding(.vertical, 2)
    }

    private func choose(_ option: Theme) {
        guard option.id != theme.theme.id else { return }
        feedback?.confirm()
        editor.save { $0.appearance.theme = option.id }
    }
}

/// One theme in the picker: its miniature and its name.
struct ThemeChoice: View {
    let option: Theme
    let dark: Bool
    let selected: Bool
    let action: () -> Void

    var body: some View {
        let palette = option.palette(dark: dark)
        let line: Color = selected ? Color(palette.tint) : Color.primary.opacity(0.18)
        Button(action: action) {
            VStack(spacing: 8) {
                ThemeSwatch(option: option, dark: dark)
                    .frame(height: 152)
                    .clipShape(.rect(cornerRadius: 18, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(line, lineWidth: selected ? 3 : 1)
                    }
                HStack(spacing: 5) {
                    if selected {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(palette.tint))
                    }
                    Text(option.name).font(.footnote.weight(.semibold)).lineLimit(1)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(option.name), \(option.blurb)")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// A theme in miniature: its room (the floor and the album's light), two rows as it lays them (on glass
/// with a rim where it does that), the song playing in its highlight and its Play button.
struct ThemeSwatch: View {
    let option: Theme
    let dark: Bool

    var body: some View {
        let palette = option.palette(dark: dark)
        let ink: Color = dark ? .white : Color(hex: 0x2A2118)
        let glass = option.glass
        ZStack(alignment: .top) {
            Color(palette.floor)
            LinearGradient(colors: palette.swatch.map { Color($0) }, startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 7) {
                Capsule().fill(ink.opacity(0.9)).frame(width: 52, height: 7)
                Capsule().fill(ink.opacity(0.45)).frame(width: 34, height: 5)
                Spacer(minLength: 0)
                miniRow(palette: palette, ink: ink, playing: true, glass: glass)
                miniRow(palette: palette, ink: ink, playing: false, glass: glass)
                Spacer(minLength: 0)
                HStack {
                    Spacer()
                    Circle()
                        .fill(Color(palette.accent))
                        .frame(width: 26, height: 26)
                        .overlay { Image(systemName: "play.fill").font(.system(size: 10)).foregroundStyle(Color(palette.onAccent)) }
                    Spacer()
                }
            }
            .padding(12)
        }
        .accessibilityHidden(true)
    }

    private func miniRow(palette: Theme.Palette, ink: Color, playing: Bool, glass: Theme.Glass) -> some View {
        let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
        return HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3).fill(Color(palette.highlight).opacity(playing ? 1 : 0.5)).frame(width: 14, height: 14)
            VStack(alignment: .leading, spacing: 3) {
                Capsule().fill(playing ? Color(palette.highlight) : ink.opacity(0.8)).frame(width: 36, height: 4)
                Capsule().fill(ink.opacity(0.35)).frame(width: 24, height: 3)
            }
            Spacer(minLength: 0)
        }
        .padding(glass.rows ? 5 : 2)
        .background {
            if glass.rows {
                shape.fill(.white.opacity(dark ? 0.16 : 0.5))
                    .overlay { shape.strokeBorder(.white.opacity(glass.rim * 0.8), lineWidth: 0.75) }
            }
        }
    }
}
