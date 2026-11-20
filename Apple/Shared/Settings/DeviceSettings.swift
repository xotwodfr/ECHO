import Foundation
import Observation

/// The preferences kept on this device only, in its UserDefaults: what concerns this device and
/// not the user's other ones, as the web keeps its per-device preferences in the browser
/// (src/client/prefs.ts). The preferences that follow the user are `/me/settings` (UserSettings,
/// Session); the server checks every key there and has none for these.
///
/// - The lock screen's loop speed (Settings → Lock screen): the iPhone's own, and its cache.
///
/// Downloads' storage (task 10) keeps its choices here too, a property and a key each.
@MainActor @Observable
final class DeviceSettings {
    /// How fast the lock screen's animated cover loops: the loop's length asked of the server.
    private(set) var motionLoop: LoopSpeed

    @ObservationIgnored private let defaults: UserDefaults?

    static let motionLoopKey = "echo.device.motionLoop"

    /// - Parameter defaults: where the choices are kept; nil keeps them in memory (the preview).
    init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        motionLoop = defaults.flatMap { LoopSpeed(rawValue: $0.integer(forKey: Self.motionLoopKey)) } ?? .standard
    }

    func setMotionLoop(_ speed: LoopSpeed) {
        motionLoop = speed
        defaults?.set(speed.rawValue, forKey: Self.motionLoopKey)
    }
}
