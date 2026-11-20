import SwiftUI

/// The preview's session, library, player, lyrics and device settings (`-ECHODemo <screen>`), made
/// once: the window shows them, and on the Mac its Settings window too.
@MainActor
final class DemoWorld {
    let screen: String
    /// The screen it is a theme's look of: `theme-liquid-glass-lyrics` is the lyrics, `themes` the settings.
    let base: String
    let session: Session
    let library: Library
    let player: Player
    let lyrics: Lyrics
    let device: DeviceSettings
    let invites: GuestInvites
    /// The scan screens' scan, in the state each shows.
    let scan: ScanFlow?

    init(screen: String) {
        self.screen = screen
        let theme = DemoThemes.of(screen)
        let screen = theme?.base ?? screen
        base = screen
        let now = Date.now.timeIntervalSince1970 * 1000
        let guest = screen == "guest-home" ? GuestPass(expiresAt: now + 18.4 * 3_600_000, invitedBy: "ada") : nil
        let session = Session.demo(
            server: Config.server, signedIn: screen != "signin" && screen != "guest-pass", serverAway: screen == "shell",
            guest: guest)
        self.session = session
        if let appearance = theme?.appearance { session.demoAppearance(appearance) }
        invites = GuestInvites.demo(
            guests: [
                Guest(
                    id: 7, username: "guest-4f1c2a", invitedBy: "ada", createdAt: now - 5.6 * 3_600_000,
                    expiresAt: now + 18.4 * 3_600_000),
                Guest(
                    id: 8, username: "guest-9b03de", invitedBy: "ada", createdAt: now - 2 * 86_400_000,
                    expiresAt: now + 5.2 * 86_400_000, keep: KeepRequest(username: "sam", requestedAt: now - 600_000)),
            ],
            code: screen == "guest-invite"
                ? GuestCode(
                    code: "guest-code-for-tests-0001", url: "\(Config.server.absoluteString)/guest#guest-code-for-tests-0001",
                    expiresAt: now + 581_000, durationMs: 86_400_000)
                : nil)
        switch screen {
        case "scan": scan = ScanFlow.demo(purpose: .signInComputer, session: session, step: .scanning)
        case "approve":
            scan = ScanFlow.demo(
                purpose: .signInComputer, session: session,
                step: .computer(id: "qr-request-for-tests-0001", peek: LinkPeek(browser: "Chrome on Windows", ip: "203.0.113.0/24", expiresAt: now + 90_000)))
        case "guest-pass":
            scan = ScanFlow.demo(
                purpose: .joinAsGuest, session: session,
                step: .pass(code: "guest-code-for-tests-0001", peek: GuestPeek(invitedBy: "ada", durationMs: 86_400_000)))
        default: scan = nil
        }
        let library = DemoLibrary.library(failing: screen == "shell")
        let device = DeviceSettings(defaults: nil)
        self.library = library
        self.device = device
        player = Player.demo(
            library: library, screen: screen, motion: MotionCovers.demo(loop: { device.motionLoop.seconds }), device: device)
        lyrics = Lyrics.demo(screen: screen, library: library)
    }
}

/// What `-ECHODemo <screen>` shows: the real app around a session, a library and a player that never
/// reach the network (DemoLibrary, DemoPlayback), opened on a page: `home`, `shelves` (Home at Made
/// for you), `album`, `artist`, `playlist`, `mix`, `library`, `albums`, `artists`, `liked`, `wanted`,
/// `search`; `signin`, the sign-in page; `shell`, the app while ECHO is not answering (the banner and
/// the error states); with a song paused at 1:24, `mini` (Home with the mini player), `nowplaying`
/// and `queue` (Now Playing, and its Up next) on the iPhone and `player` (the player bar) on the Mac;
/// the lyrics (the web's lyric fixtures, Preview/Lyrics, at a fixed time as the web's `?frame=`):
/// `lyrics` (mid-line, a word sweeping), `lyrics-interlude` (the dots), `lyrics-plain` (unsynced) and
/// `lyrics-menu` (the credit's menu) over Now Playing on the iPhone, and `lyrics` over the Mac's window;
/// `settings`, Settings (on the iPhone a page, the lock screen's animated cover held at 4 s beside its
/// speed; on the Mac its window), and `lockcover`, the iPhone's lock screen preview over it; signing
/// in a computer and guests: `scan` (the scanner on a drawn camera), `approve` (a computer asking),
/// `guest-pass` (a guest pass scanned from the sign-in page), `guest-invite` (an invite's QR code),
/// `guests` (Settings → Guests; on the Mac in its Settings window) and `guest-home` (the app as a
/// guest: no hearts, the pass on Home).
struct DemoRoot: View {
    @State private var world: DemoWorld
    /// `karaoke-menu`: a song's menu, listed in a sheet (a menu cannot be held open for a screenshot).
    @State private var songMenu = false
    #if os(macOS)
    @Environment(\.openSettings) private var openSettings
    #endif

    init(screen: String) {
        _world = State(initialValue: DemoWorld(screen: screen))
    }

    init(world: DemoWorld) {
        _world = State(initialValue: world)
    }

    var body: some View {
        #if os(iOS)
        if let scan = world.scan {
            ScanScreen(flow: scan, camera: .demo) {}
                .environment(world.session)
        } else if world.base == "guest-invite" {
            InviteSheet {}
                .environment(world.invites)
        } else {
            root
        }
        #else
        root
        #endif
    }

