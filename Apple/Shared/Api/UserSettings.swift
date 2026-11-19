import Foundation

// The preferences that follow the user (`/me/settings`, schema version 2: src/server/settings.ts,
// SETTINGS_AND_SECURITY.md §7.1), with the keys and defaults the web (src/client/prefs.ts) and
// Android use. A value the server adds later, or one this app does not know, reads as the default
// rather than failing the whole answer. Changes go up one key at a time (patch(from:)), so two
// devices changing different keys do not undo each other.

struct UserSettings: Codable, Equatable, Sendable {
    var playback = Playback()
    var lyrics = Lyrics()
    var visuals = Visuals()
    var appearance = Appearance()
    var games = Games()

    struct Playback: Codable, Equatable, Sendable {
        /// The server keeps it, but every client crossfades per device (its own speakers).
        var crossfadeSec = 0
        var replayGain = ReplayGainMode.auto
        /// Scrobble plays to Navidrome.
        var scrobble = true
    }

    struct Lyrics: Codable, Equatable, Sendable {
        /// 0.85, 1, 1.15 or 1.3.
        var sizeScale = 1.0
        /// −2000 to 2000 ms, in 50 ms steps.
        var globalOffsetMs = 0
        var showUnsynced = true
        var announceLines = false
        var disabledSources: [LyricSource] = []
    }

    struct Visuals: Codable, Equatable, Sendable {
        var mode = VisualMode.auto
        var intensity = Intensity.expressive
        var motion = Motion.system
        var grain = false
        var pointerParallax = true
    }

    /// The look: one of the Android app's themes (src/shared/themes.ts), and light or dark.
    struct Appearance: Codable, Equatable, Sendable {
        var theme = ThemeID.echo
        var dark = DarkMode.theme
    }

    /// Each Android game's record, kept on the account.
    struct Games: Codable, Equatable, Sendable {
        var songGuesser = GameRecord()
        var finishLyric = GameRecord()
        var coverReveal = GameRecord()
        var timeline = GameRecord()
    }

    struct GameRecord: Codable, Equatable, Sendable {
        var best = 0
        var streak = 0
        var rounds = 0
    }

    enum ReplayGainMode: String, Codable, CaseIterable, Sendable { case off, track, album, auto }
    enum LyricSource: String, Codable, CaseIterable, Sendable {
        case navidrome, spicy, netease, lrclib
        case navidromePlain = "navidrome-plain"
    }
    enum VisualMode: String, Codable, CaseIterable, Sendable { case auto, reverb, ambient, still }
    enum Intensity: String, Codable, CaseIterable, Sendable { case subtle, balanced, expressive }
    enum Motion: String, Codable, CaseIterable, Sendable { case system, full, reduced, off }
    enum DarkMode: String, Codable, CaseIterable, Sendable { case theme, system, light, dark }
    /// The server's THEME_IDS. "materialyou" is Android's wallpaper theme; the server keeps it so
    /// one account can carry it, and the Apple apps show it as ECHO.
    enum ThemeID: String, Codable, CaseIterable, Sendable {
        case echo, apple, spotify, soundcloud, deezer, qobuz, tidal, youtube, clay, yarn, glass, paper, hifi
        case materialyou, mono
    }
}

// Every section reads what it knows and takes the default for the rest.

extension UserSettings {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        playback = c.value(.playback, Playback())
        lyrics = c.value(.lyrics, Lyrics())
        visuals = c.value(.visuals, Visuals())
        appearance = c.value(.appearance, Appearance())
        games = c.value(.games, Games())
    }
}

extension UserSettings.Playback {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        crossfadeSec = c.value(.crossfadeSec, 0)
        replayGain = c.value(.replayGain, .auto)
        scrobble = c.value(.scrobble, true)
    }
}

extension UserSettings.Lyrics {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sizeScale = c.value(.sizeScale, 1.0)
        globalOffsetMs = c.value(.globalOffsetMs, 0)
        showUnsynced = c.value(.showUnsynced, true)
        announceLines = c.value(.announceLines, false)
        // A source this app does not know is left out, not the whole list.
        let names: [String] = c.value(.disabledSources, [])
        disabledSources = names.compactMap(UserSettings.LyricSource.init(rawValue:))
    }
}

extension UserSettings.Visuals {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = c.value(.mode, .auto)
        intensity = c.value(.intensity, .expressive)
        motion = c.value(.motion, .system)
        grain = c.value(.grain, false)
        pointerParallax = c.value(.pointerParallax, true)
    }
}

extension UserSettings.Appearance {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        theme = c.value(.theme, .echo)
        dark = c.value(.dark, .theme)
    }
}

extension UserSettings.Games {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        songGuesser = c.value(.songGuesser, .init())
        finishLyric = c.value(.finishLyric, .init())
        coverReveal = c.value(.coverReveal, .init())
        timeline = c.value(.timeline, .init())
    }
}

extension UserSettings.GameRecord {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        best = c.value(.best, 0)
        streak = c.value(.streak, 0)
        rounds = c.value(.rounds, 0)
    }
}

extension KeyedDecodingContainer {
    /// The value under `key`, or `fallback` when it is missing or not what is expected.
    func value<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }
}

// MARK: - Changing them

extension UserSettings {
    /// What changed since `old`, as `PUT /me/settings` takes it: `{ section: { key: value } }` with
    /// only the keys whose value differs; nil when nothing did.
    func patch(from old: UserSettings) throws -> Data? {
        let now = try Self.sections(of: self)
        let before = try Self.sections(of: old)
        var patch: [String: [String: Any]] = [:]
        for (section, keys) in now {
            for (key, value) in keys {
                let was = before[section]?[key]
                if let was, (was as AnyObject).isEqual(value) { continue }
                patch[section, default: [:]][key] = value
            }
        }
        if patch.isEmpty { return nil }
        return try JSONSerialization.data(withJSONObject: patch, options: [.sortedKeys])
    }

    private static func sections(of settings: UserSettings) throws -> [String: [String: Any]] {
        let data = try JSONEncoder().encode(settings)
        return (try JSONSerialization.jsonObject(with: data) as? [String: [String: Any]]) ?? [:]
    }
}
