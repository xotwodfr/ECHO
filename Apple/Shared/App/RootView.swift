import SwiftUI

/// The app: the sign-in page until this device has a token, then the app around the library. A
/// token the server refuses, from anywhere in the app, brings the sign-in back (Session); signing
/// out forgets the library (its covers too), stops the music and empties the queue. Signed in, the
/// queue saved from any device comes back (Player, QueueSync). The playing track's lyrics follow it
/// (Lyrics). The lock screen's animated cover is asked for again when its speed changes in Settings.
/// A link into the app (the widget's tap: AppLink) opens what it names once the app is ready for it;
/// a guest link opens the sign-in page's guest pass. Signed in with a guest pass, the library listens
/// only (Library.listensOnly).
struct RootView: View {
    let session: Session
    let library: Library
    let player: Player
    let lyrics: Lyrics
    let device: DeviceSettings
    let invites: GuestInvites
    var start = ShellStart()

    @Environment(\.scenePhase) private var scenePhase
    /// The theme's feel: haptics and sounds (Feedback), told which theme and which device's switches.
    @State private var feedback = Feedback()
    /// A link the system handed the app, waiting for the shell to open it.
    @State private var link: AppLink? = nil

    var body: some View {
        Group {
            switch session.phase {
            case .signedIn:
                AppShell(session: session, start: start, link: $link)
            case .signedOut:
                SignInView(session: session, link: $link)
            case .locked:
                // Launched in the background while locked: the token is read once it unlocks.
                AlbumLight().overlay { ProgressView().tint(Color.primary) }
            }
        }
        .environment(session)
        .environment(library)
        .environment(player)
        .environment(lyrics)
        .environment(device)
        .environment(invites)
        .environment(feedback)
        // The user's theme, with its light or dark, tint and lyric look, for everything below.
        .themed(session.settings.appearance)
        .onChange(of: session.settings.appearance.theme, initial: true) {
            feedback.device = device
            feedback.sounds = Theme.of(session.settings.appearance.theme).sounds
        }
        .animation(.smooth, value: session.phase)
        .onChange(of: session.isGuest, initial: true) { library.listensOnly = session.isGuest }
        .onOpenURL { url in link = AppLink(url) }
        .onChange(of: device.motionLoop) { player.lockScreenChanged() }
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
