import SwiftUI

// How a theme (Themes/Theme.swift) reaches the screens: the resolved theme is in the environment
// (`\.theme`), set once at the root from the user's choice (`UserSettings.appearance`), and every
// colour, surface and button reads it from there, so no screen holds a colour of its own. Now Playing
// and the lyrics sit on the album's colours and are always dark (`themedDark`, as Android's
// `forceDark`); the rest follows light or dark.

extension EnvironmentValues {
    /// The theme in use, in its light or dark variant.
    @Entry var theme: Theme.Resolved = .echoDark
}

extension Theme.Resolved {
    var tint: Color { Color(palette.tint) }
    var accent: Color { Color(palette.accent) }
    var highlight: Color { Color(palette.highlight) }
    var warning: Color { Color(palette.warning) }
    var floor: Color { Color(palette.floor) }
    var onAccent: Color { Color(palette.onAccent) }

    /// The scheme to ask the system for; nil leaves it to the system.
    var scheme: ColorScheme? { preferredDark.map { $0 ? .dark : .light } }
}

/// Puts the user's theme into the environment, with its colour scheme, tint and lyric look. Applied
/// once, at the root (`RootView`) and in the Mac's Settings window.
struct ThemeProvider: ViewModifier {
    let appearance: UserSettings.Appearance
    /// The system's scheme where the theme leaves it to the system (nothing is asked of it then).
    @Environment(\.colorScheme) private var system

    func body(content: Content) -> some View {
        let resolved = Theme.resolve(appearance, systemDark: system == .dark)
        content
            .environment(\.theme, resolved)
            .environment(\.lyricLook, resolved.theme.lyric.look)
            .preferredColorScheme(resolved.scheme)
            .tint(resolved.tint)
    }
}

/// A screen that is always dark: Now Playing, the lyrics, the scanner and the sheets over them.
struct ForcedDark: ViewModifier {
    @Environment(\.theme) private var theme

    func body(content: Content) -> some View {
        let dark = theme.forcedDark
        content
            .environment(\.theme, dark)
            .preferredColorScheme(.dark)
            .tint(dark.tint)
    }
}

extension View {
    func themed(_ appearance: UserSettings.Appearance) -> some View {
        modifier(ThemeProvider(appearance: appearance))
    }

    func themedDark() -> some View {
        modifier(ForcedDark())
    }

    /// A glass surface of the theme: the system's glass, tinted and rimmed with light where the theme
    /// does that. `radius` nil is a capsule.
    func themedGlass(_ radius: CGFloat? = nil, interactive: Bool = false) -> some View {
        modifier(ThemedGlass(radius: radius, interactive: interactive))
    }

    /// A row or a tile of a list: on glass of its own in a theme that lays glass under rows, else as
    /// it is.
    func themedRow(hPadding: CGFloat = 12) -> some View {
        modifier(ThemedRow(hPadding: hPadding))
    }
}

struct ThemedGlass: ViewModifier {
    let radius: CGFloat?
    let interactive: Bool
    @Environment(\.theme) private var theme

    func body(content: Content) -> some View {
        let glass = theme.glass
        let shape = radius.map { AnyShape(RoundedRectangle(cornerRadius: $0 * theme.shapes.card, style: .continuous)) } ?? AnyShape(Capsule())
        content
            .glassEffect(style, in: shape)
            .overlay {
                if glass.rim > 0 {
                    shape
                        .stroke(
                            LinearGradient(
                                colors: [.white.opacity(glass.rim), .white.opacity(glass.rim * 0.12), .white.opacity(glass.rim * 0.45)],
                                startPoint: .topLeading, endPoint: .bottomTrailing),
                            lineWidth: 1)
                        .allowsHitTesting(false)
                }
            }
    }

    private var style: Glass {
        var glass = Glass.regular
        if theme.glass.tint > 0 { glass = glass.tint(theme.tint.opacity(theme.glass.tint)) }
        if interactive { glass = glass.interactive() }
        return glass
    }
}

struct ThemedRow: ViewModifier {
    let hPadding: CGFloat
    @Environment(\.theme) private var theme

    func body(content: Content) -> some View {
        if theme.glass.rows {
            content
                .padding(.horizontal, hPadding)
                .themedGlass(CGFloat(theme.glass.rowRadius))
        } else {
            content
        }
    }
}

extension Theme.Resolved {
    /// The space between a list's rows: none on plain rows, a gap where each lies on glass.
    var rowSpacing: CGFloat { glass.rows ? 8 : 0 }
}