    private var root: some View {
        RootView(
            session: world.session, library: world.library, player: world.player, lyrics: world.lyrics,
            device: world.device, invites: world.invites, start: DemoLibrary.start(world.base)
        )
        .environment(\.lyricsMenuOnOpen, world.base == "lyrics-menu")
        .environment(\.motionPreviewFrame, 4)
        .environment(\.lockPreviewOnOpen, world.base == "lockcover")
        .environment(\.settingsScroll, DemoLibrary.settingsScroll(world.base))
        .task {
            guard world.base == "karaoke-menu" else { return }
            try? await Task.sleep(for: .milliseconds(900))
            songMenu = true
        }
        .sheet(isPresented: $songMenu) {
            List { TrackMenu(track: DemoLibrary.track(Demo.harbour, 0)) }
                .environment(world.library)
                .environment(world.player)
                .environment(world.player.karaoke)
                .environment(world.device)
                .presentationDetents([.medium])
        }
        #if os(macOS)
        .task {
            guard world.base.hasPrefix("settings") || world.base == "guests" else { return }
            try? await Task.sleep(for: .milliseconds(800))
            openSettings()
        }
        #endif
    }
}

/// The `theme-…` demo screens and `themes`: the app (or Settings) in a theme, over the screen they
/// are named for: `themes` (Settings with the picker, in Liquid Glass), `theme-liquid-glass-home`,
/// `-nowplaying` and `-lyrics`, and `theme-light-home` (ECHO in its light variant).
enum DemoThemes {
    struct Look {
        let base: String
        let appearance: UserSettings.Appearance
    }

    static func of(_ screen: String) -> Look? {
        switch screen {
        case "themes": Look(base: "settings", appearance: .init(theme: .glass, dark: .theme))
        case "theme-liquid-glass-home": Look(base: "mini", appearance: .init(theme: .glass, dark: .theme))
        case "theme-liquid-glass-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .glass, dark: .theme))
        case "theme-liquid-glass-lyrics": Look(base: "lyrics", appearance: .init(theme: .glass, dark: .theme))
        case "theme-apple-music-home": Look(base: "mini", appearance: .init(theme: .apple, dark: .theme))
        case "theme-apple-music-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .apple, dark: .theme))
        case "theme-apple-music-lyrics": Look(base: "lyrics", appearance: .init(theme: .apple, dark: .theme))
        case "theme-spotify-home": Look(base: "mini", appearance: .init(theme: .spotify, dark: .theme))
        case "theme-spotify-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .spotify, dark: .theme))
        case "theme-spotify-lyrics": Look(base: "lyrics", appearance: .init(theme: .spotify, dark: .theme))
        case "theme-soundcloud-home": Look(base: "mini", appearance: .init(theme: .soundcloud, dark: .theme))
        case "theme-soundcloud-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .soundcloud, dark: .theme))
        case "theme-soundcloud-lyrics": Look(base: "lyrics", appearance: .init(theme: .soundcloud, dark: .theme))
        case "theme-deezer-home": Look(base: "mini", appearance: .init(theme: .deezer, dark: .theme))
        case "theme-deezer-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .deezer, dark: .theme))
        case "theme-deezer-lyrics": Look(base: "lyrics", appearance: .init(theme: .deezer, dark: .theme))
        case "theme-qobuz-home": Look(base: "mini", appearance: .init(theme: .qobuz, dark: .theme))
        case "theme-qobuz-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .qobuz, dark: .theme))
        case "theme-qobuz-lyrics": Look(base: "lyrics", appearance: .init(theme: .qobuz, dark: .theme))
        case "theme-tidal-home": Look(base: "mini", appearance: .init(theme: .tidal, dark: .theme))
        case "theme-tidal-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .tidal, dark: .theme))
        case "theme-tidal-lyrics": Look(base: "lyrics", appearance: .init(theme: .tidal, dark: .theme))
        case "theme-youtube-home": Look(base: "mini", appearance: .init(theme: .youtube, dark: .theme))
        case "theme-youtube-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .youtube, dark: .theme))
        case "theme-youtube-lyrics": Look(base: "lyrics", appearance: .init(theme: .youtube, dark: .theme))
        case "theme-monochrome-home": Look(base: "mini", appearance: .init(theme: .mono, dark: .theme))
        case "theme-monochrome-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .mono, dark: .theme))
        case "theme-monochrome-lyrics": Look(base: "lyrics", appearance: .init(theme: .mono, dark: .theme))
        case "theme-clay-home": Look(base: "mini", appearance: .init(theme: .clay, dark: .theme))
        case "theme-clay-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .clay, dark: .theme))
        case "theme-clay-lyrics": Look(base: "lyrics", appearance: .init(theme: .clay, dark: .theme))
        case "theme-yarn-home": Look(base: "mini", appearance: .init(theme: .yarn, dark: .theme))
        case "theme-yarn-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .yarn, dark: .theme))
        case "theme-yarn-lyrics": Look(base: "lyrics", appearance: .init(theme: .yarn, dark: .theme))
        case "theme-clay-dark-home": Look(base: "mini", appearance: .init(theme: .clay, dark: .dark))
        case "theme-clay-dark-lyrics": Look(base: "lyrics", appearance: .init(theme: .clay, dark: .dark))
        case "theme-paper-home": Look(base: "mini", appearance: .init(theme: .paper, dark: .theme))
        case "theme-paper-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .paper, dark: .theme))
        case "theme-paper-lyrics": Look(base: "lyrics", appearance: .init(theme: .paper, dark: .theme))
        case "theme-hifi-home": Look(base: "mini", appearance: .init(theme: .hifi, dark: .theme))
        case "theme-hifi-nowplaying": Look(base: "nowplaying", appearance: .init(theme: .hifi, dark: .theme))
        case "theme-hifi-lyrics": Look(base: "lyrics", appearance: .init(theme: .hifi, dark: .theme))
        case "theme-light-home": Look(base: "mini", appearance: .init(theme: .echo, dark: .light))
        default: nil
        }
    }
}
