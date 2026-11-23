import Foundation

// What a lyric line's text says about how it is set (src/client/stage/lyrics/layout.ts;
// LYRICS_EXPERIENCE.md §3.3, §4.3, §5.4–§5.6): its direction, CJK, held words, backing vocals in
// parentheses, the sides of a duet, and the fit (two rows at most, shrinking by up to 12%).

enum LyricDirection: Sendable {
    case ltr, rtl
}

/// Where a line sits in the column (§4.3): duets put the second voice on the right.
enum LyricSide: Sendable {
    case centre, left, right
}

/// A held word's emphasis (§5.5).
struct LyricEmphasis: Equatable, Sendable {
    /// The peak scale − 1, ≤ 0.08.
    var swell: Double
    /// The peak lift, em, ≤ 0.08.
    var lift: Double
    /// How far each grapheme pushes from the word's middle, em per step, ≤ 0.04 (AMLL, Spicy).
    var spread: Double
    /// The graphemes start this far apart.
    var stepMs: Double
}

enum LyricText {
    /// Two rows at most: shrink by up to 12% in steps of 2%, then allow more. `rowsAt` sets the line
    /// at a size (1: the active size). The face has no width axis, so it never condenses.
    static func fit(_ rowsAt: (Double) -> Int) -> (size: Double, rows: Int) {
        var size = 1.0
        var rows = rowsAt(size)
        let minSize = 1 - LyricsConfig.shrinkMax
        while rows > LyricsConfig.maxRows, size > minSize + 1e-9 {
            size = max(minSize, size - 0.02)
            rows = rowsAt(size)
        }
        return ((size * 100).rounded() / 100, rows)
    }

    /// The base direction, from the first strong (letter) character (§5.4).
    static func direction(_ text: String) -> LyricDirection {
        guard let first = text.unicodeScalars.first(where: isLetter) else { return .ltr }
        return isRTL(first) ? .rtl : .ltr
    }

    static func isCJK(_ text: String) -> Bool {
        text.unicodeScalars.contains { s in
            switch s.value {
            case 0x2E80...0x2FDF, 0x3005, 0x3007, 0x3021...0x3029, 0x3038...0x303B, 0x3040...0x30FF, 0x3100...0x312F,
                 0x3130...0x318F, 0x31A0...0x31FF, 0x3400...0x4DBF, 0x4E00...0x9FFF, 0xA960...0xA97F, 0xAC00...0xD7FF,
                 0xF900...0xFAFF, 0x1100...0x11FF, 0x20000...0x2FA1F:
                return true
            default:
                return false
            }
        }
    }

    /// Cursive scripts (Arabic, Syriac, N'Ko, Mongolian, Adlam): their letters join, so a held word
    /// is never set one grapheme at a time.
    static func isJoined(_ text: String) -> Bool {
        text.unicodeScalars.contains { s in
            switch s.value {
            case 0x0600...0x06FF, 0x0750...0x077F, 0x08A0...0x08FF, 0xFB50...0xFDFF, 0xFE70...0xFEFF, 0x0700...0x074F,
                 0x07C0...0x07FF, 0x1800...0x18AF, 0x1E900...0x1E95F:
                return true
            default:
                return false
            }
        }
    }

    /// The user-perceived characters (Swift's Characters are grapheme clusters).
    static func graphemes(_ text: String) -> [String] {
        text.map(String.init)
    }

    /// Held-word emphasis (§5.5): ≥ 1000 ms and 2–7 graphemes (CJK: duration only), never under
    /// 150 ms and never in a joined script. The last word of a line swells 1.4× more, capped at 8%.
    static func emphasis(_ w: LyricWord, last: Bool) -> LyricEmphasis? {
        let E = LyricsConfig.Emphasis.self
        let dur = w.end - w.start
        if dur < 150 || dur < E.minMs || isJoined(w.text) { return nil }
        let n = graphemes(w.text).count
        if !isCJK(w.text), n < E.minG || n > E.maxG { return nil }
        let a = min(1.2, (dur - E.minMs) / 1500 + 0.6) * (last ? 1.4 : 1)
        return LyricEmphasis(
            swell: min(E.swellMax, 0.05 * a), lift: min(0.08, 0.05), spread: min(0.04, 0.03 * a),
            stepMs: dur / 2.5 / Double(max(1, n)))
    }

    private static let parentheses = try? NSRegularExpression(pattern: #"\s*\(([^()]+)\)"#)

    /// Line-synced sources mark backing vocals with parentheses (§5.6): `lead (backing)`.
    static func splitBacking(_ text: String) -> (lead: String, backing: [String]) {
        guard let re = parentheses else { return (text, []) }
        let ns = text as NSString
        var lead = ""
        var backing: [String] = []
        var at = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            lead += ns.substring(with: NSRange(location: at, length: m.range.location - at))
            backing.append(ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines))
            at = m.range.location + m.range.length
        }
        lead += ns.substring(from: at)
        lead = lead.trimmingCharacters(in: .whitespacesAndNewlines)
        return lead.isEmpty ? (text, []) : (lead, backing)
    }

    /// Duet sides, decided once per document (§4.3): with opposite-aligned lines those go right and
    /// the rest left; with two or more agents and no flags, the first agent left and the others
    /// right. A group's lines stay centred (everyone sings them).
    static func sides(_ doc: LyricsDoc) -> (LyricLine) -> LyricSide {
        var agents: [String] = []
        for l in doc.lines {
            if let a = l.agent, !a.isEmpty, !agents.contains(a) { agents.append(a) }
        }
        let flagged = doc.lines.contains { $0.oppositeAligned }
        if !flagged, agents.count < 2 { return { _ in .centre } }
        let group = Set(doc.agents.filter { $0.kind == "group" }.map(\.id))
        let first = agents.first
        return { l in
            if let a = l.agent, group.contains(a) { return .centre }
            if flagged { return l.oppositeAligned ? .right : .left }
            if let a = l.agent, !a.isEmpty, a != first { return .right }
            return .left
        }
    }

    private static func isLetter(_ s: Unicode.Scalar) -> Bool {
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: true
        default: false
        }
    }

    private static func isRTL(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x0590...0x05FF, 0xFB1D...0xFB4F, 0x0600...0x06FF, 0x0750...0x077F, 0x08A0...0x08FF, 0xFB50...0xFDFF,
             0xFE70...0xFEFF, 0x0700...0x074F, 0x0780...0x07BF, 0x07C0...0x07FF:
            true
        default:
            false
        }
    }
}
