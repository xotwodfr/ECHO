import SwiftUI

/// ECHO for the Mac: the shared app (Apple/Shared) in a window of a laptop's size.
@main
struct EchoApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .frame(minWidth: 480, minHeight: 400)
        }
        .defaultSize(width: 960, height: 680)
    }
}
