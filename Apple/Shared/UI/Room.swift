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

extension Color {
    init(_ rgb: RGB) {
        self.init(red: rgb.r, green: rgb.g, blue: rgb.b)
    }
}

/// The room lit by an album (ECHO's Stage): its colours as a slow mesh of light. Without a palette,
/// the approved preview's Harbour Lights; with one, the same light from that album's cover.
struct AlbumLight: View {
    var strength: Double = 1
    var palette: AlbumPalette? = nil

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.42, 0.55], [1, 0.45],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: colors
        )
        .opacity(strength)
        .background(palette.map { Color($0.mesh[7]) } ?? Color.harbourNavy)
        .animation(.smooth(duration: 0.8), value: palette)
        .ignoresSafeArea()
    }

    private var colors: [Color] {
        guard let palette else {
            return [
                Color(hex: 0x1C4F7A), Color(hex: 0x173450), Color(hex: 0x2A5D8C),
                Color(hex: 0x6B5322), Color(hex: 0xC4964A).opacity(0.9), Color(hex: 0x163A5A),
                Color(hex: 0x081620), Color(hex: 0x0B1B2B), Color(hex: 0x081620),
            ]
        }
        return palette.mesh.enumerated().map { i, rgb in i == 4 ? Color(rgb).opacity(0.9) : Color(rgb) }
    }
}

/// A page in the room: the album's light at the top, its strength scaled by this device's
/// background brightness (Settings → Appearance; none set in the preview's windows: as designed) and
/// by the theme's (Liquid Glass lights it more and higher; a light variant washes it with its floor and a
/// theme with a caustic catches a glow from below). The floor is the album's own in the dark, the theme's
/// in the light.
struct RoomModifier: ViewModifier {
    var strength: Double
    var height: CGFloat
    var palette: AlbumPalette?
    var held: Bool
    @Environment(DeviceSettings.self) private var device: DeviceSettings?
    @Environment(\.theme) private var theme

    func body(content: Content) -> some View {
        let look = theme.palette
        let lit = min(1, (device?.roomStrength(strength) ?? strength) * look.roomStrength)
        content
            .background(alignment: .top) {
                ZStack {
                    AlbumLight(strength: lit, palette: palette)
                    if look.wash > 0 { theme.floor.opacity(look.wash).ignoresSafeArea() }
                }
                .frame(height: height * look.roomHeight)
                .mask(
                    LinearGradient(colors: held ? [.black, .black, .clear] : [.black, .clear], startPoint: .top, endPoint: .bottom))
                .ignoresSafeArea()
            }
            .background(alignment: .bottom) {
                if theme.glass.caustic > 0, theme.dark {
                    RadialGradient(
                        colors: [(palette.map { Color($0.accent) } ?? theme.tint).opacity(theme.glass.caustic), .clear],
                        center: .bottom, startRadius: 0, endRadius: 460
                    )
                    .frame(height: 460)
                    .ignoresSafeArea()
                }
            }
            .background(theme.dark ? (palette.map { Color($0.floor) } ?? theme.floor) : theme.floor)
            .animation(.smooth(duration: 0.8), value: palette)
    }
}

extension View {
    /// A page in the room: the album's light at the top, fading into the floor, under the bars.
    /// `held` keeps the light for longer before it fades (an album's page, as the preview's).
    func echoRoom(strength: Double = 0.55, height: CGFloat = 560, palette: AlbumPalette? = nil, held: Bool = false) -> some View {
        modifier(RoomModifier(strength: strength, height: height, palette: palette, held: held))
    }

    /// No bar backgrounds: the room runs under the status bar and the floating glass.
    func clearBars() -> some View {
        #if os(iOS)
        return toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        #else
        return self
        #endif
    }

    /// A pushed page's title sits small in the bar (the page shows it large itself).
    func inlineTitle() -> some View {
        #if os(iOS)
        return navigationBarTitleDisplayMode(.inline)
        #else
        return self
        #endif
    }
}

/// A line under the bars while ECHO cannot be used online: no network, or ECHO not answering.
struct ConnectionBanner: View {
    let connectivity: Connectivity
    @Environment(\.theme) private var theme

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
            Image(systemName: icon).font(.title3).foregroundStyle(theme.highlight)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .themedGlass(20)
        .accessibilityElement(children: .combine)
    }
}

/// A glass card that says something about a page: nothing here yet, or what goes here.
struct NoteCard: View {
    let icon: String
    let title: String
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(theme.highlight)
            Text(title).font(.title3.bold())
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
        .themedGlass(28)
        .accessibilityElement(children: .combine)
    }
}
