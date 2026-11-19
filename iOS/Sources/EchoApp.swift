import SwiftUI

/// ECHO for iPhone: the shared app (Apple/Shared) in one window; `-ECHODemo <screen>` shows the
/// Liquid Glass preview with built-in albums instead (Apple/Shared/Preview).
@main
struct EchoApp: App {
    var body: some Scene {
        WindowGroup {
            if let screen = demoScreen {
                PhoneDemo(screen: screen)
            } else {
                RootView()
            }
        }
    }
}
