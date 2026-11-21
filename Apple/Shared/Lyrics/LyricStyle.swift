import CoreText
import Foundation
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// How the lyrics look: the face, the inks, the sweep's edge and the glow, in one value the lyric
/// field reads (LYRICS_EXPERIENCE.md §5.1, §5.2, §14; stage.css). ECHO's own is `echo(palette:)`,
/// the web's colour roles taken from the playing album's light. The themes (each with its lyric
/// style) give their own; the screens take it from the environment's `lyricLook`.
struct LyricStyle: Equatable, Sendable {
    /// The face: the system's (nil) or one by its PostScript name, its weight, the active size in
    /// points (every line is set at it; distance is opacity and blur), its tracking (em) and line
    /// height (× the size).
    struct Face: Equatable, Sendable {
        var name: String? = nil
        /// The system face's design (rounded for Clay, serif for Yarn, monospaced for the hi-fi's display).
        var design = Design.standard
        var weight: Weight = .heavy
        var size: Double
        var tracking = -0.022
        var lineHeight = 1.12
        var lineHeightCJK = 1.2
    }

    enum Design: Equatable, Sendable { case standard, rounded, serif, mono }

    enum Weight: Equatable, Sendable {
        case semibold, bold, heavy, black
    }

    var face: Face
    /// The lines' ink (`--lyric-ink-active`).
    var ink: RGB
    /// The room the active line's unsung words lean toward (`--art-room`, §5.1).
    var room: RGB
    /// Sung words (`--lit`: warm white tinted by the cover).
    var lit: RGB
    /// The sweep's bright leading edge (`--art-highlight`).
    var edge: RGB
    /// The glow behind the word being sung (`--art-glow-solid`).
    var glow: RGB
    /// A duet's second voice is told apart by colour too: its lit ink 25% toward this (§5.6).
    var accent: RGB
    /// The soft edge, em ahead of and behind it (§5.1).
    var edgeAhead = LyricsConfig.Sweep.edgeAhead
    var edgeBehind = LyricsConfig.Sweep.edgeBehind
    /// The glow's radius × this (the glow is §5.2's, a theme may want more or none).
    var glowScale = 1.0
    /// How much of §4.1's depth blur the far lines get: 0.6 keeps the lines to come readable at
    /// these screens' density, as the approved preview has them; 0 where blur reads as a smudge
    /// (paper).
    var depthBlur = 0.6

    /// The unsung ink at distance mix `m` (0…0.22): toward the room.
    func unlit(_ m: Double) -> RGB { ink.mixed(with: room, m) }

    /// The lit ink, dying into the plain ink by `fade` once the line is sung (§7); the second voice
    /// of a duet leans toward the accent.
    func lit(fade: Double, secondVoice: Bool) -> RGB {
        let base = secondVoice ? lit.mixed(with: accent, 0.25) : lit
        return base.mixed(with: ink, fade)
    }

    /// ECHO's look: white words, the sweep's edge and glow in the album's own light (amber for
    /// Harbour Lights, the approved preview's), the unsung words leaning toward its dark.
    static func echo(palette: AlbumPalette?, size: Double) -> LyricStyle {
        let p = palette ?? .harbour
        let accent = p.accent.hsb
        let base = p.base.hsb
        let text = RGB(0.949, 0.945, 0.933)
        // --art-highlight: pale and warm; --art-glow: the cover's vivid colour, a little deeper.
        let highlight = RGB(hue: accent.hue, saturation: min(0.32, accent.saturation * 0.6), brightness: 0.98)
        return LyricStyle(
            face: Face(size: size),
            ink: RGB(0.98, 0.972, 0.957),
            room: RGB(hue: base.hue, saturation: min(0.6, base.saturation), brightness: 0.16),
            lit: text.mixed(with: highlight, 0.18),
            edge: highlight,
            glow: RGB(hue: accent.hue, saturation: min(1, max(0.35, accent.saturation * 1.1)), brightness: 0.86),
            accent: RGB(hue: accent.hue, saturation: min(1, accent.saturation), brightness: max(0.7, accent.brightness)),
            // A wider halo than the web's, so it shows on the phone's smaller type (the preview's glow).
            glowScale: 1.5)
    }

