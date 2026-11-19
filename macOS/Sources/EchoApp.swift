import SwiftUI

/// ECHO for the Mac: the shared app (Apple/Shared) in a window of a laptop's size; `-ECHODemo
/// <screen>` shows the Liquid Glass preview with built-in albums instead (Apple/Shared/Preview).
@main
struct EchoApp: App {
    var body: some Scene {
        WindowGroup {
            if let screen = demoScreen {
                MacDemo(screen: screen)
                    .frame(minWidth: 1100, minHeight: 720)
            } else {
                RootView()
                    .frame(minWidth: 480, minHeight: 400)
            }
        }
        .defaultSize(width: demoScreen == nil ? 960 : 1280, height: demoScreen == nil ? 680 : 800)
    }
}
