import Foundation

// The preview's lyrics (`-ECHODemo lyrics`, `lyrics-interlude`, `lyrics-plain`, `lyrics-menu`): the
// web's lyric fixtures (Preview/Lyrics, written from src/client/fixtures/lyrics.ts by
// scripts/apple-fixtures.ts: original text written for ECHO), answered at once and saved nowhere,
// with the song held at a fixed time as the web's `?fixture=…&frame=<ms>` holds it.

/// Lyrics from the built-in documents.
struct DemoLyricsSource: LyricsSource {
    let fixture: String

    func lyrics(for track: Track) async throws -> LyricsAnswer {
        guard let doc = DemoLyrics.doc(fixture) else {
            return LyricsAnswer(doc: nil, tried: [LyricsTried(source: "navidrome", outcome: "notFound")])
        }
        return LyricsAnswer(doc: doc)
    }

    func saveOverride(trackKey: String, _ change: LyricsOverrideChange) async throws {}
}

enum DemoLyrics {
    /// Where each lyrics screen holds the song (seconds): Ferry at Six (3:41) sings the ballad
    /// fixture (3:40).
    static func time(for screen: String) -> Double? {
        switch screen {
        // "So call me from the har·bour when it's late": "har", a held syllable, two thirds sung.
        case "lyrics", "lyrics-menu": 36.2
        // The 12 s bridge: the dots at their fullest, sung lines above, the next ones below.
        case "lyrics-interlude": 108
        case "lyrics-plain": 30
        default: nil
        }
    }

    static func fixture(for screen: String) -> String {
        screen == "lyrics-plain" ? "static" : "ballad-word"
    }

    /// A built-in document by its fixture name (ballad-word, static, duet-word…).
    static func doc(_ name: String, in bundle: Bundle = .main) -> LyricsDoc? {
        guard let url = bundle.url(forResource: name, withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(LyricsDoc.self, from: data)
    }
}

extension Lyrics {
    /// The preview's lyrics store, on the screen's fixture.
    static func demo(screen: String, library: Library) -> Lyrics {
        Lyrics(
            source: DemoLyricsSource(fixture: DemoLyrics.fixture(for: screen)),
            notify: { library.show(Toast(message: $0)) })
    }
}