    /// The face at a size (points), as CoreText sets it and SwiftUI draws it.
    func font(_ points: Double) -> CTFont {
        if let name = face.name {
            return CTFontCreateWithName(name as CFString, CGFloat(points), nil)
        }
        #if canImport(UIKit)
        let weight: UIFont.Weight
        switch face.weight {
        case .semibold: weight = .semibold
        case .bold: weight = .bold
        case .heavy: weight = .heavy
        case .black: weight = .black
        }
        let base = UIFont.systemFont(ofSize: CGFloat(points), weight: weight)
        let design: UIFontDescriptor.SystemDesign
        switch face.design {
        case .standard: return base as CTFont
        case .rounded: design = .rounded
        case .serif: design = .serif
        case .mono: design = .monospaced
        }
        guard let descriptor = base.fontDescriptor.withDesign(design) else { return base as CTFont }
        return UIFont(descriptor: descriptor, size: CGFloat(points)) as CTFont
        #else
        let weight: NSFont.Weight
        switch face.weight {
        case .semibold: weight = .semibold
        case .bold: weight = .bold
        case .heavy: weight = .heavy
        case .black: weight = .black
        }
        let base = NSFont.systemFont(ofSize: CGFloat(points), weight: weight)
        let design: NSFontDescriptor.SystemDesign
        switch face.design {
        case .standard: return base as CTFont
        case .rounded: design = .rounded
        case .serif: design = .serif
        case .mono: design = .monospaced
        }
        guard let descriptor = base.fontDescriptor.withDesign(design) else { return base as CTFont }
        return (NSFont(descriptor: descriptor, size: CGFloat(points)) ?? base) as CTFont
        #endif
    }
}

/// Where the screens get the lyric style from: ECHO's by default; a theme brings its own.
struct LyricLook: Sendable {
    var make: @Sendable (AlbumPalette?, Double) -> LyricStyle

    static let echo = LyricLook { palette, size in LyricStyle.echo(palette: palette, size: size) }

