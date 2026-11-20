import Foundation
import Testing

// Settings parity with the Android app (docs/superpowers/plans/apple-settings-parity.md): what each
// setting stores (the user's `/me/settings`, one key at a time, or this device's DeviceSettings),
// the preferences loaded at sign-in, and what the ones with a hook do: the player's quality, the
// lyrics' offset, size, unsynced and motion, VoiceOver's lines, the room's brightness.

@MainActor
@Suite("Settings: the user's")
struct UserSettingsEditorTests {
    func session(_ stub: Stub, token: String? = "echo_dt_test") -> Session {
        Session(
            server: stub.base, tokens: MemoryTokenStore(token), http: stub.session, deviceName: { "Test" }, cache: nil,
            watchNetwork: false)
    }

    /// Each user setting Settings changes: its section and key, the value sent, and the change.
    typealias Case = (section: String, key: String, value: Any, change: @MainActor (inout UserSettings) -> Void)

    static let cases: [Case] = [
        ("playback", "replayGain", "album", { $0.playback.replayGain = .album }),
        ("playback", "scrobble", false, { $0.playback.scrobble = false }),
        ("lyrics", "sizeScale", 1.3, { $0.lyrics.sizeScale = 1.3 }),
        ("lyrics", "globalOffsetMs", 150, { $0.lyrics.globalOffsetMs = 150 }),
        ("lyrics", "showUnsynced", false, { $0.lyrics.showUnsynced = false }),
        ("lyrics", "announceLines", true, { $0.lyrics.announceLines = true }),
        ("visuals", "motion", "reduced", { $0.visuals.motion = .reduced }),
    ]

    @Test("Each setting goes up as its own key and no other")
    func oneKey() async throws {
        for c in Self.cases {
            let stub = Stub()
            stub.on("PUT", "/me/settings", .fixture("settings"))
            let editor = SettingsEditor(session: session(stub))
            await editor.save(c.change).value
            let sent = try #require(stub.requests("PUT", "/me/settings").first, "\(c.key)")
            #expect(sent.bearer == "echo_dt_test")
            let json = try #require(sent.json)
            #expect(Set(json.keys) == [c.section], "\(c.key)")
            let section = try #require(json[c.section] as? [String: Any])
            #expect(Set(section.keys) == [c.key])
            let sentValue = try #require(section[c.key])
            #expect((sentValue as AnyObject).isEqual(c.value as AnyObject), "\(c.key)")
            #expect(editor.failure == nil)
        }
    }

    @Test("A lyric source switched off goes up as the list of those off, in the sources' order")
    func sources() async throws {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings"))
        let editor = SettingsEditor(session: session(stub))
        await editor.save { $0.lyrics.disabledSources = SettingsText.sources($0.lyrics.disabledSources, .spicy, on: false) }.value
        let json = try #require(stub.requests("PUT", "/me/settings").first?.json)
        #expect((json["lyrics"] as? [String: Any])?["disabledSources"] as? [String] == ["spicy"])
        #expect(SettingsText.sources([.spicy], .lrclib, on: false) == [.spicy, .lrclib])
        #expect(SettingsText.sources([.spicy, .lrclib], .spicy, on: true) == [.lrclib])
        #expect(SettingsText.sources([], .navidromePlain, on: true).isEmpty)
    }

    @Test("A change shows at once; quick changes go up one after the other")
    func inOrder() async throws {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings"))
        let session = session(stub)
        let editor = SettingsEditor(session: session)
        let a = editor.save { $0.lyrics.globalOffsetMs = 50 }
        let b = editor.save { $0.lyrics.globalOffsetMs = 100 }
        await a.value
        await b.value
        let offsets = stub.requests("PUT", "/me/settings").compactMap {
            ($0.json?["lyrics"] as? [String: Any])?["globalOffsetMs"] as? Int
        }
        #expect(offsets == [50, 100])
    }

