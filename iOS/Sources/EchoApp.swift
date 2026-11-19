import SwiftUI

/// ECHO for iPhone: the shared app (Apple/Shared) in one window; `-ECHODemo <screen>` shows the
/// app with built-in albums instead (Apple/Shared/Preview).
@main
struct EchoApp: App {
    var body: some Scene {
        WindowGroup {
            if let screen = demoScreen {
                DemoRoot(screen: screen)
            } else {
                RootView(session: Live.session, library: Live.library, player: Live.player)
            }
        }
    }
}
