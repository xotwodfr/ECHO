import Foundation
#if os(iOS)
import UIKit
#endif

/// The app's fixed settings: the server, and the name this device signs in with.
enum Config {
    static let defaultServer = "https://echo.folk3s.com"

    /// The owner's server (as the Android app's; no server field). ECHO_URL in the Xcode scheme's
    /// environment points a build at another (a test server on this network: http is allowed there).
    static let server: URL = {
        var s = ProcessInfo.processInfo.environment["ECHO_URL"] ?? defaultServer
        while s.hasSuffix("/") { s.removeLast() }
        return URL(string: s) ?? URL(string: defaultServer)!
    }()

    /// How Sessions & devices lists this device (at most 64 characters).
    @MainActor static var deviceName: String {
        #if os(iOS)
        String("ECHO for \(UIDevice.current.model)".prefix(64))
        #else
        String("ECHO for Mac (\(Host.current().localizedName ?? "this Mac"))".prefix(64))
        #endif
    }
}

/// The app's one session, library and player, made when the real app first needs them (never in
/// the preview, which has its own: Preview/DemoLibrary.swift).
@MainActor
enum Live {
    static let session = Session(
        server: Config.server,
        tokens: KeychainTokenStore(account: Config.server.absoluteString),
        deviceName: { Config.deviceName })
    static let library = Library(source: session.client, images: .live(session.client))
    static let player = Player(client: session.client)
}
