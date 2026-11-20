import AudioToolbox
import Foundation
import Observation
#if canImport(UIKit)
import UIKit
#endif

// What a press feels and sounds like. Android's `Haptics` (ui/Motion.kt) has five events: tap, toggle,
// confirm, reject and tick; each makes a haptic, and in a theme with sounds (ui/Sounds.kt) one of four
// cues. The same five events here: a haptic on the iPhone (the Taptic Engine through UIKit's feedback
// generators), and the theme's sound as a system sound (it follows the device's sound volume and
// ringer switch, and mixes with the music, as Android's UI sounds do). Each is switched off on its own
// in Settings → Appearance (this device's: Haptics, Theme sounds). The mapping is pure and the two
// outputs are protocols, so the tests run it on fakes.

/// What happened in the interface.
enum FeedbackEvent: Equatable, Sendable {
    /// A press: a button, a row, a card.
    case tap
    /// A switch or a heart, now on or off.
    case toggle(Bool)
    /// Something done right: Play, a choice kept.
    case confirm
    /// Something refused.
    case reject
    /// A step along a slider or between tabs.
    case tick
}

/// The kinds of haptic the Taptic Engine is asked for.
enum HapticKind: Equatable, Sendable {
    case light, rigid, soft, success, error, selection
}

/// One of a theme's four sounds (Android's `Sound`).
enum SoundCue: String, Equatable, Sendable, CaseIterable {
    case tap, toggle, yes, no
}

extension FeedbackEvent {
    /// The haptic of the event (Android: ContextClick, ToggleOn/Off, Confirm, Reject, SegmentTick).
    var haptic: HapticKind {
        switch self {
        case .tap: .light
        case .toggle(let on): on ? .rigid : .soft
        case .confirm: .success
        case .reject: .error
        case .tick: .selection
        }
    }

    /// The sound's cue (Android: Tap, Toggle, Yes, No; a tick is a toggle's).
    var cue: SoundCue {
        switch self {
        case .tap: .tap
        case .toggle, .tick: .toggle
        case .confirm: .yes
        case .reject: .no
        }
    }
}

extension Theme.Sounds {
    /// The file (in the app, `.wav`) that plays for a cue; nil where the theme has no sounds. A "no"
    /// is the press sound again (Android plays it lower).
    func file(for cue: SoundCue) -> String? {
        guard self != .none else { return nil }
        switch cue {
        case .tap, .no: return "\(rawValue)_press"
        case .toggle: return "\(rawValue)_click"
        case .yes: return "\(rawValue)_yes"
        }
    }

    /// Every file the theme needs: the tests check they are in the app.
    var files: [String] {
        Array(Set(SoundCue.allCases.compactMap(file(for:)))).sorted()
    }
}

@MainActor
protocol HapticOutput: AnyObject {
    func fire(_ kind: HapticKind)
}

@MainActor
protocol SoundOutput: AnyObject {
    /// Plays the bundled sound `file` (no extension).
    func play(_ file: String)
}

/// The feedback of the interface: the screens say what happened (`feedback.tap()`), and this decides,
/// from the theme and this device's two switches, what is felt and heard.
@MainActor @Observable
final class Feedback {
    /// The sounds of the theme in use (set when the theme changes).
    var sounds: Theme.Sounds = .none
    /// This device's switches (Settings → Appearance); nil: both on.
    @ObservationIgnored var device: DeviceSettings?

    @ObservationIgnored private let haptics: HapticOutput?
    @ObservationIgnored private let output: SoundOutput?

    init(haptics: HapticOutput?, output: SoundOutput?) {
        self.haptics = haptics
        self.output = output
    }

    /// The device's own haptics and sound player.
    convenience init() {
        self.init(haptics: SystemHaptics.make(), output: SystemSounds())
    }

    func tap() { send(.tap) }
    func toggle(_ on: Bool) { send(.toggle(on)) }
    func confirm() { send(.confirm) }
    func reject() { send(.reject) }
    func tick() { send(.tick) }

    func send(_ event: FeedbackEvent) {
        if device?.haptics ?? true { haptics?.fire(event.haptic) }
        if device?.themeSounds ?? true, let file = sounds.file(for: event.cue) { output?.play(file) }
    }
}

// MARK: - The device's

#if canImport(UIKit)
/// The Taptic Engine, through UIKit's feedback generators (the iPhone only).
@MainActor
final class SystemHaptics: HapticOutput {
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private let soft = UIImpactFeedbackGenerator(style: .soft)
    private let notifications = UINotificationFeedbackGenerator()
    private let selection = UISelectionFeedbackGenerator()

    static func make() -> HapticOutput? { SystemHaptics() }

    func fire(_ kind: HapticKind) {
        switch kind {
        case .light: light.impactOccurred()
        case .rigid: rigid.impactOccurred()
        case .soft: soft.impactOccurred()
        case .success: notifications.notificationOccurred(.success)
        case .error: notifications.notificationOccurred(.error)
        case .selection: selection.selectionChanged()
        }
    }
}
#else
/// The Mac has no haptics.
enum SystemHaptics {
    @MainActor static func make() -> HapticOutput? { nil }
}
#endif

/// The theme's sounds, played as system sounds: short, at the device's sound volume, over the music.
@MainActor
final class SystemSounds: SoundOutput {
    private var ids: [String: SystemSoundID] = [:]

    func play(_ file: String) {
        if ids[file] == nil {
            var id = SystemSoundID(0)
            if let url = Bundle.main.url(forResource: file, withExtension: "wav") {
                AudioServicesCreateSystemSoundID(url as CFURL, &id)
            }
            ids[file] = id
        }
        if let id = ids[file], id != 0 { AudioServicesPlaySystemSound(id) }
    }
}
