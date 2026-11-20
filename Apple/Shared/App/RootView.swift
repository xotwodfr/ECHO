import SwiftUI

/// The app: the sign-in page until this device has a token, then the app around the library. A
/// token the server refuses, from anywhere in the app, brings the sign-in back (Session); signing
/// out forgets the library (its covers too), stops the music and empties the queue. Signed in, the
/// queue saved from any device comes back (Player, QueueSync). The playing track's lyrics follow it
/// (Lyrics).
struct RootView: View {
    let session: Session
    let library: Library
    let player: Player
    let lyrics: Lyrics
    var start = ShellStart()

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch session.phase {
            case .signedIn:
                AppShell(session: session, start: start)
            case .signedOut:
                SignInView(session: session)
            case .locked:
                // Launched in the background while locked: the token is read once it unlocks.
                AlbumLight().overlay { ProgressView().tint(.white) }
            }
        }
        .environment(library)
        .environment(player)
        .environment(lyrics)
        .animation(.smooth, value: session.phase)
        .task(id: player.track?.key) { lyrics.follow(player.track) }
        .task { await session.refresh() }
        .task(id: session.phase) {
            switch session.phase {
            case .signedIn:
                async let hearts: Void = library.start()
                async let queue: Void = player.signedIn()
                _ = await (hearts, queue)
            case .signedOut:
                library.reset()
                player.stop()
            case .locked: break
            }
        }
        .onChange(of: scenePhase) {
            // Leaving the app is not an Undo: a Wanted removal still waiting goes now, and so does a
            // save of the queue (the web's on leaving the page).
            if scenePhase == .background {
                Task {
                    await library.wanted.flush()
                    await player.flushQueue()
                }
            }
        }
    }
}
