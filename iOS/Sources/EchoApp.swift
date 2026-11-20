import SwiftUI
import UIKit

/// The system relaunches the app to say a background download finished (Downloads, a background
/// URLSession): it hands over the completion handler, and the downloads are made so the session's
/// events have somewhere to go.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            BackgroundDownloads.completion = completionHandler
            await Live.downloads.resume()
        }
    }
}

/// ECHO for iPhone: the shared app (Apple/Shared) in one window; `-ECHODemo <screen>` shows the
/// app with built-in albums instead (Apple/Shared/Preview), or the home-screen widget's views
/// (`widgets`, `widgets-tinted`, `widgets-idle`: Preview/DemoWidgets.swift).
@main
struct EchoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        // What this build is given for the App Group (unsigned builds may get none): the runner's log.
        WidgetStore.log.notice("\(WidgetStore.describeAppGroup(), privacy: .public)")
        #endif
        if demoScreen == nil {
            // The widget's buttons: their App Intents run in this process, on the app's player.
            WidgetCommands.handler = { await Live.player.perform($0) }
        }
    }

    var body: some Scene {
        WindowGroup {
            if let screen = demoScreen {
                if let widgets = WidgetDemo(rawValue: screen) {
                    WidgetDemoScreen(demo: widgets)
                } else {
                    DemoRoot(screen: screen)
                }
            } else {
                RootView(
                    session: Live.session, library: Live.library, player: Live.player, lyrics: Live.lyrics,
                    device: Live.device, invites: Live.invites, downloads: Live.downloads)
            }
        }
    }
}
