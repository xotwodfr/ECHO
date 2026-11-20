import SwiftUI

/// What `-ECHODemo <screen>` shows: the real app around a session, a library and a player that never
/// reach the network (DemoLibrary, DemoPlayback), opened on a page: `home`, `shelves` (Home at Made
/// for you), `album`, `artist`, `playlist`, `mix`, `library`, `albums`, `artists`, `liked`, `wanted`,
/// `search`; `signin`, the sign-in page; `shell`, the app while ECHO is not answering (the banner and
/// the error states); with a song paused at 1:24, `mini` (Home with the mini player), `nowplaying`
/// and `queue` (Now Playing, and its Up next) on the iPhone and `player` (the player bar) on the Mac;
/// the lyrics (the web's lyric fixtures, Preview/Lyrics, at a fixed time as the web's `?frame=`):
/// `lyrics` (mid-line, a word sweeping), `lyrics-interlude` (the dots), `lyrics-plain` (unsynced) and
/// `lyrics-menu` (the credit's menu) over Now Playing on the iPhone, and `lyrics` over the Mac's window.
struct DemoRoot: View {
    let screen: String
    @State private var session: Session
    @State private var library: Library
    @State private var player: Player
    @State private var lyrics: Lyrics

    init(screen: String) {
        self.screen = screen
        let session = Session.demo(server: Config.server, signedIn: screen != "signin", serverAway: screen == "shell")
        _session = State(initialValue: session)
        let library = DemoLibrary.library(failing: screen == "shell")
        _library = State(initialValue: library)
        _player = State(initialValue: Player.demo(library: library, screen: screen))
        _lyrics = State(initialValue: Lyrics.demo(screen: screen, library: library))
    }

    var body: some View {
        RootView(session: session, library: library, player: player, lyrics: lyrics, start: DemoLibrary.start(screen))
            .environment(\.lyricsMenuOnOpen, screen == "lyrics-menu")
    }
}
