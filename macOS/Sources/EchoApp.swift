import SwiftUI

/// ECHO for the Mac: the shared app (Apple/Shared) in a window of a laptop's size; `-ECHODemo
/// <screen>` shows the app with built-in albums instead (Apple/Shared/Preview).
@main
struct EchoApp: App {
    var body: some Scene {
        WindowGroup {
            if let screen = demoScreen {
                DemoRoot(screen: screen)
                    .frame(minWidth: 1100, minHeight: 720)
            } else {
                RootView(session: Live.session, library: Live.library, player: Live.player, lyrics: Live.lyrics)
                    .frame(minWidth: 760, minHeight: 520)
            }
        }
        .defaultSize(width: demoScreen == nil ? 1100 : 1280, height: demoScreen == nil ? 720 : 800)
    }
}
