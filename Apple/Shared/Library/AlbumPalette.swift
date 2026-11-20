import CoreGraphics
import Foundation

/// A colour as the room uses it, each part 0…1.
struct RGB: Hashable, Sendable {
    var r: Double
    var g: Double
    var b: Double

    init(_ r: Double, _ g: Double, _ b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    init(hue: Double, saturation: Double, brightness: Double) {
        let h = (hue - hue.rounded(.down)) * 6
        let s = min(1, max(0, saturation))
        let v = min(1, max(0, brightness))
        let i = Int(h) % 6
        let f = h - Double(Int(h))
        let p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f))
        switch i {
        case 0: self.init(v, t, p)
        case 1: self.init(q, v, p)
        case 2: self.init(p, v, t)
        case 3: self.init(p, q, v)
        case 4: self.init(t, p, v)
        default: self.init(v, p, q)
        }
    }

    /// Hue (0…1, red at 0), saturation and brightness.
    var hsb: (hue: Double, saturation: Double, brightness: Double) {
        let maxC = max(r, g, b), minC = min(r, g, b), d = maxC - minC
        var hue = 0.0
        if d > 0 {
            if maxC == r {
                hue = ((g - b) / d).truncatingRemainder(dividingBy: 6)
            } else if maxC == g {
                hue = (b - r) / d + 2
            } else {
                hue = (r - g) / d + 4
            }
            hue /= 6
            if hue < 0 { hue += 1 }
        }
        return (hue, maxC > 0 ? d / maxC : 0, maxC)
    }
}

/// An album's light, from its cover (the web's Stage and Android's AlbumPalette do it from the
/// server's palette; here the cover is at hand): its colour overall, and its most vivid colour. The
/// room is drawn from them as the approved preview's Harbour Lights is: the cover's colour dark
/// above, its vivid colour glowing in the middle, the floor nearly black.
struct AlbumPalette: Hashable, Sendable {
    /// The cover's colour overall (the average of its pixels).
    var base: RGB
    /// Its most vivid colour (saturated and bright).
    var accent: RGB

    init(base: RGB, accent: RGB) {
        self.base = base
        self.accent = accent
    }

    /// The colours of an image, from a 40 × 40 copy of it: fine enough that small bright parts (Harbour
    /// Lights' lamps) keep their colour.
    init?(_ image: CGImage) {
        let side = 40
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drawn else { return nil }
        var sum = (0.0, 0.0, 0.0)
        var count = 0.0
        var vivid: (RGB, Double)?
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let alpha = Double(pixels[i + 3]) / 255
            guard alpha > 0.5 else { continue }
            let c = RGB(Double(pixels[i]) / 255 / alpha, Double(pixels[i + 1]) / 255 / alpha, Double(pixels[i + 2]) / 255 / alpha)
            sum = (sum.0 + c.r, sum.1 + c.g, sum.2 + c.b)
            count += 1
            let (_, s, v) = c.hsb
            let score = s * v + v * 0.1
            if score > (vivid?.1 ?? -1) { vivid = (c, score) }
        }
        guard count > 0, let vivid else { return nil }
        self.init(base: RGB(sum.0 / count, sum.1 / count, sum.2 / count), accent: vivid.0)
    }

    /// The room's nine lights, a 3 × 3 mesh from the top left, row by row.
    var mesh: [RGB] {
        let b = base.hsb
        let a = accent.hsb
        let s = min(0.9, b.saturation * 1.2)
        func dark(_ v: Double) -> RGB { RGB(hue: b.hue, saturation: s, brightness: v) }
        func glow(_ v: Double, _ boost: Double) -> RGB {
            RGB(hue: a.hue, saturation: min(1, a.saturation * boost), brightness: v)
        }
        return [
            dark(0.48), dark(0.31), dark(0.55),
            glow(0.42, 1.15), glow(0.77, 1.05), dark(0.35),
            dark(0.12), dark(0.17), dark(0.12),
        ]
    }

    /// Below the light: the cover's colour, nearly black.
    var floor: RGB {
        let b = base.hsb
        return RGB(hue: b.hue, saturation: min(0.9, b.saturation * 1.2), brightness: 0.075)
    }
}
