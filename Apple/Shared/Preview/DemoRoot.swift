import SwiftUI

/// What `-ECHODemo <screen>` shows: the real app around a session, a library and a player that never
/// reach the network (DemoLibrary, DemoPlayback), opened on a page: `home`, `shelves` (Home at Made
/// for you), `album`, `artist`, `playlist`, `mix`, `library`, `albums`, `artists`, `liked`, `wanted`,
/// `search`; `signin`, the sign-in page; `shell`, the app while ECHO is not answering (the banner and
/// the error states); with a song paused at 1:24, `mini` (Home with the mini player), `nowplaying`
/// and `queue` (Now Playing, and its Up next) on the iPhone and `player` (the player bar) on the Mac.
/// `lyrics` is the approved preview's (PhoneDemo, MacDemo) until the lyrics task builds it.
struct DemoRoot: View {
    let screen: String
    @State private var session: Session
    @State private var library: Library
    @State private var player: Player

    init(screen: String) {
        self.screen = screen
        let session = Session.demo(server: Config.server, signedIn: screen != "signin", serverAway: screen == "shell")
        _session = State(initialValue: session)
        let library = DemoLibrary.library(failing: screen == "shell")
        _library = State(initialValue: library)
        _player = State(initialValue: Player.demo(library: library, screen: screen))
    }

    var body: some View {
        switch screen {
        case "lyrics":
            #if os(iOS)
            PhoneDemo(screen: screen)
            #else
            MacDemo(screen: screen)
            #endif
        default:
            RootView(session: session, library: library, player: player, start: DemoLibrary.start(screen))
        }
    }
}
