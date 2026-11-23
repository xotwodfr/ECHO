import Foundation

/// Settings → Appearance → Clay in the dark (Android's `Prefs.clayDark` and `CLAY_DARK`): the colour of
/// Clay's dark variant: a deep shade of what is playing, or one of eight. This device's choice.
enum ClayDark {
    struct Option: Equatable, Sendable {
        let id: String
        let name: String
        let colour: RGB
    }

    static let album = "album"

    /// Android's eight (Prefs.kt).
    static let options: [Option] = [
        Option(id: "red", name: "Dark red", colour: RGB(0.769, 0.322, 0.369)),
        Option(id: "navy", name: "Navy", colour: RGB(0.361, 0.482, 0.82)),
        Option(id: "aubergine", name: "Aubergine", colour: RGB(0.608, 0.435, 0.769)),
        Option(id: "forest", name: "Forest", colour: RGB(0.353, 0.655, 0.482)),
        Option(id: "teal", name: "Teal", colour: RGB(0.31, 0.702, 0.69)),
        Option(id: "rust", name: "Rust", colour: RGB(0.816, 0.478, 0.31)),
        Option(id: "plum", name: "Plum", colour: RGB(0.761, 0.416, 0.635)),
        Option(id: "charcoal", name: "Charcoal", colour: RGB(0.643, 0.624, 0.682)),
    ]

    /// Used before an album's colour is known.
    static let fallback = options[0].colour

    /// A colour as clay: its hue, a clay's saturation and a mid brightness (Android's `asClay`).
    static func clay(_ colour: RGB) -> RGB {
        let c = colour.hsb
        return RGB(hue: c.hue, saturation: c.saturation < 0.08 ? 0.06 : 0.48, brightness: 0.74)
    }

    /// The tone for a choice: the album's colour as clay (the fallback until it is known), or the
    /// option's own.
    static func tone(choice: String, album albumColour: RGB?) -> RGB {
        if let option = options.first(where: { $0.id == choice }) { return option.colour }
        return albumColour.map(clay) ?? fallback
    }

    static func name(_ choice: String) -> String {
        options.first(where: { $0.id == choice })?.name ?? "The album"
    }
}
