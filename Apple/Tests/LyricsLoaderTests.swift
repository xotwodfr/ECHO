import Foundation
import Testing

// The lyrics from ECHO (`GET /lyrics`, `PUT /me/tracks/{trackKey}/override`) against the server's
// recorded answers (scripts/apple-fixtures.ts: the server's own lyric sources on its mock Navidrome
// and LRCLIB), and the store that follows the playing track as the web's loader does
// (src/client/lyrics/loader.ts): the 250 ms wait, the 6 s give-up and a late answer, answers for
// another track dropped, the next song's lyrics asked ahead, the offset's steps and saves, the pin.

private let harbour1 = Track(
    id: "al-1-t1", title: "Harbour Lights 1", artists: [ArtistRef(id: "ar-1", name: "Lowfield")],
    album: AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"), durationMs: 20000)

@Suite("Lyrics: from ECHO")
struct LyricsApiTests {
    @Test("Asks for the track by its key and the metadata in the shared cache key; reads word-synced lyrics")
    func wordSynced() async throws {
        let stub = Stub().on("GET", "/lyrics", .fixture("lyrics-word"))
        let client = EchoClient(base: stub.base, token: "echo_dt_test_token_not_a_secret", http: stub.session)
        let answer = try await client.lyrics(for: harbour1)
        let doc = try #require(answer.doc)
        #expect(doc.sync == .word)
        #expect(doc.source == "navidrome")
        #expect(doc.attribution.text == "Lyrics from your library")
        #expect(doc.lines.map(\.text) == ["First line here", "Second line here"])
        #expect(doc.lines[0].words?.map(\.text) == ["First", "line", "here"])
        #expect(doc.lines[0].words?.first?.start == 1000)
        #expect(doc.lines[0].end == 3600)
        #expect(answer.override == LyricsOverride(offsetMs: 0, pinnedSource: nil))
        let sent = try #require(stub.requests("GET", "/lyrics").first)
        #expect(sent.query["trackKey"] == "navidrome:al-1-t1")
        #expect(sent.query["title"] == "Harbour Lights 1")
        #expect(sent.query["artist"] == "Lowfield")
        #expect(sent.query["album"] == "Harbour Lights")
        #expect(sent.query["durationMs"] == "20000")
        #expect(sent.query["isrc"] == nil)
        #expect(sent.bearer == "echo_dt_test_token_not_a_secret")
    }

    @Test("Line-synced lyrics (LRCLIB), plain text from the tags, and the ISRC when the track has one")
    func lineAndPlain() async throws {
        let stub = Stub().on("GET", "/lyrics", .fixture("lyrics-line"), .fixture("lyrics-plain"))
        let client = EchoClient(base: stub.base, http: stub.session)
        var track = harbour1
        track.isrc = "GBAYE0601498"
        let line = try #require(try await client.lyrics(for: track).doc)
        #expect(line.sync == .line)
        #expect(line.source == "lrclib")
        #expect(line.lines.allSatisfy { $0.words == nil })
        #expect(line.lines.first?.text.hasPrefix("Glass in the morning") == true)
        #expect(line.attribution.text == "Lyrics from LRCLIB")
        #expect(line.attribution.links == [LyricsAttribution.Link(label: "LRCLIB", href: "https://lrclib.net")])
        #expect(stub.requests("GET", "/lyrics").first?.query["isrc"] == "GBAYE0601498")
        let plain = try #require(try await client.lyrics(for: harbour1).doc)
        #expect(plain.sync == .plain)
        #expect(plain.source == "navidrome-plain")
        #expect(plain.lines.map(\.text) == ["Plain words", "from tags"])
        #expect(LyricTimeline(plain).field(at: 10_000).active == -1)
    }

    @Test("None found (404): the sources tried, with the user's override for the track")
    func notFound() async throws {
        let stub = Stub().on("GET", "/lyrics", .fixture("lyrics-not-found", status: 404))
        let client = EchoClient(base: stub.base, http: stub.session)
        let answer = try await client.lyrics(for: harbour1)
        #expect(answer.doc == nil)
        #expect(answer.tried.map(\.source) == ["navidrome", "navidrome-plain", "lrclib"])
        #expect(answer.tried.allSatisfy { $0.outcome == "notFound" })
        #expect(Lyrics.triedText(answer.tried) == "Your library: not found · Your library (plain text): not found · LRCLIB: not found")
    }

    @Test("The user's offset comes with the lyrics; ECHO not answering is an error")
    func overrideAndErrors() async throws {
        let stub = Stub().on("GET", "/lyrics", .fixture("lyrics-word-override"), .failure(.timedOut))
        let client = EchoClient(base: stub.base, http: stub.session)
        #expect(try await client.lyrics(for: harbour1).override.offsetMs == 150)
        await #expect(throws: ApiError.unreachable) { try await client.lyrics(for: harbour1) }
    }

    @Test("Saves the offset and the pin for the track (null: automatic); refuses an offset out of range")
    func saves() async throws {
        let path = "/me/tracks/navidrome:al-1-t1/override"
        let stub = Stub().on(
            "PUT", path, .fixture("lyrics-override-offset"), .fixture("lyrics-override-pin"),
            .fixture("lyrics-override-unpin"), .fixture("lyrics-override-bad", status: 400))
        let client = EchoClient(base: stub.base, http: stub.session)
        try await client.saveOverride(trackKey: "navidrome:al-1-t1", .offset(150))
        try await client.saveOverride(trackKey: "navidrome:al-1-t1", .pin("lrclib"))
        try await client.saveOverride(trackKey: "navidrome:al-1-t1", .pin(nil))
        await #expect(throws: ApiError.server(status: 400, code: "bad_offset")) {
            try await client.saveOverride(trackKey: "navidrome:al-1-t1", .offset(20_000))
        }
        let sent = stub.requests("PUT", path)
        #expect(sent.count == 4)
        #expect(sent[0].json?["offsetMs"] as? Int == 150)
        #expect(sent[0].json?["pinnedSource"] == nil)
        #expect(sent[1].json?["pinnedSource"] as? String == "lrclib")
        #expect(sent[2].json?["pinnedSource"] is NSNull)
        // The key is one path segment: its colon travels percent-encoded.
        #expect(stub.requests.allSatisfy { $0.path == path })
    }
}

