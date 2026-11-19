import SwiftUI

// The Liquid Glass preview (launch argument `-ECHODemo <screen>`): built-in albums, covers drawn in
// code after the web app's fixture covers (src/client/fixtures/covers), and the album-lit room, so
// the screens render with no server. Apple/Screenshots holds what the macOS runner's simulator and
// Mac draw from it (.github/workflows/apple.yml).

enum DemoCover: String, CaseIterable, Hashable {
    case harbour, paper, glass, exposure, signal
}

struct DemoSong: Identifiable, Hashable {
    let id: String
    let title: String
    let seconds: Int
}

struct DemoAlbum: Identifiable, Hashable {
    let id: String
    let title: String
    let artist: String
    let year: Int
    let genre: String
    let cover: DemoCover
    let songs: [DemoSong]

    var minutes: Int { songs.reduce(0) { $0 + $1.seconds } / 60 }
}

enum Demo {
    static let albums: [DemoAlbum] = [
        album("harbour", "Harbour Lights", "Lowfield", 2019, "Ambient", .harbour, [
            ("Ferry at Six", 221), ("Low Tide Radio", 252), ("Salt on the Window", 238),
            ("Lighthouse Keeper", 303), ("Moorings", 167), ("The Long Way Home", 380),
        ]),
        album("paper", "Paper Satellites", "The Quiet Hours", 2021, "Indie", .paper, [
            ("Orbit", 202), ("Folded Sky", 245), ("Ground Control to Nobody", 229), ("Weightless", 271),
        ]),
        album("glass", "Glass Weather", "Mira Sole", 2023, "Electronic", .glass, [
            ("Prism", 194), ("Heat Haze", 232), ("Neon Rain", 242), ("Refraction", 217),
        ]),
        album("exposure", "Long Exposure", "Field Ensemble", 2017, "Modern Classical", .exposure, [
            ("Aperture", 468), ("Grain", 542), ("Developing", 391),
        ]),
        album("signal", "Signal / Noise", "Ada Varga", 2024, "Electronic", .signal, [
            ("Carrier Wave", 213), ("Feedback Loop", 258), ("Ground Hum", 226),
        ]),
    ]

    static var harbour: DemoAlbum { albums[0] }
    static var nowPlaying: DemoSong { harbour.songs[0] }

    /// Placeholder lines written for the preview; the active one is lit word by word.
    static let lyrics = [
        "The ferry leaves at six",
        "and the harbour holds its breath",
        "Every light along the water calls your name",
        "I count them from the deck",
        "until the dark gives way",
        "to morning on the other side",
    ]
    static let activeLine = 2

    private static func album(
        _ id: String, _ title: String, _ artist: String, _ year: Int, _ genre: String,
        _ cover: DemoCover, _ songs: [(String, Int)]
    ) -> DemoAlbum {
        DemoAlbum(
            id: id, title: title, artist: artist, year: year, genre: genre, cover: cover,
            songs: songs.enumerated().map { DemoSong(id: "\(id)-\($0.offset)", title: $0.element.0, seconds: $0.element.1) })
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }

    /// The playing album's light (Harbour Lights): amber lamps over a navy harbour.
    static let amber = Color(hex: 0xF6D48A)
    static let harbourNavy = Color(hex: 0x10283E)
}