    @Test("A change the server refuses goes back, with the reason shown")
    func refused() async throws {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings-refused", status: 400))
        let session = session(stub)
        let editor = SettingsEditor(session: session)
        await editor.save { $0.lyrics.announceLines = true }.value
        #expect(!session.settings.lyrics.announceLines)
        #expect(editor.failure != nil)
        stub.on("PUT", "/me/settings", .fixture("settings"))
        await editor.save { $0.playback.scrobble = false }.value
        #expect(editor.failure == nil)
    }

    @Test("Settings shown from a session that never reaches the network: the preview's")
    func demoSession() async {
        let session = Session.demo(server: URL(string: "https://echo.test")!, signedIn: true)
        let editor = SettingsEditor(session: session)
        #expect(session.settings.lyrics.sizeScale == 1)
        await editor.save { $0.lyrics.sizeScale = 1.15 }.value
        #expect(session.settings.lyrics.sizeScale == 1.15)
        #expect(editor.failure == nil)
    }

    @Test("Signing in loads the saved preferences: what Settings shows")
    func loadedAtSignIn() async {
        let stub = Stub()
        stub.on("GET", "/me", .fixture("me"))
        stub.on("GET", "/me/settings", .fixture("settings-saved"))
        let session = session(stub, token: "echo_dt_kept")
        #expect(session.settings == UserSettings()) // the defaults until the server answers
        await session.refresh()
        #expect(!session.settings.lyrics.showUnsynced)
        #expect(session.settings.appearance.theme == .glass)
        #expect(stub.requests("GET", "/me/settings").count == 1)
    }

    @Test("The offset is held to what the server takes, and named with its sign")
    func offsetWords() {
        #expect(SettingsText.clampOffset(2050) == 2000)
        #expect(SettingsText.clampOffset(-9000) == -2000)
        #expect(SettingsText.clampOffset(150) == 150)
        #expect(SettingsText.offset(0) == "0 ms")
        #expect(SettingsText.offset(150) == "+150 ms")
        #expect(SettingsText.offset(-50) == "−50 ms")
        #expect(SettingsText.sizes.map(SettingsText.size) == ["Small", "Default", "Large", "Largest"])
    }
}

@MainActor
@Suite("Settings: this device's")
struct DeviceSettingsTests {
    func defaults() -> UserDefaults {
        UserDefaults(suiteName: "echo.test.\(UUID().uuidString)")!
    }

    @Test("Quality, brightness and Performance mode are kept on this device and read back")
    func kept() {
        let store = defaults()
        let a = DeviceSettings(defaults: store)
        #expect(a.streamQuality == .auto)
        #expect(a.backdrop == 0.5)
        #expect(!a.performance)
        a.setStreamQuality(.kbps192)
        a.setBackdrop(0.8)
        a.setPerformance(true)
        let b = DeviceSettings(defaults: store)
        #expect(b.streamQuality == .kbps192)
        #expect(b.backdrop == 0.8)
        #expect(b.performance)
    }

    @Test("A brightness outside 0…1 is held to it, and a saved nonsense reads as the default")
    func clamped() {
        let store = defaults()
        let a = DeviceSettings(defaults: store)
        a.setBackdrop(3)
        #expect(a.backdrop == 1)
        a.setBackdrop(-1)
        #expect(a.backdrop == 0)
        store.set("loud", forKey: DeviceSettings.streamQualityKey)
        #expect(DeviceSettings(defaults: store).streamQuality == .auto)
    }

    @Test("The room's light follows the brightness: as designed at the middle")
    func roomStrength() {
        let d = DeviceSettings(defaults: nil)
        #expect(d.roomStrength(0.55) == 0.55)
        d.setBackdrop(0)
        #expect(d.roomStrength(0.55) == 0)
        d.setBackdrop(1)
        #expect(d.roomStrength(0.55) == 1)
        d.setBackdrop(0.25)
        #expect(abs(d.roomStrength(0.5) - 0.25) < 0.0001)
    }

