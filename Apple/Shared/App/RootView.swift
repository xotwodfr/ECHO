import SwiftUI

/// The app: the sign-in page until this device has a token, then the app around the library. A
/// token the server refuses, from anywhere in the app, brings the sign-in back (Session); signing
/// out forgets the library (its covers too) and stops the music.
struct RootView: View {
    let session: Session
    let library: Library
    let player: Player
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
        .animation(.smooth, value: session.phase)
        .task { await session.refresh() }
        .task(id: session.phase) {
            switch session.phase {
            case .signedIn: await library.start()
            case .signedOut:
                library.reset()
                player.stop()
            case .locked: break
            }
        }
        .onChange(of: scenePhase) {
            // Leaving the app is not an Undo: a Wanted removal still waiting goes now.
            if scenePhase == .background { Task { await library.wanted.flush() } }
        }
    }
}