/// A fixture cover, drawn on a 300-unit square like the web app's SVGs.
struct CoverArt: View {
    let cover: DemoCover
    var corner: CGFloat = 12

    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 300
            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> Path {
                Path(CGRect(x: x * s, y: y * s, width: w * s, height: h * s))
            }
            func dot(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
                Path(ellipseIn: CGRect(x: (x - r) * s, y: (y - r) * s, width: 2 * r * s, height: 2 * r * s))
            }
            func poly(_ points: [(CGFloat, CGFloat)]) -> Path {
                var p = Path()
                p.addLines(points.map { CGPoint(x: $0.0 * s, y: $0.1 * s) })
                p.closeSubpath()
                return p
            }
            switch cover {
            case .harbour:
                ctx.fill(rect(0, 0, 300, 300), with: .color(Color(hex: 0x0F2233)))
                ctx.fill(rect(0, 190, 300, 110), with: .color(Color(hex: 0x081620)))
                ctx.fill(dot(70, 178, 7), with: .color(Color(hex: 0xF4C46A)))
                ctx.fill(dot(120, 182, 5), with: .color(Color(hex: 0xF4C46A)))
                ctx.fill(dot(205, 176, 9), with: .color(Color(hex: 0xF6D48A)))
                ctx.fill(rect(66, 196, 8, 70), with: .color(Color(hex: 0xF4C46A).opacity(0.35)))
                ctx.fill(rect(201, 196, 10, 84), with: .color(Color(hex: 0xF6D48A).opacity(0.35)))
            case .paper:
                ctx.fill(rect(0, 0, 300, 300), with: .color(Color(hex: 0xE9E4DA)))
                ctx.stroke(dot(150, 150, 88), with: .color(Color(hex: 0x1D1D1F)), lineWidth: 3 * s)
                ctx.fill(dot(150, 62, 12), with: .color(Color(hex: 0x1D1D1F)))
                ctx.fill(dot(226, 194, 8), with: .color(Color(hex: 0x1D1D1F)))
                ctx.fill(dot(84, 206, 5), with: .color(Color(hex: 0x1D1D1F)))
            case .glass:
                ctx.fill(rect(0, 0, 300, 300), with: .color(Color(hex: 0x2B1840)))
                ctx.fill(poly([(0, 210), (80, 120), (150, 180), (220, 90), (300, 160), (300, 300), (0, 300)]),
                         with: .color(Color(hex: 0xFF5FA2)))
                ctx.fill(poly([(0, 250), (90, 190), (170, 240), (300, 200), (300, 300), (0, 300)]),
                         with: .color(Color(hex: 0x45E0D0)))
            case .exposure:
                ctx.fill(rect(0, 0, 300, 300), with: .color(Color(hex: 0x7A7A78)))
                ctx.fill(rect(40, 40, 220, 220), with: .color(Color(hex: 0x9C9C99)))
                ctx.fill(rect(40, 148, 220, 4), with: .color(Color(hex: 0xD9D9D6)))
            case .signal:
                ctx.fill(rect(0, 0, 300, 300), with: .color(Color(hex: 0x13261A)))
                var wave = Path()
                wave.move(to: CGPoint(x: 20 * s, y: 150 * s))
                for i in 0..<5 {
                    let x0 = CGFloat(20 + i * 60)
                    wave.addQuadCurve(
                        to: CGPoint(x: (x0 + 60) * s, y: 150 * s),
                        control: CGPoint(x: (x0 + 30) * s, y: (i % 2 == 0 ? 60 : 240) * s))
                }
                ctx.stroke(wave, with: .color(Color(hex: 0x8FE388)), lineWidth: 6 * s)
                ctx.fill(dot(246, 64, 22), with: .color(Color(hex: 0xD7F5C2)))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(.rect(cornerRadius: corner))
        .accessibilityHidden(true)
    }
}

/// The room lit by the playing album (ECHO's Stage): its colours as a slow mesh of light.
struct AlbumLight: View {
    var strength: Double = 1

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.42, 0.55], [1, 0.45],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: [
                Color(hex: 0x1C4F7A), Color(hex: 0x173450), Color(hex: 0x2A5D8C),
                Color(hex: 0x6B5322), Color(hex: 0xC4964A).opacity(0.9), Color(hex: 0x163A5A),
                Color(hex: 0x081620), Color(hex: 0x0B1B2B), Color(hex: 0x081620),
            ]
        )
        .opacity(strength)
        .background(Color.harbourNavy)
        .ignoresSafeArea()
    }
}

func mmssDemo(_ seconds: Int) -> String {
    String(format: "%d:%02d", seconds / 60, seconds % 60)
}

/// The demo screen named on the command line (`-ECHODemo home`), if any.
var demoScreen: String? {
    UserDefaults.standard.string(forKey: "ECHODemo")
}
