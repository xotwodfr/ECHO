import SwiftUI

// ECHO's look on iPhone and Mac, as the owner approved it on the Liquid Glass preview
// (Apple/Screenshots): the room lit by the album, full-bleed under the status bar and the floating
// glass, white controls on glass, amber as the accent. Shared by the real screens and the preview.

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }

    /// The playing album's light (Harbour Lights): amber lamps over a navy harbour.
    static let amber = Color(hex: 0xF6D48A)
    static let harbourNavy = Color(hex: 0x10283E)

    /// The tint of tabs and links, and the prominent buttons' amber (the preview's).
    static let echoTint = Color(hex: 0xE8B65C)
    static let echoAccent = Color(hex: 0xC4964A)
    /// The room's floor below the light.
    static let echoFloor = Color(hex: 0x0C0E13)
    /// A message that something went wrong, readable on the dark glass.
    static let echoWarning = Color(hex: 0xFFB4A4)
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

extension View {
    /// A page in the room: the album's light at the top, fading into the floor, under the bars.
    func echoRoom(strength: Double = 0.55, height: CGFloat = 560) -> some View {
        background(alignment: .top) {
            AlbumLight(strength: strength).frame(height: height).mask(
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                .ignoresSafeArea()
        }
        .background(Color.echoFloor)
    }
}

/// The app icon's mark (Apple/Shared/AppIcon.icon): a point of sound and three fading rings.
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

/// A line under the bars while ECHO cannot be used online: no network, or ECHO not answering.
struct ConnectionBanner: View {
    let connectivity: Connectivity

    var body: some View {
        switch connectivity.status {
        case .online:
            EmptyView()
        case .offline:
            banner("wifi.slash", "You're offline", "ECHO comes back when your connection does.")
        case .serverAway:
            banner("exclamationmark.icloud", "ECHO isn't answering", "Trying again every 20 seconds.")
        }
    }

    private func banner(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(Color.amber)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .accessibilityElement(children: .combine)
    }
}

/// Where a later part of the app goes: a glass card saying what will be here.
struct ComingSoon: View {
    let icon: String
    let title: String
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Color.amber)
            Text(title).font(.title3.bold())
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .accessibilityElement(children: .combine)
    }
}
