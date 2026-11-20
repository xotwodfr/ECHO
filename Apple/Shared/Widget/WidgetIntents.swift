import AppIntents
import Foundation

// The widget's buttons: App Intents (iOS 17's interactive widgets). Each is an AudioPlaybackIntent,
// so the system runs it in the app's process (starting the app in the background when it is not
// running) and it controls the music there; the extension's copy of these types only names them.
// The app tells them what to do at launch (WidgetCommands.handler: the Player, Player.perform).
// Not offered to Shortcuts or Spotlight (isDiscoverable): they are the widget's alone.

/// What a widget's button asks of the player.
enum WidgetCommand: String, Sendable, CaseIterable {
    case toggle, next, previous
}

/// Where the widget's buttons go in this process: set by the app at launch; nil in the widget
/// extension, which never runs them.
@MainActor
enum WidgetCommands {
    static var handler: (@MainActor (WidgetCommand) async -> Void)?

    static func perform(_ command: WidgetCommand) async {
        await handler?(command)
    }
}

/// Play, or pause (the button shows which).
struct PlayPauseIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play or Pause"
    static var isDiscoverable: Bool { false }
    static let command = WidgetCommand.toggle

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        await WidgetCommands.perform(Self.command)
        return .result()
    }
}

/// The next song.
struct NextSongIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Next Song"
    static var isDiscoverable: Bool { false }
    static let command = WidgetCommand.next

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        await WidgetCommands.perform(Self.command)
        return .result()
    }
}

/// The song before (or this one from its start, past 3 s, as everywhere in the app).
struct PreviousSongIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Previous Song"
    static var isDiscoverable: Bool { false }
    static let command = WidgetCommand.previous

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        await WidgetCommands.perform(Self.command)
        return .result()
    }
}
