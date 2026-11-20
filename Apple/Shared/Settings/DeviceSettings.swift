import Foundation
import Observation

/// The preferences kept on this device only, in its UserDefaults: what concerns this device and
/// not the user's other ones, as the web keeps its per-device preferences in the browser
/// (src/client/prefs.ts). The preferences that follow the user are `/me/settings` (UserSettings,
/// Session); the server checks every key there and has none for these.
///
/// - The lock screen's loop speed (Settings → Lock screen): the iPhone's own, and its cache.
/// - The stream quality (Settings → Playback): what this device's connection and ears want.
/// - The background brightness and Performance mode (Settings → Appearance): this screen and its
///   speed, as the web's `visuals.backdrop` and `visuals.performance`.
/// - Haptics and Theme sounds (Settings → Appearance): this device's feelings, as Android's
///   `Prefs.haptics` and `Prefs.themeSounds` (Feedback).
///
/// Crossfade, the equalizer, Karaoke and Autoplay are per device on the web and Android too; they
/// land here (a property, a key and a setter each) when they are built. Downloads' storage (task 10)
/// keeps its choices here too.
@MainActor @Observable
final class DeviceSettings {
    /// How fast the lock screen's animated cover loops: the loop's length asked of the server.
    private(set) var motionLoop: LoopSpeed

    /// How songs are asked for: as stored where this device plays them, or at a set bit rate.
    private(set) var streamQuality: StreamQuality
    /// How bright the room's album light is, 0…1 (0.5: as designed); the web's backdrop.
    private(set) var backdrop: Double
    /// Performance mode: the smaller animations, for a slower device.
    private(set) var performance: Bool
    /// Haptics: a tap for presses, switches and hearts (the iPhone).
    private(set) var haptics: Bool
    /// Theme sounds: a theme's own sounds on presses (Android's `themeSounds`).
    private(set) var themeSounds: Bool

    @ObservationIgnored private let defaults: UserDefaults?

    static let motionLoopKey = "echo.device.motionLoop"
    static let streamQualityKey = "echo.device.streamQuality"
    static let backdropKey = "echo.device.backdrop"
    static let performanceKey = "echo.device.performance"
    static let hapticsKey = "echo.device.haptics"
    static let themeSoundsKey = "echo.device.themeSounds"
    static let defaultBackdrop = 0.5

    /// - Parameter defaults: where the choices are kept; nil keeps them in memory (the preview).
    init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        motionLoop = defaults.flatMap { LoopSpeed(rawValue: $0.integer(forKey: Self.motionLoopKey)) } ?? .standard
        streamQuality = defaults?.string(forKey: Self.streamQualityKey).flatMap(StreamQuality.init(rawValue:)) ?? .auto
        backdrop = (defaults?.object(forKey: Self.backdropKey) as? Double).map { min(1, max(0, $0)) } ?? Self.defaultBackdrop
        performance = defaults?.bool(forKey: Self.performanceKey) ?? false
        // On unless switched off.
        haptics = (defaults?.object(forKey: Self.hapticsKey) as? Bool) ?? true
        themeSounds = (defaults?.object(forKey: Self.themeSoundsKey) as? Bool) ?? true
    }

    func setMotionLoop(_ speed: LoopSpeed) {
        motionLoop = speed
        defaults?.set(speed.rawValue, forKey: Self.motionLoopKey)
    }
}

extension DeviceSettings {
    func setStreamQuality(_ quality: StreamQuality) {
        streamQuality = quality
        defaults?.set(quality.rawValue, forKey: Self.streamQualityKey)
    }

    func setBackdrop(_ value: Double) {
        backdrop = min(1, max(0, value))
        defaults?.set(backdrop, forKey: Self.backdropKey)
    }

    func setPerformance(_ on: Bool) {
        performance = on
        defaults?.set(on, forKey: Self.performanceKey)
    }

    func setHaptics(_ on: Bool) {
        haptics = on
        defaults?.set(on, forKey: Self.hapticsKey)
    }

    func setThemeSounds(_ on: Bool) {
        themeSounds = on
        defaults?.set(on, forKey: Self.themeSoundsKey)
    }

    /// The album light's strength on a page whose own is `base` (designed at the middle brightness).
    func roomStrength(_ base: Double) -> Double {
        min(1, max(0, base * backdrop / Self.defaultBackdrop))
    }
}

/// Settings → Playback → Quality: the bit rate songs are asked for. Auto plays a song as stored
/// where this device plays its format and asks for MP3 at 320 kbit/s where it does not.
enum StreamQuality: String, CaseIterable, Sendable {
    case auto
    case kbps320 = "320"
    case kbps192 = "192"
    case kbps128 = "128"

    var label: String {
        switch self {
        case .auto: "Auto"
        case .kbps320: "320 kbit/s"
        case .kbps192: "192 kbit/s"
        case .kbps128: "128 kbit/s"
        }
    }

    /// The bit rate every song is asked for at; nil: as stored where it plays.
    var bitRate: Int? { Int(rawValue) }
}