/// A store on a fake source, with waits the test lets pass.
@MainActor
private final class LyricsRig {
    let source = FakeLyricsSource()
    let gate = Gate()
    var settings = UserSettings()
    var next: Track? = nil
    private(set) var toasts: [String] = []
    private(set) var lyrics: Lyrics!

    init() {
        lyrics = Lyrics(
            source: source, settings: { [weak self] in self?.settings ?? UserSettings() },
            upcoming: { [weak self] in self?.next }, notify: { [weak self] in self?.toasts.append($0) },
            sleep: gate.sleep)
    }
}

private func lyricSong(_ id: String, seconds: Int = 200) -> Track {
    Track(
        id: id, title: "Song \(id)", artists: [ArtistRef(id: "ar-1", name: "Lowfield")],
        album: AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"), durationMs: seconds * 1000)
}

@MainActor
@Suite("Lyrics: following the track")
struct LyricsStoreTests {
    @Test("Waits 250 ms after a change, then the lyrics are ready with the track's offset and pin")
    func ready() async throws {
        let rig = LyricsRig()
        let lyrics = try #require(rig.lyrics)
        let a = lyricSong("a")
        rig.source.answers[a.key] = .success(LyricsAnswer(
            doc: lyricsDoc(a.key), override: LyricsOverride(offsetMs: 150, pinnedSource: "lrclib")))
        lyrics.follow(a)
        guard case .waiting = lyrics.phase else {
            Issue.record("not waiting: \(lyrics.phase)")
            return
        }
        #expect(rig.source.asked.isEmpty)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.doc != nil })
        #expect(rig.source.asked == [a.key])
        #expect(lyrics.offsetMs == 150)
        #expect(lyrics.pinnedSource == "lrclib")
        #expect(lyrics.doc?.trackKey == a.key)
        // The same track again asks nothing.
        lyrics.follow(a)
        #expect(lyrics.doc != nil)
        lyrics.follow(nil)
        #expect(lyrics.phase == .idle)
        #expect(lyrics.trackKey == nil)
        await rig.gate.passAll()
    }

    @Test("None found: the sources tried; an instrumental says so; ECHO not answering is an error")
    func missingAndFailed() async throws {
        let rig = LyricsRig()
        let lyrics = try #require(rig.lyrics)
        let (a, b, c) = (lyricSong("a"), lyricSong("b"), lyricSong("c"))
        rig.source.answers[a.key] = .success(LyricsAnswer(doc: nil, tried: [LyricsTried(source: "lrclib", outcome: "notFound")]))
        rig.source.answers[b.key] = .success(LyricsAnswer(doc: nil, tried: [LyricsTried(source: "spicy", outcome: "instrumental")]))
        rig.source.answers[c.key] = .failure(.unreachable)
        lyrics.follow(a)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.phase == .missing(tried: [LyricsTried(source: "lrclib", outcome: "notFound")]) })
        #expect(!lyrics.isInstrumental)
        lyrics.follow(b)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.isInstrumental })
        lyrics.follow(c)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.phase == .failed(.unreachable) })
        // Try Again asks once more.
        rig.source.answers[c.key] = .success(LyricsAnswer(doc: lyricsDoc(c.key)))
        lyrics.reload()
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.doc?.trackKey == c.key })
        await rig.gate.passAll()
    }

    @Test("An answer for a track that no longer plays is dropped; skipping costs no request")
    func staleDropped() async throws {
        let rig = LyricsRig()
        let lyrics = try #require(rig.lyrics)
        let (a, b, c) = (lyricSong("a"), lyricSong("b"), lyricSong("c"))
        rig.source.answers[a.key] = .success(LyricsAnswer(doc: lyricsDoc(a.key)))
        rig.source.answers[c.key] = .success(LyricsAnswer(doc: lyricsDoc(c.key)))
        rig.source.held = [a.key]
        lyrics.follow(a)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { rig.source.asked == [a.key] })
        // B for a moment (skipped within 250 ms: never asked), then C.
        lyrics.follow(b)
        lyrics.follow(c)
        rig.source.release(a.key)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.doc?.trackKey == c.key })
        #expect(rig.source.asked == [a.key, c.key])
        await rig.gate.passAll()
        #expect(lyrics.doc?.trackKey == c.key)
    }

    @Test("No answer in 6 s is no lyrics; a late answer still shows")
    func giveUp() async throws {
        let rig = LyricsRig()
        let lyrics = try #require(rig.lyrics)
        let a = lyricSong("a")
        rig.source.answers[a.key] = .success(LyricsAnswer(doc: lyricsDoc(a.key)))
        rig.source.held = [a.key]
        lyrics.follow(a)
        await rig.gate.pass(Lyrics.debounce)
        await rig.gate.pass(Lyrics.giveUp)
        #expect(await eventually { lyrics.phase == .missing(tried: []) })
        #expect(Lyrics.triedText([]) == "No source answered in time.")
        rig.source.release(a.key)
        #expect(await eventually { lyrics.doc?.trackKey == a.key })
        await rig.gate.passAll()
    }

    @Test("The next song's lyrics are asked ahead 2 s in, when this song is long enough")
    func prefetch() async throws {
        let rig = LyricsRig()
        let lyrics = try #require(rig.lyrics)
        let (a, short) = (lyricSong("a"), lyricSong("short", seconds: 21))
        rig.next = lyricSong("n")
        lyrics.follow(a)
        await rig.gate.pass(Lyrics.debounce)
        await rig.gate.pass(Lyrics.prefetchAfter)
        #expect(await eventually { rig.source.asked == [a.key, "navidrome:n"] })
        lyrics.follow(short)
        await rig.gate.pass(Lyrics.debounce)
        await rig.gate.pass(Lyrics.prefetchAfter)
        #expect(await eventually { rig.source.asked.count == 3 })
        try? await Task.sleep(for: .milliseconds(50))
        #expect(rig.source.asked == [a.key, "navidrome:n", short.key])
        await rig.gate.passAll()
    }

    @Test("The offset: ±50 ms a step within ±10 s, said with the total, saved once 500 ms after the last step")
    func offset() async throws {
        let rig = LyricsRig()
        let lyrics = try #require(rig.lyrics)
        rig.settings.lyrics.globalOffsetMs = 100
        let a = lyricSong("a")
        rig.source.answers[a.key] = .success(LyricsAnswer(doc: lyricsDoc(a.key), override: LyricsOverride(offsetMs: 50)))
        lyrics.follow(a)
        // Until the track's answer comes its saved offset is unknown: a step would overwrite it.
        lyrics.nudge(1)
        #expect(lyrics.offsetMs == 0)
        #expect(rig.toasts.isEmpty)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.doc != nil })
        #expect(lyrics.totalOffsetMs == 150)
        lyrics.nudge(1)
        lyrics.nudge(1)
        lyrics.nudge(-1)
        #expect(lyrics.offsetMs == 100)
        #expect(rig.toasts == ["Lyrics +200 ms", "Lyrics +250 ms", "Lyrics +200 ms"])
        await rig.gate.pass(Lyrics.saveAfter)
        #expect(await eventually { !rig.source.saved.isEmpty })
        try? await Task.sleep(for: .milliseconds(50))
        #expect(rig.source.saved == ["navidrome:a offset 100"])
        lyrics.resetOffset()
        #expect(rig.toasts.last == "Lyrics +100 ms")
        for _ in 0..<300 { lyrics.nudge(-1) }
        #expect(lyrics.offsetMs == -10_000)
        rig.settings.lyrics.globalOffsetMs = 0
        lyrics.nudge(1)
        lyrics.nudge(1)
        #expect(lyrics.offsetMs == -9900)
        #expect(Lyrics.offsetMessage(0) == "Lyrics on time")
        #expect(Lyrics.offsetMessage(-150) == "Lyrics −150 ms")
        await rig.gate.passAll()
    }

    @Test("A source pinned for the track is saved, then the lyrics asked again")
    func pin() async throws {
        let rig = LyricsRig()
        let lyrics = try #require(rig.lyrics)
        let a = lyricSong("a")
        rig.source.answers[a.key] = .success(LyricsAnswer(doc: lyricsDoc(a.key)))
        lyrics.follow(a)
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.doc != nil })
        rig.source.answers[a.key] = .success(LyricsAnswer(
            doc: lyricsDoc(a.key, source: "lrclib"), override: LyricsOverride(pinnedSource: "lrclib")))
        await lyrics.pin("lrclib")
        #expect(rig.source.saved == ["navidrome:a pin lrclib"])
        guard case .waiting = lyrics.phase else {
            Issue.record("not asked again: \(lyrics.phase)")
            return
        }
        await rig.gate.pass(Lyrics.debounce)
        #expect(await eventually { lyrics.doc?.source == "lrclib" })
        #expect(lyrics.pinnedSource == "lrclib")
        await lyrics.pin(nil)
        #expect(rig.source.saved.last == "navidrome:a pin auto")
        await rig.gate.passAll()
    }

    @Test("Names: the sources, the sync")
    func names() {
        #expect(Lyrics.sourceName("lrclib") == "LRCLIB")
        #expect(Lyrics.sourceName("navidrome") == "Your library")
        #expect(Lyrics.sourceName("someday") == "someday")
        #expect(Lyrics.sourceNames.count == UserSettings.LyricSource.allCases.count)
        #expect(Set(Lyrics.sourceNames.map(\.id)) == Set(UserSettings.LyricSource.allCases.map(\.rawValue)))
    }
}