    /// Liquid Glass's: ECHO's words in a bolder face, cooler and whiter, with a wider glow, the far
    /// lines held in more frost (Android's Liquid glass lyrics sing the line in a lens and blur the rest).
    static let glass = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .black
        style.ink = RGB(0.965, 0.98, 1)
        style.lit = style.lit.mixed(with: RGB(0.85, 0.93, 1), 0.4)
        style.edge = style.edge.mixed(with: RGB(0.9, 0.96, 1), 0.5)
        style.glowScale = 2.1
        style.depthBlur = 0.95
        return style
    }

    /// Apple Music style: plain white words, no glow, a bold face; the sweep is white.
    static let appleMusic = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .bold
        style.ink = RGB(1, 1, 1)
        style.lit = RGB(1, 1, 1)
        style.edge = RGB(1, 1, 1)
        style.glowScale = 0
        return style
    }

    /// Spotify style: the heaviest face, the sung words and the sweep's edge a pale green, a green glow.
    static let spotify = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .black
        style.lit = RGB(0.86, 1, 0.9)
        style.edge = RGB(0.45, 0.95, 0.65)
        style.glow = RGB(0.118, 0.843, 0.376)
        style.accent = RGB(0.118, 0.843, 0.376)
        style.glowScale = 1.2
        return style
    }

    /// Deezer style: a bold face with a purple edge and glow.
    static let deezer = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .bold
        style.edge = RGB(0.78, 0.55, 1)
        style.glow = RGB(0.635, 0.22, 1)
        style.accent = RGB(0.635, 0.22, 1)
        style.glowScale = 1.3
        return style
    }

    /// Qobuz style: a lighter, editorial face, no glow, the sweep a clean white.
    static let qobuz = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .semibold
        style.face.tracking = -0.01
        style.ink = RGB(0.93, 0.94, 0.96)
        style.edge = RGB(0.7, 0.82, 1)
        style.glowScale = 0.3
        style.depthBlur = 0.4
        return style
    }

    /// Tidal style: a bold face, a cyan edge and glow.
    static let tidal = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .heavy
        style.edge = RGB(0.5, 1, 0.96)
        style.glow = RGB(0.2, 1, 0.933)
        style.accent = RGB(0.2, 1, 0.933)
        style.glowScale = 1.1
        return style
    }

    /// YouTube Music style: a red edge and glow on a bold face.
    static let youtube = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .bold
        style.lit = RGB(1, 0.94, 0.94)
        style.edge = RGB(1, 0.45, 0.5)
        style.glow = RGB(1, 0, 0.2)
        style.accent = RGB(1, 0, 0.2)
        style.glowScale = 1.2
        return style
    }

    /// Monochrome: greys only, a soft grey glow.
    static let mono = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .bold
        style.ink = RGB(0.9, 0.9, 0.9)
        style.lit = RGB(1, 1, 1)
        style.edge = RGB(0.82, 0.82, 0.82)
        style.glow = RGB(0.55, 0.55, 0.55)
        style.accent = RGB(0.7, 0.7, 0.7)
        style.room = RGB(0.16, 0.16, 0.16)
        style.glowScale = 0.7
        return style
    }

    /// Clay: a round, fat face; sung words pale pink on the dark clay slab, a soft warm glow (Android's
    /// Clay lyrics extrude the sung words in four layers: here the face and the glow carry it).
    static let clay = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.design = .rounded
        style.face.weight = .black
        style.ink = RGB(0.965, 0.933, 0.969)
        style.room = RGB(0.35, 0.22, 0.3)
        style.lit = RGB(1, 0.86, 0.9)
        style.edge = RGB(1, 0.78, 0.86)
        style.glow = RGB(1, 0.6, 0.7)
        style.accent = RGB(1, 0.7, 0.78)
        style.glowScale = 0.8
        style.depthBlur = 0.35
        return style
    }

    /// Yarn (Android's Embroidered): a serif in cream thread on the hoop's green knit, the sung words
    /// in gold thread, the rest traced faintly.
    static let yarn = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.design = .serif
        style.face.weight = .heavy
        style.ink = RGB(0.96, 0.93, 0.84)
        style.room = RGB(0.12, 0.3, 0.2)
        style.lit = RGB(0.99, 0.82, 0.42)
        style.edge = RGB(1, 0.9, 0.6)
        style.glow = RGB(0.95, 0.75, 0.3)
        style.accent = RGB(0.95, 0.6, 0.35)
        style.glowScale = 0.5
        style.depthBlur = 0.2
        return style
    }

    /// Paper (Android's cut-out): hand-lettered on a notebook page, the sung words cut from coloured
    /// paper (a warm red), the words to come in pencil.
    static let paper = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.name = "Noteworthy-Bold"
        style.face.tracking = 0
        style.ink = RGB(0.3, 0.3, 0.33)
        style.room = RGB(0.62, 0.62, 0.66)
        style.lit = RGB(0.86, 0.38, 0.25)
        style.edge = RGB(0.95, 0.55, 0.38)
        style.glow = RGB(0.95, 0.55, 0.38)
        style.accent = RGB(0.3, 0.45, 0.75)
        style.glowScale = 0
        style.depthBlur = 0
        return style
    }

    /// Retro hi-fi (Android's display): a monospaced face lit like a teal VFD, the sung words glowing,
    /// the rest dim segments.
    static let hifi = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size * 0.9)
        style.face.design = .mono
        style.face.weight = .bold
        style.face.tracking = 0
        style.ink = RGB(0.22, 0.55, 0.52)
        style.room = RGB(0.05, 0.14, 0.13)
        style.lit = RGB(0.6, 1, 0.94)
        style.edge = RGB(0.85, 1, 0.98)
        style.glow = RGB(0.2, 0.95, 0.85)
        style.accent = RGB(1, 0.71, 0.28)
        style.glowScale = 1.8
        style.depthBlur = 0.3
        return style
    }

    /// SoundCloud style: a bold face with an orange edge and glow.
    static let soundcloud = LyricLook { palette, size in
        var style = LyricStyle.echo(palette: palette, size: size)
        style.face.weight = .bold
        style.lit = RGB(1, 0.94, 0.9)
        style.edge = RGB(1, 0.62, 0.38)
        style.glow = RGB(1, 0.333, 0)
        style.accent = RGB(1, 0.333, 0)
        style.glowScale = 1.4
        return style
    }
}

extension AlbumPalette {
    /// The approved preview's Harbour Lights: navy, its amber lamps.
    static let harbour = AlbumPalette(base: RGB(0.063, 0.157, 0.243), accent: RGB(0.965, 0.831, 0.541))
}

extension RGB {
    /// `color-mix(in oklab, self, other k)`: `k` of the way to `other`, in OKLab.
    func mixed(with other: RGB, _ k: Double) -> RGB {
        if k <= 0 { return self }
        if k >= 1 { return other }
        let a = oklab
        let b = other.oklab
        return RGB(oklab: (a.0 + (b.0 - a.0) * k, a.1 + (b.1 - a.1) * k, a.2 + (b.2 - a.2) * k))
    }

    private var oklab: (Double, Double, Double) {
        func lin(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        let r = lin(self.r), g = lin(self.g), b = lin(self.b)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return (
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)
    }

    private init(oklab c: (Double, Double, Double)) {
        let l = pow(c.0 + 0.3963377774 * c.1 + 0.2158037573 * c.2, 3)
        let m = pow(c.0 - 0.1055613458 * c.1 - 0.0638541728 * c.2, 3)
        let s = pow(c.0 - 0.0894841775 * c.1 - 1.2914855480 * c.2, 3)
        func srgb(_ v: Double) -> Double {
            let x = min(1, max(0, v))
            return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055
        }
        self.init(
            srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))
    }
}
