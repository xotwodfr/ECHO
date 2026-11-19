import SwiftUI

/// What `-ECHODemo <screen>` shows: the real app around a session and a library that never call the
/// server (DemoLibrary), opened on a page: `home`, `album`, `artist`, `playlist`, `library`,
/// `albums`, `artists`, `liked`, `wanted`, `search`; `signin`, the sign-in page; `shell`, the app
/// while ECHO is not answering (the banner and the error states). `nowplaying` and `lyrics` are the
/// approved preview's (PhoneDemo, MacDemo) until the playback and lyrics tasks build them.
struct DemoRoot: View {
    let screen: String
    @State private var session: Session
    @State private var library: Library
    @State private var player: Player

    init(screen: String) {
        self.screen = screen
        let session = Session.demo(server: Config.server, signedIn: screen != "signin", serverAway: screen == "shell")
        _session = State(initialValue: session)
        _library = State(initialValue: DemoLibrary.library(failing: screen == "shell"))
        _player = State(initialValue: Player(client: session.client))
    }

    var body: some View {
        switch screen {
        case "nowplaying", "lyrics":
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