    @Test("Performance mode holds motion to Reduced; Off stays Off")
    func performance() {
        var visuals = UserSettings.Visuals()
        for motion in UserSettings.Motion.allCases {
            visuals.motion = motion
            #expect(visuals.effectiveMotion(performance: false) == motion)
            #expect(visuals.effectiveMotion(performance: true) == (motion == .off ? .off : .reduced))
        }
    }
}

@MainActor
@Suite("Settings: what they do")
struct SettingsEffectTests {
    @Test("The quality chosen is the one the player asks the stream for")
    func playerQuality() async throws {
        let rig = Rig()
        let player = try #require(rig.player)
        rig.quality = .kbps128
        await player.play(songs(1...2), at: 0, context: albumContext)
        #expect(!rig.source.qualities.isEmpty)
        #expect(rig.source.qualities.allSatisfy { $0 == .kbps128 })
        let plain = Rig()
        await plain.player.play(songs(1...2), at: 0, context: albumContext)
        #expect(plain.source.qualities.first == .auto)
    }

    @Test("Auto plays what the phone can as stored; a bit rate asks for MP3 at it, whatever the format")
    func streamFormat() {
        func track(_ suffix: String) -> Track {
            Track(id: "1", title: "", artists: [], album: AlbumRef(id: nil, title: "", key: ""), durationMs: 0, suffix: suffix)
        }
        func format(_ t: Track, _ q: StreamQuality) -> String {
            EchoClient.streamFormat(for: t, quality: q).map { "\($0.0)=\($0.1)" }.joined(separator: "&")
        }
        #expect(format(track("flac"), .auto) == "format=raw")
        #expect(format(track("opus"), .auto) == "format=mp3&maxBitRate=320&estimateContentLength=true")
        #expect(format(track("flac"), .kbps192) == "format=mp3&maxBitRate=192&estimateContentLength=true")
        #expect(format(track("mp3"), .kbps128) == "format=mp3&maxBitRate=128&estimateContentLength=true")
        #expect(format(track("flac"), .kbps320) == "format=mp3&maxBitRate=320&estimateContentLength=true")
        #expect(StreamQuality.allCases.map(\.label) == ["Auto", "320 kbit/s", "192 kbit/s", "128 kbit/s"])
    }

    @Test("The lyrics' timing is the track's offset and the global one from Settings")
    func lyricOffset() {
        let box = SettingsBox()
        box.settings.lyrics.globalOffsetMs = -250
        let lyrics = Lyrics(source: FakeLyricsSource(), settings: { box.settings })
        #expect(lyrics.globalOffsetMs == -250)
        #expect(lyrics.totalOffsetMs == -250)
        #expect(lyrics.preferences.lyrics.sizeScale == 1)
        box.settings.lyrics.sizeScale = 1.3
        box.settings.lyrics.showUnsynced = false
        #expect(lyrics.preferences.lyrics.sizeScale == 1.3)
        #expect(!lyrics.preferences.lyrics.showUnsynced)
    }

    @Test("VoiceOver is told each new line, when announcing is on")
    func announce() {
        #expect(LyricAnnouncement.line(from: nil, to: "Hold the light", enabled: true) == "Hold the light")
        #expect(LyricAnnouncement.line(from: "Hold the light", to: "Over the water", enabled: true) == "Over the water")
        #expect(LyricAnnouncement.line(from: "Hold the light", to: "Hold the light", enabled: true) == nil)
        #expect(LyricAnnouncement.line(from: "Hold the light", to: nil, enabled: true) == nil)
        #expect(LyricAnnouncement.line(from: nil, to: "  ", enabled: true) == nil)
        #expect(LyricAnnouncement.line(from: nil, to: "Hold the light", enabled: false) == nil)
    }
}

@MainActor
private final class SettingsBox {
    var settings = UserSettings()
}
