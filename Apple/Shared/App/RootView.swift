import SwiftUI

/// The app: the sign-in page until this device has a token, then the app around the library. A
/// token the server refuses, from anywhere in the app, brings the sign-in back (Session).
struct RootView: View {
    let session: Session

    var body: some View {
        Group {
            switch session.phase {
            case .signedIn:
                AppShell(session: session)
            case .signedOut:
                SignInView(session: session)
            case .locked:
                // Launched in the background while locked: the token is read once it unlocks.
                AlbumLight().overlay { ProgressView().tint(.white) }
            }
        }
        .animation(.smooth, value: session.phase)
        .task { await session.refresh() }
    }
}
