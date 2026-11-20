import Foundation
#if os(iOS)
import UIKit
import WidgetKit
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

/// The app's one session, library, player and lyrics, made when the real app first needs them
/// (never in the preview, which has its own: Preview/DemoLibrary.swift).
@MainActor
enum Live {
    static let device = DeviceSettings()
    /// The lock screen's animated covers: the iPhone's alone.
    static let motion: MotionCovers? = {
        #if os(iOS)
        return MotionCovers(source: Live.session.client, files: MotionFiles(), loop: { Live.device.motionLoop.seconds })
        #else
        return nil
        #endif
    }()
    /// The home-screen widget's song, in the App Group (the iPhone's alone).
    static let widget: WidgetFeed? = {
        #if os(iOS)
        return WidgetFeed(store: .appGroup(), reload: { WidgetCenter.shared.reloadTimelines(ofKind: WidgetShared.kind) })
        #else
        return nil
        #endif
    }()
    static let session = Session(
        server: Config.server,
        tokens: KeychainTokenStore(account: Config.server.absoluteString),
        deviceName: { Config.deviceName })
    static let invites = GuestInvites(client: session.client)
    static let library = Library(source: session.client, images: .live(session.client))
    /// Karaoke mode's audio: the server's 5.1 versions, fetched with this device's token.
    static let karaokeEngine = KaraokeAudioEngine(download: { [client = session.client] key, path in
        try await client.karaokeFile(at: path, key: key)
    })
    static let karaoke = Karaoke(device: device, source: session.client, controls: karaokeEngine)
    static let player = Player(
        source: session.client, engine: RoutedEngine(plain: AVPlaybackEngine(), karaoke: karaokeEngine),
        media: SystemMediaCenter(), hearts: library,
        images: library.images, motion: motion, widget: widget, karaoke: karaoke, settings: { Live.session.settings.playback }, quality: { Live.device.streamQuality },
        notify: { Live.library.show(Toast(message: $0)) })
    static let lyrics = Lyrics(
        source: session.client, settings: { Live.session.settings }, upcoming: { Live.player.upcoming.first },
        notify: { Live.library.show(Toast(message: $0)) })
}
