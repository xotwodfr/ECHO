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

    init(screen: String) {
        self.screen = screen
        session = Session.demo(server: Config.server, signedIn: screen != "signin", serverAway: screen == "shell")
        let library = DemoLibrary.library(failing: screen == "shell")
        let device = DeviceSettings(defaults: nil)
        self.library = library
        self.device = device
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
/// speed; on the Mac its window), and `lockcover`, the iPhone's lock screen preview over it.
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
        RootView(
            session: world.session, library: world.library, player: world.player, lyrics: world.lyrics,
            device: world.device, start: DemoLibrary.start(world.screen)
        )
        .environment(\.lyricsMenuOnOpen, world.screen == "lyrics-menu")
        .environment(\.motionPreviewFrame, 4)
        .environment(\.lockPreviewOnOpen, world.screen == "lockcover")
        #if os(macOS)
        .task {
            guard world.screen == "settings" else { return }
            try? await Task.sleep(for: .milliseconds(800))
            openSettings()
        }
        #endif
    }
}
