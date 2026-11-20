import SwiftUI

/// ECHO for the Mac: the shared app (Apple/Shared) in a window of a laptop's size, and its Settings
/// window (the app menu's Settings…, ⌘,); `-ECHODemo <screen>` shows the app with built-in albums
/// instead (Apple/Shared/Preview).
@main
struct EchoApp: App {
    @State private var demo: DemoWorld?

    init() {
        _demo = State(initialValue: demoScreen.map { DemoWorld(screen: $0) })
    }

    var body: some Scene {
        WindowGroup {
            if let demo {
                DemoRoot(world: demo)
                    .frame(minWidth: 1100, minHeight: 720)
            } else {
                RootView(
                    session: Live.session, library: Live.library, player: Live.player, lyrics: Live.lyrics,
                    device: Live.device, invites: Live.invites
                )
                .frame(minWidth: 760, minHeight: 520)
            }
        }
        .defaultSize(width: demoScreen == nil ? 1100 : 1280, height: demoScreen == nil ? 720 : 800)

        Settings {
            SettingsWindow(
                session: demo?.session ?? Live.session, invites: demo?.invites ?? Live.invites,
                guests: demo?.screen == "guests")
        }
    }
}
