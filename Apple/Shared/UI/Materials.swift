import SwiftUI

// The material themes' surfaces (Android's ui/Matter.kt): what a card, a row, a bar or a page is made of
// in Clay, Yarn, Paper & origami and Retro hi-fi. Drawn here with gradients, strokes and small Canvas
// textures rather than Android's generated bitmaps, so they are the closest faithful version: the same
// colours, light and shade, seams, fibres and screws, not the same pixels (docs: "Picking this up").

extension Theme.Resolved {
    /// The colour a material is made of (its card, clay, wool, paper or aluminium).
    var paper: Color { Color(palette.paper ?? palette.floor) }
    var isMaterial: Bool { material != .glass }
}

/// One surface of the theme's material, in `shape`.
struct MaterialSurface: View {
    let material: Theme.Material
    let paper: Color
    let dark: Bool
    let shape: AnyShape

    var body: some View {
        switch material {
        case .clay:
            shape.fill(paper)
                .overlay {
                    shape.fill(LinearGradient(
                        stops: [.init(color: .white.opacity(dark ? 0.2 : 0.4), location: 0), .init(color: .clear, location: 0.5),
                                .init(color: .black.opacity(dark ? 0.3 : 0.12), location: 1)],
                        startPoint: .topLeading, endPoint: .bottomTrailing))
                }
                .overlay {
                    shape.stroke(
                        LinearGradient(colors: [.white.opacity(0.65), .clear, .black.opacity(0.2)], startPoint: .topLeading, endPoint: .bottomTrailing),
                        lineWidth: 1.5)
                }
                .shadow(color: .black.opacity(dark ? 0.5 : 0.2), radius: 7, x: 2, y: 5)
        case .yarn:
            shape.fill(paper)
                .overlay { KnitPattern(dark: dark).clipShape(shape) }
                .overlay {
                    shape.stroke(.white.opacity(dark ? 0.3 : 0.5), style: StrokeStyle(lineWidth: 1.2, dash: [5, 4])).padding(4)
                }
                .overlay { shape.stroke(.black.opacity(0.18), lineWidth: 1) }
                .shadow(color: .black.opacity(dark ? 0.45 : 0.22), radius: 6, x: 0, y: 4)
        case .paper:
            shape.fill(paper)
                .overlay { Fibres(dark: dark).clipShape(shape) }
                .overlay { shape.stroke(.black.opacity(0.14), lineWidth: 0.75) }
                .shadow(color: .black.opacity(0.25), radius: 0, x: 2, y: 2)
                .shadow(color: .black.opacity(0.16), radius: 8, x: 0, y: 6)
        case .hifi:
            shape.fill(LinearGradient(colors: [paper.mix(with: .white, by: 0.2), paper, paper.mix(with: .black, by: 0.2)], startPoint: .top, endPoint: .bottom))
                .overlay { BrushedLines().clipShape(shape) }
                .overlay {
                    shape.stroke(LinearGradient(colors: [.white.opacity(0.6), .black.opacity(0.4)], startPoint: .top, endPoint: .bottom), lineWidth: 1.5)
                }
                .overlay { Screws().clipShape(shape) }
                .shadow(color: .black.opacity(0.45), radius: 6, x: 0, y: 4)
        case .glass:
            shape.fill(paper)
        }
    }
}

/// The page under everything in a material theme: clay's warm ground with a soft light, yarn's knit,
/// paper's fibres, the hi-fi's wood veneer.
struct MaterialGround: View {
    let material: Theme.Material
    let ground: Color
    let dark: Bool

    var body: some View {
        ZStack {
            switch material {
            case .clay:
                ground
                RadialGradient(colors: [.white.opacity(dark ? 0.1 : 0.45), .clear], center: .top, startRadius: 0, endRadius: 520)
            case .yarn:
                ground
                KnitPattern(dark: dark).opacity(0.8)
            case .paper:
                ground
                Fibres(dark: dark)
            case .hifi:
                LinearGradient(colors: [ground.mix(with: .white, by: 0.08), ground, ground.mix(with: .black, by: 0.25)], startPoint: .top, endPoint: .bottom)
                WoodGrain()
            case .glass:
                ground
            }
        }
        .ignoresSafeArea()
    }
}

/// Knitted loops: rows of small V stitches, each lit on one side and shaded on the other.
struct KnitPattern: View {
    let dark: Bool

    var body: some View {
        Canvas { ctx, size in
            let w = 7.0, h = 6.0
            var y = 0.0
            var row = 0
            while y < size.height {
                var x = row % 2 == 0 ? 0.0 : -w / 2
                while x < size.width {
                    var v = Path()
                    v.move(to: CGPoint(x: x, y: y))
                    v.addLine(to: CGPoint(x: x + w / 2, y: y + h))
                    v.addLine(to: CGPoint(x: x + w, y: y))
                    ctx.stroke(v, with: .color(.white.opacity(dark ? 0.1 : 0.2)), lineWidth: 1.4)
                    var shade = Path()
                    shade.move(to: CGPoint(x: x + 1, y: y + 1.4))
                    shade.addLine(to: CGPoint(x: x + w / 2 + 1, y: y + h + 1.4))
                    ctx.stroke(shade, with: .color(.black.opacity(dark ? 0.22 : 0.1)), lineWidth: 1)
                    x += w
                }
                y += h
                row += 1
            }
        }
        .allowsHitTesting(false)
    }
}

/// Paper fibres: short faint strokes laid in a fixed scatter.
struct Fibres: View {
    let dark: Bool

