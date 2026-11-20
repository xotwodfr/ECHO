import Foundation

/// Which line VoiceOver is told about (Settings → Lyrics → Announce lyric lines).
enum LyricAnnouncement {
    /// The line that just began, when announcing is on; nil for no line, the same line, or off.
    static func line(from old: String?, to new: String?, enabled: Bool) -> String? {
        guard enabled, let new, new != old, !new.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return new
    }
}
