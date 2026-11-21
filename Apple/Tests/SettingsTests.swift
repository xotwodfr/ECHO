import Foundation
import Testing

// The preferences that follow the user (`/me/settings`): the server's answer read with the web's
// keys and defaults, a value this app does not know read as the default, and changes sent one key
// at a time, put back if the server refuses them.

@Suite("Preferences")
struct SettingsTests {
    @Test("The server's defaults read as the app's defaults")
    func defaults() throws {
        let settings = try JSONDecoder().decode(UserSettings.self, from: Fixture.data("settings"))
        #expect(settings == UserSettings())
        #expect(settings.playback.replayGain == .auto)
        #expect(settings.playback.scrobble)
        #expect(settings.lyrics.sizeScale == 1)
        #expect(settings.lyrics.disabledSources.isEmpty)
        #expect(settings.visuals.intensity == .expressive)
        #expect(settings.appearance.theme == .echo)
        #expect(settings.appearance.dark == .theme)
        #expect(settings.games.songGuesser == UserSettings.GameRecord())
    }

    @Test("Saved values, and ones this app does not know")
    func tolerant() throws {
        let saved = try JSONDecoder().decode(UserSettings.self, from: Fixture.data("settings-saved"))
        #expect(saved.appearance.theme == .glass)
        #expect(!saved.lyrics.showUnsynced)

        let json = """
        {"version":3,"appearance":{"theme":"aurora","dark":"dark"},"lyrics":{"sizeScale":1.15,
         "disabledSources":["lrclib","somewhere-new"]},"playback":{"scrobble":"yes"},"newSection":{"x":1}}
        """
        let s = try JSONDecoder().decode(UserSettings.self, from: Data(json.utf8))
        #expect(s.appearance.theme == .echo) // a theme from a newer server: the default
        #expect(s.appearance.dark == .dark)
        #expect(s.lyrics.sizeScale == 1.15)
        #expect(s.lyrics.disabledSources == [.lrclib])
        #expect(s.playback.scrobble) // not a boolean: the default
        #expect(s.visuals == UserSettings.Visuals())
    }

    @Test("A change goes up as only the keys that changed")
    func patch() throws {
        let before = UserSettings()
        var after = before
        after.appearance.theme = .glass
        after.lyrics.disabledSources = [.spicy, .navidromePlain]
        after.lyrics.sizeScale = 1.3
        let patched = try after.patch(from: before)
        let data = try #require(patched)
        let object = try JSONSerialization.jsonObject(with: data)
        let json = try #require(object as? [String: [String: Any]])
        #expect(Set(json.keys) == ["appearance", "lyrics"])
        #expect(json["appearance"]?.count == 1)
        #expect(json["appearance"]?["theme"] as? String == "glass")
        #expect(json["lyrics"]?["disabledSources"] as? [String] == ["spicy", "navidrome-plain"])
        #expect(json["lyrics"]?["sizeScale"] as? Double == 1.3)
        #expect(json["version"] == nil)
        let none = try before.patch(from: before)
        #expect(none == nil)
    }

    @Test("A change shows at once, and the server's answer is kept")
    @MainActor
    func update() async throws {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings-saved"))
        let session = Session(
            server: stub.base, tokens: MemoryTokenStore("echo_dt_test"), http: stub.session, deviceName: { "Test" },
            cache: nil, watchNetwork: false)
        try await session.updateSettings { $0.appearance.theme = .glass }
        #expect(session.settings.appearance.theme == .glass)
        #expect(!session.settings.lyrics.showUnsynced) // as the server saved it
        let sent = try #require(stub.requests("PUT", "/me/settings").first)
        #expect(sent.bearer == "echo_dt_test")
        #expect((sent.json?["appearance"] as? [String: Any])?["theme"] as? String == "glass")
        #expect(sent.json?.count == 1)
    }

    @Test("A change the server refuses goes back")
    @MainActor
    func refused() async throws {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings-refused", status: 400))
        let session = Session(
            server: stub.base, tokens: MemoryTokenStore("echo_dt_test"), http: stub.session, deviceName: { "Test" },
            cache: nil, watchNetwork: false)
        await #expect(throws: ApiError.server(status: 400, code: "bad_settings")) {
            try await session.updateSettings { $0.visuals.grain = true }
        }
        #expect(!session.settings.visuals.grain)
    }

    @Test("Nothing changed, nothing sent")
    @MainActor
    func unchanged() async throws {
        let stub = Stub()
        let session = Session(
            server: stub.base, tokens: MemoryTokenStore("echo_dt_test"), http: stub.session, deviceName: { "Test" },
            cache: nil, watchNetwork: false)
        try await session.updateSettings { $0.playback.scrobble = true }
        #expect(stub.requests.isEmpty)
    }
}
