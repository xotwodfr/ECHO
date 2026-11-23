import Foundation
import Observation

/// Changes the user's preferences from Settings: one key at a time, in order (two quick taps never
/// race each other's answers), shown at once and put back with a message if the server refuses.
@MainActor @Observable
final class SettingsEditor {
    private let session: Session
    /// Why the last change was not kept; cleared by the next one.
    private(set) var failure: String?
    @ObservationIgnored private var last: Task<Void, Never>?

    init(session: Session) {
        self.session = session
    }

    /// Changes preferences with `change`; resolves when the server has answered (or refused).
    @discardableResult
    func save(_ change: @escaping @MainActor (inout UserSettings) -> Void) -> Task<Void, Never> {
        let before = last
        let task = Task { [session, weak self] in
            await before?.value
            do {
                try await session.updateSettings { change(&$0) }
                self?.failure = nil
            } catch {
                self?.failure = (error as? ApiError)?.userMessage ?? "Couldn't save that. Try again."
            }
        }
        last = task
        return task
    }
}

/// The words and sums Settings uses, apart from the views so the tests can reach them.
enum SettingsText {
    static let sizes = [0.85, 1, 1.15, 1.3]
    static let maxOffset = 2000
    static let offsetStep = 50

    static func size(_ scale: Double) -> String {
        switch scale {
        case 0.85: "Small"
        case 1.15: "Large"
        case 1.3: "Largest"
        default: "Default"
        }
    }

    /// "+150 ms", "−50 ms", "0 ms".
    static func offset(_ ms: Int) -> String {
        ms == 0 ? "0 ms" : "\(ms > 0 ? "+" : "−")\(abs(ms)) ms"
    }

    /// The server takes −2000…2000 ms.
    static func clampOffset(_ ms: Int) -> Int { min(maxOffset, max(-maxOffset, ms)) }

    static func motion(_ motion: UserSettings.Motion) -> String {
        switch motion {
        case .system: "System"
        case .full: "Full"
        case .reduced: "Reduced"
        case .off: "Off"
        }
    }

    static func replayGain(_ mode: UserSettings.ReplayGainMode) -> String {
        switch mode {
        case .auto: "Auto"
        case .album: "Album"
        case .track: "Track"
        case .off: "Off"
        }
    }

    static func source(_ source: UserSettings.LyricSource) -> String {
        switch source {
        case .navidrome: "Your library"
        case .spicy: "Spicy Lyrics"
        case .netease: "NetEase Cloud Music"
        case .lrclib: "LRCLIB"
        case .navidromePlain: "Your library (plain text)"
        }
    }

    /// The disabled sources after `source` is switched on or off, in the sources' own order.
    static func sources(_ off: [UserSettings.LyricSource], _ source: UserSettings.LyricSource, on: Bool)
        -> [UserSettings.LyricSource]
    {
        UserSettings.LyricSource.allCases.filter { $0 == source ? !on : off.contains($0) }
    }
}
