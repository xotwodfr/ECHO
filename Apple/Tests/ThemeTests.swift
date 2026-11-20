import Foundation
import Testing

// Task 11b: the themes. How the user's choice (`UserSettings.appearance`) resolves to a theme and its
// light or dark variant, that every theme made has all of its tokens, its lyric look and its sound files,
// what picking one saves, and what a press feels and sounds like (the five events, the theme's sounds,
// the two device switches) on a fake haptic engine and a fake sound player.

@Suite("Themes: resolving the choice")
struct ThemeResolveTests {
    @Test("ECHO is the default, in its dark variant, and the system is not asked")
    func defaults() {
        let r = Theme.resolve(UserSettings.Appearance(), systemDark: false)
        #expect(r.theme.id == .echo)
        #expect(r.dark)
        #expect(r.preferredDark == true)
        #expect(r.palette == Theme.echo.dark)
    }

    @Test("Light and Dark are fixed; System follows the device")
    func variants() {
        for system in [false, true] {
            let light = Theme.resolve(.init(theme: .glass, dark: .light), systemDark: system)
            #expect(!light.dark && light.preferredDark == false)
            #expect(light.palette == Theme.glass.light)
            let dark = Theme.resolve(.init(theme: .glass, dark: .dark), systemDark: system)
            #expect(dark.dark && dark.preferredDark == true)
            #expect(dark.palette == Theme.glass.dark)
            let follow = Theme.resolve(.init(theme: .echo, dark: .system), systemDark: system)
            #expect(follow.dark == system)
            #expect(follow.preferredDark == nil)
        }
    }

    @Test("The theme's own choice is its default: both made themes are dark")
    func themeOwn() {
        for theme in Theme.made {
            let r = Theme.resolve(.init(theme: theme.id, dark: .theme), systemDark: false)
            #expect(r.theme.id == theme.id)
            #expect(r.dark == (theme.defaultDark ?? false))
        }
    }

    @Test("A theme the server has and this app has not made shows as ECHO, as Material You does")
    func unmade() {
        for id in UserSettings.ThemeID.allCases where !Theme.made.contains(where: { $0.id == id }) {
            #expect(Theme.of(id).id == .echo, "\(id)")
        }
        #expect(Theme.of(.materialyou).id == .echo)
        #expect(Theme.of(.clay).id == .echo)
    }

    @Test("Now Playing's variant is always the dark one")
    func forcedDark() {
        let light = Theme.resolve(.init(theme: .glass, dark: .light), systemDark: false)
        #expect(light.forcedDark.dark)
        #expect(light.forcedDark.palette == Theme.glass.dark)
        #expect(light.forcedDark.theme == light.theme)
    }

    @Test("The picker offers only whole themes, each once, ECHO first")
    func made() {
        #expect(Theme.made.first?.id == .echo)
        #expect(Set(Theme.made.map(\.id)).count == Theme.made.count)
        for theme in Theme.made { #expect(Theme.of(theme.id) == theme) }
    }
}

@Suite("Themes: every token is there")
struct ThemeTokenTests {
    private func inRange(_ c: RGB) -> Bool {
        [c.r, c.g, c.b].allSatisfy { $0 >= 0 && $0 <= 1 }
    }

    private func luminance(_ c: RGB) -> Double { 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }

    @Test("Each theme has a name, a line, and complete light and dark palettes")
    func complete() {
        for theme in Theme.made {
            #expect(!theme.name.isEmpty && !theme.blurb.isEmpty, "\(theme.id)")
            for (label, p) in [("light", theme.light), ("dark", theme.dark)] {
                let colours = [p.tint, p.accent, p.highlight, p.warning, p.floor] + p.swatch
                #expect(colours.allSatisfy(inRange), "\(theme.id) \(label)")
                #expect(p.swatch.count == 3, "\(theme.id) \(label)")
                #expect(p.roomStrength > 0 && p.roomHeight > 0, "\(theme.id) \(label)")
                #expect(p.wash >= 0 && p.wash <= 1, "\(theme.id) \(label)")
            }
            #expect(theme.glass.rowRadius > 0)
        }
    }

