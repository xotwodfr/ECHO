import Foundation

// A song's lyrics as ECHO's server sends them (`GET /lyrics`, docs/api/openapi.yaml `LyricsDoc`;
// src/shared/types.ts, LYRICS_INTEGRATION.md §5): word-synced (each word or syllable timed),
// line-synced (each line's start, its end when the source has one) or plain text. Times are ms from
// the song's start. A value the server adds later, or leaves out, reads as its default.

/// One timed word or syllable. `isPartOfWord`: no space before the next one (a syllable).
struct LyricWord: Hashable, Sendable {
    var text: String
    var start: Double
    var end: Double
    var isPartOfWord = false
}

/// Backing vocals under their lead line (Spicy's `Background[]`, TTML's `x-bg`).
struct LyricBacking: Hashable, Sendable {
    var text: String
    var start: Double? = nil
    var end: Double? = nil
    var words: [LyricWord]? = nil
}

struct LyricLine: Hashable, Sendable {
    /// The whole line as shown (its words joined).
    var text: String
    /// When it starts (0 in plain lyrics).
    var start: Double
    /// When it ends: line-synced sources may leave it out.
    var end: Double? = nil
    /// The vocalist, in a duet.
    var agent: String? = nil
    /// The second voice of a duet, set on the far side.
    var oppositeAligned = false
    /// Word-synced lyrics only.
    var words: [LyricWord]? = nil
    var background: [LyricBacking]? = nil
}

enum LyricSync: String, Sendable {
    case word, line
    /// Plain text, untimed (`none` on the wire).
    case plain = "none"
}

struct LyricsAttribution: Hashable, Sendable {
    struct Link: Hashable, Sendable {
        var label: String
        var href: String
    }

    var text: String
    var links: [Link] = []
}

struct LyricAgent: Hashable, Sendable {
    var id: String
    var name: String? = nil
    /// person, group or other.
    var kind = "person"
}

struct LyricsDoc: Hashable, Sendable {
    var version = 1
    var trackKey: String
    var sync: LyricSync
    /// navidrome, spicy, netease, lrclib, navidrome-plain (fixture: the web's built-in documents).
    var source: String
    var attribution: LyricsAttribution
    /// The source's own offset; the server applies it to the times, so it is 0 here.
    var offsetMs: Double = 0
    var durationMs: Double? = nil
    var agents: [LyricAgent] = []
    var lines: [LyricLine]
    var fetchedAt = ""

    /// Which document this is, cheaply (a new answer for the track, another source).
    var id: String { "\(trackKey)|\(source)|\(sync.rawValue)|\(fetchedAt)|\(lines.count)" }
}

/// The user's own timing and source for a track (`/me/tracks/{trackKey}/override`).
struct LyricsOverride: Hashable, Sendable {
    /// How much later the words show, ±10 s.
    var offsetMs = 0
    /// Always this source for the track; nil: the server chooses.
    var pinnedSource: String? = nil
}

/// A source the server asked, and what it said (notFound, instrumental, mismatch, invalid, error,
/// timeout, skipped).
struct LyricsTried: Hashable, Sendable {
    var source: String
    var outcome: String
}

/// `GET /lyrics`: the document with the user's override for the track (200), or the sources tried
/// (404, no source had them).
struct LyricsAnswer: Hashable, Sendable {
    var doc: LyricsDoc?
    var tried: [LyricsTried] = []
    var override = LyricsOverride()
}

// MARK: - Reading them

extension LyricWord: Decodable {
    private enum CodingKeys: String, CodingKey { case text, start, end, isPartOfWord }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.value(.text, "")
        start = try c.decode(Double.self, forKey: .start)
        end = c.value(.end, start)
        isPartOfWord = c.value(.isPartOfWord, false)
    }
}

extension LyricBacking: Decodable {
    private enum CodingKeys: String, CodingKey { case text, start, end, words }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.value(.text, "")
        start = c.value(.start, nil as Double?)
        end = c.value(.end, nil as Double?)
        words = c.value(.words, nil as [LyricWord]?)
    }
}

extension LyricLine: Decodable {
    private enum CodingKeys: String, CodingKey { case text, start, end, agent, oppositeAligned, words, background }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.value(.text, "")
        start = c.value(.start, 0.0)
        end = c.value(.end, nil as Double?)
        agent = c.value(.agent, nil as String?)
        oppositeAligned = c.value(.oppositeAligned, false)
        words = c.value(.words, nil as [LyricWord]?)
        background = c.value(.background, nil as [LyricBacking]?)
    }
}

extension LyricSync: Decodable {}

extension LyricsAttribution: Decodable {
    private enum CodingKeys: String, CodingKey { case text, links }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.value(.text, "")
        links = c.value(.links, [Link]())
    }
}

extension LyricsAttribution.Link: Decodable {}

extension LyricAgent: Decodable {
    private enum CodingKeys: String, CodingKey { case id, name, kind }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, nil as String?)
        kind = c.value(.kind, "person")
    }
}

extension LyricsDoc: Decodable {
    private enum CodingKeys: String, CodingKey {
        case version, trackKey, sync, source, attribution, offsetMs, durationMs, agents, lines, fetchedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.value(.version, 1)
        trackKey = c.value(.trackKey, "")
        sync = try c.decode(LyricSync.self, forKey: .sync)
        source = c.value(.source, "")
        attribution = c.value(.attribution, LyricsAttribution(text: ""))
        offsetMs = c.value(.offsetMs, 0.0)
        durationMs = c.value(.durationMs, nil as Double?)
        agents = c.value(.agents, [LyricAgent]())
        lines = try c.decode([LyricLine].self, forKey: .lines)
        fetchedAt = c.value(.fetchedAt, "")
    }
}

extension LyricsOverride: Decodable {
    private enum CodingKeys: String, CodingKey { case offsetMs, pinnedSource }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        offsetMs = c.value(.offsetMs, 0)
        pinnedSource = c.value(.pinnedSource, nil as String?)
    }
}

extension LyricsTried: Decodable {}

extension LyricsAnswer: Decodable {
    private enum CodingKeys: String, CodingKey { case doc, tried, override }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        doc = try c.decodeIfPresent(LyricsDoc.self, forKey: .doc)
        tried = c.value(.tried, [LyricsTried]())
        override = c.value(.override, LyricsOverride())
    }
}
