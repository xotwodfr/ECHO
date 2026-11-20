import Foundation

/// A theme: ECHO's room and glass in a look of its own. The user's choice is `UserSettings.appearance`
/// (the theme's id from the server's list, and light or dark), so it follows the account; this is what
/// each id means here: its colours in a light and a dark variant, how its room is lit, how its glass is
/// treated, the look of its lyrics and its UI sounds. The screens read the resolved one from the
/// environment (`\.theme`, UI/Theming.swift) and take every colour and surface from it.
///
/// Made so far: ECHO and Liquid Glass. The server knows the Android app's other ids too; one that is
/// not built here shows as ECHO (`Theme.of`), as "materialyou" always does. A theme is added to
/// `Theme.made` only when it is whole: its tokens, its lyric look and its sounds. The next ones, in
/// the owner's order: docs/superpowers/plans/2026-11-19-apple-apps.md ("Picking this up").
struct Theme: Equatable, Sendable, Identifiable {
    /// A theme's colours in one variant, light or dark.
    struct Palette: Equatable, Sendable {
        /// Tabs, links, toggles and the glass buttons' labels.
        var tint: RGB
        /// The prominent buttons' fill (Play).
        var accent: RGB
        /// The small marks: the playing song, a liked heart, a page's artist.
        var highlight: RGB
        /// Something went wrong.
        var warning: RGB
        /// The room's floor below the album's light.
        var floor: RGB
        /// × the strength of a page's album light, and × its height.
        var roomStrength: Double
        var roomHeight: Double
        /// How much of the floor's colour covers the light (a light variant's pastel), 0…1.
        var wash: Double
        /// The picker's miniature: the room at its top, in its middle and at its floor.
        var swatch: [RGB]
    }

    /// How a theme treats glass: ECHO's is the system's plain glass on its cards; Liquid Glass lights
    /// it, lays it under every row and makes its buttons refract.
    struct Glass: Equatable, Sendable {
        /// The theme's tint in the glass of cards (0 for none).
        var tint: Double
        /// A thin rim of light round a glass surface (0 for none).
        var rim: Double
        /// Rows and tiles lie on glass of their own.
        var rows: Bool
        /// Buttons are glass that refracts, in the accent (not filled with it).
        var refractive: Bool
        /// A soft light from below that the glass catches (0 for none).
        var caustic: Double
        /// The corner of a glass row.
        var rowRadius: Double
    }

    /// Whose lyric look the theme brings (LyricLook).
    enum Lyric: Equatable, Sendable { case echo, glass }

    /// Whose UI sounds the theme brings (none: only the haptics).
    enum Sounds: String, Equatable, Sendable { case none, glass }

    let id: UserSettings.ThemeID
    let name: String
    let blurb: String
    /// Light or dark when the user leaves it to the theme; nil: the system's.
    let defaultDark: Bool?
    let light: Palette
    let dark: Palette
    let glass: Glass
    let lyric: Lyric
    let sounds: Sounds

    func palette(dark isDark: Bool) -> Palette { isDark ? dark : light }

    // MARK: - The themes made

    /// ECHO: the album's light in a dark room, amber for what is chosen, plain glass. Dark unless the
    /// user says otherwise (Android's ECHO follows the system; here the approved look is the default).
    static let echo = Theme(
        id: .echo, name: "ECHO", blurb: "The album's light, in a dark room", defaultDark: true,
        light: Palette(
            tint: RGB(0.62, 0.38, 0.06), accent: RGB(0.78, 0.55, 0.16), highlight: RGB(0.60, 0.38, 0.05),
            warning: RGB(0.70, 0.15, 0.10), floor: RGB(0.953, 0.941, 0.918), roomStrength: 0.8, roomHeight: 1,
            wash: 0.5, swatch: [RGB(0.93, 0.80, 0.55), RGB(0.86, 0.80, 0.70), RGB(0.953, 0.941, 0.918)]),
        dark: Palette(
            tint: RGB(0.910, 0.714, 0.361), accent: RGB(0.769, 0.588, 0.290), highlight: RGB(0.965, 0.831, 0.541),
            warning: RGB(1, 0.706, 0.643), floor: RGB(0.047, 0.055, 0.075), roomStrength: 1, roomHeight: 1,
            wash: 0, swatch: [RGB(0.11, 0.31, 0.48), RGB(0.42, 0.33, 0.13), RGB(0.047, 0.055, 0.075)]),
        glass: Glass(tint: 0, rim: 0, rows: false, refractive: false, caustic: 0, rowRadius: 14),
        lyric: .echo, sounds: .none)