    @Test("A light variant is lighter than its dark, and washes the album's light; a dark one does not")
    func variantsDiffer() {
        for theme in Theme.made {
            #expect(luminance(theme.light.floor) > luminance(theme.dark.floor) + 0.4, "\(theme.id)")
            #expect(theme.light.wash > 0 && theme.dark.wash == 0, "\(theme.id)")
            #expect(luminance(theme.light.tint) < 0.6, "\(theme.id): the tint reads on a light ground")
        }
    }

    @Test("Liquid Glass is glassier than ECHO: tinted rimmed cards, rows on glass, refracting buttons")
    func glassier() {
        #expect(!Theme.echo.glass.rows && !Theme.echo.glass.refractive && Theme.echo.glass.rim == 0)
        #expect(Theme.glass.glass.rows && Theme.glass.glass.refractive)
        #expect(Theme.glass.glass.rim > 0 && Theme.glass.glass.tint > 0 && Theme.glass.glass.caustic > 0)
        #expect(Theme.glass.dark.roomStrength > Theme.echo.dark.roomStrength)
        #expect(Theme.glass.dark.tint != Theme.echo.dark.tint)
    }

    @Test("Each theme's lyric look makes a complete style, and Liquid Glass's differs from ECHO's")
    func lyricLooks() {
        for theme in Theme.made {
            let style = theme.lyric.look.make(.harbour, 30)
            #expect(style.face.size == 30, "\(theme.id)")
            #expect(style.ink != style.room, "\(theme.id)")
            #expect(style.glowScale > 0 && style.depthBlur >= 0, "\(theme.id)")
        }
        let echo = Theme.echo.lyric.look.make(.harbour, 30)
        let glass = Theme.glass.lyric.look.make(.harbour, 30)
        #expect(echo != glass)
        #expect(glass.glowScale > echo.glowScale)
    }

    @Test("Each theme's sounds are all in the app: a file for each of the four cues")
    func soundFiles() {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Shared/Themes/Sounds")
        for theme in Theme.made {
            if theme.sounds == .none {
                #expect(theme.sounds.files.isEmpty)
                continue
            }
            for cue in SoundCue.allCases {
                #expect(theme.sounds.file(for: cue) != nil, "\(theme.id) \(cue)")
            }
            for file in theme.sounds.files {
                let url = dir.appendingPathComponent("\(file).wav")
                #expect(FileManager.default.fileExists(atPath: url.path), "\(file)")
                let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
                #expect(size > 1000 && size < 200_000, "\(file) is a short sound")
            }
        }
    }
}

@MainActor
@Suite("Themes: the choice is the user's")
struct ThemeSaveTests {
    func makeSession(_ stub: Stub, token: String? = "echo_dt_test") -> Session {
        Session(
            server: stub.base, tokens: MemoryTokenStore(token), http: stub.session, deviceName: { "Test" }, cache: nil,
            watchNetwork: false)
    }

    @Test("Picking a theme saves the one key, and the room shows it at once")
    func picks() async throws {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings-saved"))
        let session = makeSession(stub)
        let editor = SettingsEditor(session: session)
        await editor.save { $0.appearance.theme = .glass }.value
        let sent = try #require(stub.requests("PUT", "/me/settings").first?.json)
        #expect(Set(sent.keys) == ["appearance"])
        let appearance = try #require(sent["appearance"] as? [String: Any])
        #expect(appearance["theme"] as? String == "glass")
        #expect(Set(appearance.keys) == ["theme"])
        #expect(Theme.resolve(session.settings.appearance, systemDark: true).theme.id == .glass)
    }

    @Test("Two picks in quick succession go up in order")
    func ordered() async throws {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings"))
        let editor = SettingsEditor(session: makeSession(stub))
        let a = editor.save { $0.appearance.theme = .glass }
        let b = editor.save { $0.appearance.theme = .echo }
        await a.value
        await b.value
        let themes = stub.requests("PUT", "/me/settings").compactMap {
            ($0.json?["appearance"] as? [String: Any])?["theme"] as? String
        }
        #expect(themes == ["glass", "echo"])
    }

    @Test("A pick the server refuses is put back, with the reason")
    func refused() async {
        let stub = Stub()
        stub.on("PUT", "/me/settings", .fixture("settings-refused", status: 400))
        let session = makeSession(stub)
        let editor = SettingsEditor(session: session)
        await editor.save { $0.appearance.theme = .glass }.value
        #expect(session.settings.appearance.theme == .echo)
        #expect(editor.failure != nil)
    }

