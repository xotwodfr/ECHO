import SwiftUI

/// What `-ECHODemo <screen>` shows: the approved preview's screens with built-in albums
/// (PhoneDemo, MacDemo), or the real app's own screens around a session that never calls the
/// server: `signin`, the sign-in page; `shell`, the signed-in app with its placeholder pages (on the
/// iPhone with the banner shown while ECHO is not answering).
struct DemoRoot: View {
    let screen: String

    var body: some View {
        switch screen {
        case "signin":
            RootView(session: .demo(server: Config.server, signedIn: false))
        case "shell":
            #if os(iOS)
            RootView(session: .demo(server: Config.server, signedIn: true, serverAway: true))
            #else
            RootView(session: .demo(server: Config.server, signedIn: true))
            #endif
        default:
            #if os(iOS)
            PhoneDemo(screen: screen)
            #else
            MacDemo(screen: screen)
            #endif
        }
    }
}