    var body: some View {
        Canvas { ctx, size in
            var seed: UInt64 = 0x9E3779B97F4A7C15
            func next() -> Double {
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                return Double(seed >> 33) / Double(1 << 31)
            }
            let count = min(1400, Int(size.width * size.height / 500))
            for _ in 0..<count {
                let x = next() * size.width, y = next() * size.height
                let a = next() * Double.pi, l = 3 + next() * 7
                var p = Path()
                p.move(to: CGPoint(x: x, y: y))
                p.addLine(to: CGPoint(x: x + cos(a) * l, y: y + sin(a) * l))
                let light = next() > 0.5
                ctx.stroke(p, with: .color((light ? Color.white : Color.black).opacity(dark ? 0.07 : (light ? 0.35 : 0.06))), lineWidth: 0.7)
            }
        }
        .allowsHitTesting(false)
    }
}

/// Brushed aluminium: fine horizontal lines.
struct BrushedLines: View {
    var body: some View {
        Canvas { ctx, size in
            var seed: UInt64 = 42
            var y = 0.0
            while y < size.height {
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let a = Double(seed >> 33) / Double(1 << 31)
                var p = Path()
                p.move(to: CGPoint(x: 0, y: y))
                p.addLine(to: CGPoint(x: size.width, y: y))
                ctx.stroke(p, with: .color((a > 0.5 ? Color.white : Color.black).opacity(0.05 + 0.06 * a)), lineWidth: 0.6)
                y += 1.6
            }
        }
        .allowsHitTesting(false)
    }
}

/// Four screws, one in each corner of a panel big enough to have them.
struct Screws: View {
    var body: some View {
        GeometryReader { g in
            if g.size.height > 56 && g.size.width > 90 {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(RadialGradient(colors: [.white.opacity(0.7), .gray.opacity(0.6), .black.opacity(0.5)], center: .topLeading, startRadius: 0, endRadius: 6))
                        .overlay { Rectangle().fill(.black.opacity(0.5)).frame(width: 5, height: 0.8).rotationEffect(.degrees(Double(i) * 37 + 20)) }
                        .frame(width: 7, height: 7)
                        .position(x: i % 2 == 0 ? 10 : g.size.width - 10, y: i < 2 ? 10 : g.size.height - 10)
                }
            }
        }
        .allowsHitTesting(false)
    }
}

/// Wood veneer: long dark grain lines, uneven.
struct WoodGrain: View {
    var body: some View {
        Canvas { ctx, size in
            var seed: UInt64 = 7
            var y = 0.0
            while y < size.height {
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let a = Double(seed >> 33) / Double(1 << 31)
                var p = Path()
                p.move(to: CGPoint(x: 0, y: y))
                var x = 0.0
                while x < size.width {
                    x += 40
                    p.addLine(to: CGPoint(x: x, y: y + sin(x / 90 + a * 6) * (1 + 3 * a)))
                }
                ctx.stroke(p, with: .color(.black.opacity(0.05 + 0.12 * a)), lineWidth: 0.6 + a * 1.4)
                y += 3 + a * 9
            }
        }
        .allowsHitTesting(false)
    }
}

/// What the lyrics sit on in a material theme: Clay's slab, Yarn's hoop over green knit, Paper's notebook
/// page (blue rules, a red margin), the hi-fi's dark display in its bezel.
struct LyricPlate: View {
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = AnyShape(RoundedRectangle(cornerRadius: 30 * theme.shapes.card, style: .continuous))
        switch theme.material {
        case .clay:
            MaterialSurface(material: .clay, paper: theme.paper, dark: true, shape: shape)
        case .yarn:
            ZStack {
                MaterialSurface(material: .yarn, paper: Color(red: 0.2, green: 0.4, blue: 0.28), dark: true, shape: shape)
                shape.stroke(Color(red: 0.71, green: 0.55, blue: 0.35), lineWidth: 10)
                shape.stroke(.black.opacity(0.25), lineWidth: 1).padding(5)
            }
        case .paper:
            ZStack {
                MaterialSurface(material: .paper, paper: Color(red: 0.984, green: 0.973, blue: 0.949), dark: false, shape: shape)
                Canvas { ctx, size in
                    var y = 52.0
                    while y < size.height - 10 {
                        var p = Path()
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: size.width, y: y))
                        ctx.stroke(p, with: .color(Color(red: 0.55, green: 0.7, blue: 0.9).opacity(0.55)), lineWidth: 1)
                        y += 40
                    }
                    var m = Path()
                    m.move(to: CGPoint(x: 34, y: 0))
                    m.addLine(to: CGPoint(x: 34, y: size.height))
                    ctx.stroke(m, with: .color(Color(red: 0.88, green: 0.42, blue: 0.42).opacity(0.6)), lineWidth: 1.2)
                }
                .clipShape(shape)
                .allowsHitTesting(false)
            }
        case .hifi:
            ZStack {
                MaterialSurface(material: .hifi, paper: theme.paper, dark: true, shape: shape)
                shape.fill(Color(red: 0.03, green: 0.08, blue: 0.075)).padding(12)
                    .overlay { shape.stroke(Color(red: 0.2, green: 0.9, blue: 0.8).opacity(0.25), lineWidth: 1).padding(12) }
            }
        case .glass:
            EmptyView()
        }
    }
}

/// The lyrics' ground: the album's light, or a material theme's ground with its plate.
struct LyricsGround: View {
    var palette: AlbumPalette?
    var top: CGFloat
    var bottom: CGFloat
    var leading: CGFloat = 10
    @Environment(\.theme) private var theme

    var body: some View {
        if theme.isMaterial {
            ZStack {
                MaterialGround(material: theme.material, ground: theme.floor, dark: theme.dark)
                Color.clear.ignoresSafeArea().overlay {
                    LyricPlate()
                        .padding(.top, top - 8).padding(.bottom, bottom - 8)
                        .padding(.leading, leading).padding(.trailing, 10)
                }
            }
        } else {
            AlbumLight(palette: palette)
        }
    }
}