    @Test("The theme comes with the account at sign-in")
    func loadedAtSignIn() async {
        let stub = Stub()
        stub.on("GET", "/me", .fixture("me"))
        stub.on("GET", "/me/settings", .fixture("settings-saved"))
        let session = makeSession(stub, token: "echo_dt_kept")
        #expect(Theme.resolve(session.settings.appearance, systemDark: false).theme.id == .echo)
        await session.refresh()
        let resolved = Theme.resolve(session.settings.appearance, systemDark: false)
        #expect(resolved.theme.id == .glass)
        #expect(resolved.dark)
    }

    @Test("A theme id the server adds later reads as ECHO instead of failing the answer")
    func unknownId() throws {
        let json = #"{"appearance":{"theme":"vaporwave","dark":"dark"}}"#
        let settings = try JSONDecoder().decode(UserSettings.self, from: Data(json.utf8))
        #expect(settings.appearance.theme == .echo)
        #expect(settings.appearance.dark == .dark)
    }
}

@MainActor
final class FakeHaptics: HapticOutput {
    var fired: [HapticKind] = []
    func fire(_ kind: HapticKind) { fired.append(kind) }
}

@MainActor
final class FakeSounds: SoundOutput {
    var played: [String] = []
    func play(_ file: String) { played.append(file) }
}

@MainActor
@Suite("Themes: what a press feels and sounds like")
struct FeedbackTests {
    func make(_ sounds: Theme.Sounds, device: DeviceSettings? = nil) -> (Feedback, FakeHaptics, FakeSounds) {
        let haptics = FakeHaptics()
        let output = FakeSounds()
        let feedback = Feedback(haptics: haptics, output: output)
        feedback.sounds = sounds
        feedback.device = device
        return (feedback, haptics, output)
    }

    @Test("The five events make Android's haptics")
    func hapticMapping() {
        #expect(FeedbackEvent.tap.haptic == .light)
        #expect(FeedbackEvent.toggle(true).haptic == .rigid)
        #expect(FeedbackEvent.toggle(false).haptic == .soft)
        #expect(FeedbackEvent.confirm.haptic == .success)
        #expect(FeedbackEvent.reject.haptic == .error)
        #expect(FeedbackEvent.tick.haptic == .selection)
    }

    @Test("Liquid Glass plays its tink, its chimes and its rising chimes; a refusal is the tink again")
    func glassSounds() {
        let (feedback, haptics, output) = make(.glass)
        feedback.tap()
        feedback.toggle(true)
        feedback.confirm()
        feedback.reject()
        feedback.tick()
        #expect(haptics.fired == [.light, .rigid, .success, .error, .selection])
        #expect(output.played == ["glass_press", "glass_click", "glass_yes", "glass_press", "glass_click"])
    }

    @Test("A theme with no sounds only has haptics")
    func quietTheme() {
        let (feedback, haptics, output) = make(Theme.echo.sounds)
        feedback.tap()
        feedback.confirm()
        #expect(haptics.fired == [.light, .success])
        #expect(output.played.isEmpty)
    }

    @Test("Each device switch turns off its own: haptics, and theme sounds")
    func switches() {
        let device = DeviceSettings(defaults: nil)
        let (feedback, haptics, output) = make(.glass, device: device)
        device.setHaptics(false)
        feedback.tap()
        #expect(haptics.fired.isEmpty)
        #expect(output.played == ["glass_press"])
        device.setHaptics(true)
        device.setThemeSounds(false)
        feedback.tap()
        #expect(haptics.fired == [.light])
        #expect(output.played == ["glass_press"])
    }

    @Test("The Mac has no haptics: only the sounds")
    func noHaptics() {
        let output = FakeSounds()
        let feedback = Feedback(haptics: nil, output: output)
        feedback.sounds = .glass
        feedback.confirm()
        #expect(output.played == ["glass_yes"])
    }

    @Test("Haptics and theme sounds are kept on this device, on unless switched off")
    func kept() {
        let store = UserDefaults(suiteName: "echo.test.\(UUID().uuidString)")!
        let a = DeviceSettings(defaults: store)
        #expect(a.haptics && a.themeSounds)
        a.setHaptics(false)
        a.setThemeSounds(false)
        let b = DeviceSettings(defaults: store)
        #expect(!b.haptics && !b.themeSounds)
    }
}