    /// Liquid Glass: ECHO's room lit by the album, brighter and taller, with glass over all of it: tinted
    /// cards with a rim of light, every row and tile on glass of its own, refracting buttons, a glow from
    /// below. Cool white and blue where ECHO is amber. Its lyrics are Android's Liquid glass style as far
    /// as the field's own words go (a bolder face, a wider glow, far lines held in frost) and its sounds
    /// that theme's tink and chimes.
    static let glass = Theme(
        id: .glass, name: "Liquid Glass", blurb: "Frosted glass over the album's colours", defaultDark: true,
        light: Palette(
            tint: RGB(0.12, 0.38, 0.72), accent: RGB(0.22, 0.48, 0.82), highlight: RGB(0.10, 0.34, 0.66),
            warning: RGB(0.70, 0.15, 0.10), floor: RGB(0.929, 0.949, 0.973), roomStrength: 0.95, roomHeight: 1.25,
            wash: 0.38, swatch: [RGB(0.62, 0.78, 0.95), RGB(0.80, 0.88, 0.96), RGB(0.929, 0.949, 0.973)]),
        dark: Palette(
            tint: RGB(0.690, 0.847, 1), accent: RGB(0.431, 0.671, 0.925), highlight: RGB(0.808, 0.906, 1),
            warning: RGB(1, 0.706, 0.643), floor: RGB(0.039, 0.063, 0.098), roomStrength: 1.35, roomHeight: 1.25,
            wash: 0, swatch: [RGB(0.17, 0.42, 0.70), RGB(0.30, 0.50, 0.68), RGB(0.039, 0.063, 0.098)]),
        glass: Glass(tint: 0.14, rim: 0.55, rows: true, refractive: true, caustic: 0.22, rowRadius: 16),
        lyric: .glass, sounds: .glass)

    /// The themes the picker offers, in its order.
    static let made: [Theme] = [.echo, .glass]

    /// The theme an id names; one not made here is ECHO.
    static func of(_ id: UserSettings.ThemeID) -> Theme {
        made.first { $0.id == id } ?? .echo
    }

    // MARK: - Resolving

    /// A theme with the variant in use: what the user's choice comes to, with the system's setting.
    struct Resolved: Equatable, Sendable {
        let theme: Theme
        /// The dark variant is in use.
        let dark: Bool
        /// The scheme to ask the system for: nil leaves it to the system.
        let preferredDark: Bool?

        var palette: Palette { theme.palette(dark: dark) }
        var glass: Glass { theme.glass }

        /// The same theme in its dark variant: Now Playing and the lyrics sit on the album's colours and
        /// are always dark (as Android's `forceDark`).
        var forcedDark: Resolved { Resolved(theme: theme, dark: true, preferredDark: true) }

        static let echoDark = Theme.resolve(UserSettings.Appearance(), systemDark: true)
    }

    /// The theme and variant for the user's choice: Light and Dark are fixed, System follows the
    /// device, and "the theme's" is its own default (the system's where it has none).
    static func resolve(_ appearance: UserSettings.Appearance, systemDark: Bool) -> Resolved {
        let theme = Theme.of(appearance.theme)
        let preferred: Bool?
        switch appearance.dark {
        case .light: preferred = false
        case .dark: preferred = true
        case .system: preferred = nil
        case .theme: preferred = theme.defaultDark
        }
        return Resolved(theme: theme, dark: preferred ?? systemDark, preferredDark: preferred)
    }
}

extension UserSettings.DarkMode {
    /// What Settings → Appearance calls each choice.
    var label: String {
        switch self {
        case .theme: "Theme's own"
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}

extension Theme.Lyric {
    var look: LyricLook {
        switch self {
        case .echo: .echo
        case .glass: .glass
        }
    }
}
