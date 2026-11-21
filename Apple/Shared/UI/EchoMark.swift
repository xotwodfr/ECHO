import SwiftUI

/// The app icon's mark (Apple/Shared/AppIcon.icon): a point of sound and three fading rings. In a
/// file of its own: the iPhone's widget extension draws it too (iOS/project.yml).
struct EchoMark: View {
    var body: some View {
        Canvas { ctx, size in
            // The icon's 1024-unit square: the point at (300, 512), the rings around it, ±54°.
            let s = size.width / 1024
            let centre = CGPoint(x: 300 * s, y: 512 * s)
            ctx.fill(
                Path(ellipseIn: CGRect(x: centre.x - 96 * s, y: centre.y - 96 * s, width: 192 * s, height: 192 * s)),
                with: .color(.white))
            let rings: [(radius: CGFloat, opacity: Double)] = [(235, 1), (375, 0.7), (520, 0.42)]
            for (radius, opacity) in rings {
                var ring = Path()
                for step in 0...48 {
                    let angle = (-54 + 108 * Double(step) / 48) * Double.pi / 180
                    let r: CGFloat = radius * s
                    let point = CGPoint(x: centre.x + r * CGFloat(cos(angle)), y: centre.y + r * CGFloat(sin(angle)))
                    if step == 0 { ring.move(to: point) } else { ring.addLine(to: point) }
                }
                ctx.stroke(
                    ring, with: .color(.white.opacity(opacity)),
                    style: StrokeStyle(lineWidth: 74 * s, lineCap: .round, lineJoin: .round))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
