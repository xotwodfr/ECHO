import SwiftUI

/// The preview's session, library, player, lyrics and device settings (`-ECHODemo <screen>`), made
/// once: the window shows them, and on the Mac its Settings window too.
@MainActor
final class DemoWorld {
    let screen: String
    let session: Session
    let library: Library
    let player: Player
    let lyrics: Lyrics
    let device: DeviceSettings
    let invites: GuestInvites
    /// What is downloaded, on the screens that show downloads (DemoDownloads).
    let downloads: Downloads
    /// The scan screens' scan, in the state each shows.
    let scan: ScanFlow?

    init(screen: String) {
        self.screen = screen
        let now = Date.now.timeIntervalSince1970 * 1000
        let guest = screen == "guest-home" ? GuestPass(expiresAt: now + 18.4 * 3_600_000, invitedBy: "ada") : nil
        let session = Session.demo(
            server: Config.server, signedIn: screen != "signin" && screen != "guest-pass", serverAway: screen == "shell",
            guest: guest)
        self.session = session
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
        downloads = Downloads.demo(screen: screen)
        player = Player.demo(library: library, screen: screen, motion: MotionCovers.demo(loop: { device.motionLoop.seconds }))
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
        } else if world.screen == "guest-invite" {
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
            device: world.device, invites: world.invites, downloads: world.downloads, start: DemoLibrary.start(world.screen)
        )
        .environment(\.lyricsMenuOnOpen, world.screen == "lyrics-menu")
        .environment(\.motionPreviewFrame, 4)
        .environment(\.lockPreviewOnOpen, world.screen == "lockcover")
        .environment(\.settingsFocus, world.screen == "downloads-settings" ? "downloads" : nil)
        #if os(macOS)
        .task {
            guard ["settings", "guests", "downloads-settings"].contains(world.screen) else { return }
            try? await Task.sleep(for: .milliseconds(800))
            openSettings()
        }
        #endif
    }
}
