import AVFoundation
import Foundation
import MediaPlayer
import Testing

// Karaoke mode (docs/KARAOKE.md) against a fake engine and ECHO's recorded answers: the version
// lookup and its states, the polling (what is asked, how often), the sums (vocal level to node
// volumes, the key to cents, which channels of the 5.1 file are which), the lyrics' clock with the
// output latency, switching between a song and its version at the same position, the engines'
// routing, and the settings. The audio engine itself (AVAudioEngine, the time-pitch unit) runs on
// a device only: nothing here plays a sound.

@Suite("Karaoke: the server's answers")
struct KaraokeApiTests {
    let stub = Stub()
    let sleeps = Sleeps()

    func client() -> EchoClient {
        EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session, sleep: sleeps.sleep, jitter: { 0.5 })
    }

    @Test("A song's version in each state, as the server recorded it", arguments: [
        ("karaoke-working", KaraokeAnswer(status: .working, ahead: 0, url: nil)),
        ("karaoke-queued", KaraokeAnswer(status: .queued, ahead: 1, url: nil)),
        ("karaoke-song-ready", KaraokeAnswer(status: .ready, ahead: 0, url: "/api/v1/karaoke/al-1-t3/audio")),
        ("karaoke-failed", KaraokeAnswer(status: .failed, ahead: 0, url: nil)),
        ("karaoke-skipped", KaraokeAnswer(status: .skipped, ahead: 0, url: nil)),
        ("karaoke-off", KaraokeAnswer(status: .off, ahead: 0, url: nil)),
    ])
    func answers(fixture: String, expected: KaraokeAnswer) async throws {
        stub.on("GET", "/karaoke/al-1-t1", .fixture(fixture))
        #expect(try await client().karaoke(id: "al-1-t1", soon: false) == expected)
    }

    @Test("A guest asks too: the server lets a guest read")
    func guest() async throws {
        stub.on("GET", "/karaoke/al-1-t3", .fixture("karaoke-guest"))
        let answer = try await client().karaoke(id: "al-1-t3", soon: false)
        #expect(answer.status == .ready)
    }

    @Test("Asking for the song playing is plain; for one coming up it says soon")
    func soon() async throws {
        stub.on("GET", "/karaoke/al-1-t2", .fixture("karaoke-queued"))
        _ = try await client().karaoke(id: "al-1-t2", soon: false)
        _ = try await client().karaoke(id: "al-1-t2", soon: true)
        let sent = stub.requests("GET", "/karaoke/al-1-t2")
        #expect(sent.map(\.query) == [[:], ["soon": "1"]])
        #expect(sent.allSatisfy { $0.bearer == "echo_dt_test" })
    }

    @Test("A song id is encoded in the path; one the server refuses is its error")
    func badId() async throws {
        stub.on("GET", "/karaoke/not an id", .fixture("karaoke-bad-track", status: 400))
        await #expect(throws: ApiError.server(status: 400, code: "bad_track_id")) {
            try await client().karaoke(id: "not an id", soon: false)
        }
        #expect(stub.requests.first?.path == "/karaoke/not an id")
    }

    @Test("Over the API budget it asks again after Retry-After, as every read does")
    func budget() async throws {
        let limited = Reply.fixture("rate-limited", status: 429, headers: ["Retry-After": "1"])
        stub.on("GET", "/karaoke/al-1-t1", limited, .fixture("karaoke-working"))
        let answer = try await client().karaoke(id: "al-1-t1", soon: false)
        #expect(answer.status == .working)
        #expect(stub.requests("GET", "/karaoke/al-1-t1").count == 2)
        #expect(sleeps.all == [.milliseconds(1150)])
    }

    @Test("The server's progress: what is ready, queued, failed and skipped, and the disk it takes")
    func progress() async throws {
        stub.on("GET", "/karaoke", .fixture("karaoke-progress"))
        let p = try await client().karaokeProgress()
        #expect(p == KaraokeProgress(enabled: true, online: true, ready: 2, queued: 3, failed: 0, skipped: 1, bytes: 13_400_000))
        #expect(p.total == 6)
    }

    @Test("No stem service, or one that does not answer")
    func progressOff() async throws {
        stub.on("GET", "/karaoke", .fixture("karaoke-progress-off"), .fixture("karaoke-progress-offline"))
        let off = try await client().karaokeProgress()
        #expect(!off.enabled)
        let offline = try await client().karaokeProgress()
        #expect(offline.enabled && !offline.online)
        #expect(offline.bytes == 0) // the server sends null
        #expect(offline.failed == 1)
    }

    @Test("A state from a newer server is one that is not ready yet")
    func unknownState() throws {
        let answer = try JSONDecoder().decode(KaraokeAnswer.self, from: Data(#"{"status":"baking","ahead":2}"#.utf8))
        #expect(answer.status == .queued)
        #expect(answer.ahead == 2)
    }
}

@Suite("Karaoke: the sums")
struct KaraokeMathTests {
    @Test("The vocals' volume is the level, the instrumental's stays whole", arguments: [
        (0.0, Float(0)), (0.35, Float(0.35)), (1.0, Float(1)), (-0.5, Float(0)), (7.0, Float(1)),
    ])
    func volumes(level: Double, vocals: Float) {
        let v = KaraokeMath.volumes(level: level)
        #expect(v.instrumental == 1)
        #expect(abs(v.vocals - vocals) < 0.0001)
    }

    @Test("A level that is not a number is none")
    func notANumber() {
        #expect(KaraokeMath.clampLevel(.nan) == 0)
        #expect(KaraokeMath.volumes(level: .infinity).vocals == 0)
    }

    @Test("A key is a hundred cents a semitone, within six either way", arguments: [
        (0, Float(0)), (1, Float(100)), (-1, Float(-100)), (6, Float(600)), (-6, Float(-600)), (9, Float(600)), (-40, Float(-600)),
    ])
    func cents(key: Int, cents: Float) {
        #expect(KaraokeMath.cents(key: key) == cents)
    }

    @Test("An octave is twelve semitones: the ratio doubles")
    func ratio() {
        #expect(abs(KaraokeMath.ratio(key: 0) - 1) < 1e-9)
        // Six semitones is a tritone: the square root of two.
        #expect(abs(KaraokeMath.ratio(key: 6) - 2.0.squareRoot()) < 1e-9)
        #expect(abs(KaraokeMath.ratio(key: -6) - 1 / 2.0.squareRoot()) < 1e-9)
    }

    @Test("The key applies only while Karaoke plays; the value is kept")
    func effective() {
        #expect(KaraokeMath.effectiveKey(karaoke: false, key: 4) == 0)
        #expect(KaraokeMath.effectiveKey(karaoke: true, key: 4) == 4)
        #expect(KaraokeMath.effectiveKey(karaoke: true, key: 11) == 6)
    }

    @Test("The words for a key and a level")
    func words() {
        #expect(KaraokeMath.keyText(0) == "Original key")
        #expect(KaraokeMath.keyText(1) == "Up 1 semitone")
        #expect(KaraokeMath.keyText(-3) == "Down 3 semitones")
        #expect(KaraokeMath.keyValue(2) == "+2")
        #expect(KaraokeMath.keyValue(-2) == "\u{2212}2")
        #expect(KaraokeMath.keyValue(0) == "0")
        #expect(KaraokeMath.percent(0.355) == "36%")
        #expect(KaraokeMath.percent(1) == "100%")
    }

    @Test("Which channels are which, by the file's layout", arguments: [
        (kAudioChannelLayoutTag_MPEG_5_1_A as AudioChannelLayoutTag?, KaraokeChannels(instrumental: [0, 1], vocals: [4, 5])),
        (kAudioChannelLayoutTag_MPEG_5_1_D, KaraokeChannels(instrumental: [1, 2], vocals: [3, 4])),
        (kAudioChannelLayoutTag_MPEG_5_1_C, KaraokeChannels(instrumental: [0, 2], vocals: [3, 4])),
        (kAudioChannelLayoutTag_MPEG_5_1_B, KaraokeChannels(instrumental: [0, 1], vocals: [2, 3])),
        (nil, KaraokeChannels(instrumental: [0, 1], vocals: [4, 5])),
    ])
    func layouts(tag: AudioChannelLayoutTag?, expected: KaraokeChannels) {
        #expect(KaraokeChannels.forLayout(tag: tag) == expected)
        #expect(KaraokeChannels.forFile(channels: 6, layout: tag) == expected)
    }

    @Test("A stereo or mono file plays whole, with no vocals of its own")
    func notFiveOne() {
        #expect(KaraokeChannels.forFile(channels: 2, layout: nil) == KaraokeChannels(instrumental: [0, 1], vocals: []))
        #expect(KaraokeChannels.forFile(channels: 1, layout: nil) == KaraokeChannels(instrumental: [0, 0], vocals: []))
    }

    /// Six channels, each a constant: channel n holds (n + 1) / 10.
    private func sixChannels(frames: Int) throws -> AVAudioPCMBuffer {
        let format = try #require(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44100, interleaved: false, channelLayout: AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_MPEG_5_1_A)!))
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)))
        buffer.frameLength = AVAudioFrameCount(frames)
        for channel in 0..<6 {
            for i in 0..<frames { buffer.floatChannelData![channel][i] = Float(channel + 1) / 10 }
        }
        return buffer
    }

    private func stereo(frames: Int) throws -> AVAudioPCMBuffer {
        let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2))
        return try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)))
    }

    @Test("The front pair and the rear pair are split into two stereo buffers")
    func split() throws {
        let source = try sixChannels(frames: 64)
        let front = try stereo(frames: 64)
        let rear = try stereo(frames: 64)
        #expect(KaraokeChannels.frontRear.split(source, into: front, vocals: rear))
        #expect(front.frameLength == 64 && rear.frameLength == 64)
        #expect(front.floatChannelData![0][10] == 0.1 && front.floatChannelData![1][63] == 0.2)
        #expect(rear.floatChannelData![0][0] == 0.5 && rear.floatChannelData![1][40] == 0.6)
        // AAC's order (C L R Ls Rs LFE): the instrumental is the second and third.
        #expect(KaraokeChannels.forLayout(tag: kAudioChannelLayoutTag_MPEG_5_1_D).split(source, into: front, vocals: rear))
        #expect(front.floatChannelData![0][0] == 0.2 && front.floatChannelData![1][0] == 0.3)
        #expect(rear.floatChannelData![0][0] == 0.4 && rear.floatChannelData![1][0] == 0.5)
    }

    @Test("A file with no vocals of its own leaves the vocals' buffer silent")
    func silentVocals() throws {
        let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2))
        let source = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8))
        source.frameLength = 8
        for i in 0..<8 {
            source.floatChannelData![0][i] = 0.5
            source.floatChannelData![1][i] = -0.5
        }
        let front = try stereo(frames: 8)
        let rear = try stereo(frames: 8)
        rear.floatChannelData![0][0] = 9
        let channels = KaraokeChannels.forFile(channels: 2, layout: nil)
        #expect(channels.split(source, into: front, vocals: rear))
        #expect(front.floatChannelData![1][7] == -0.5)
        #expect(rear.floatChannelData![0][0] == 0 && rear.floatChannelData![1][7] == 0)
    }

    @Test("A buffer without the channels is refused, not read past its end")
    func tooFewChannels() throws {
        let source = try stereo(frames: 8)
        source.frameLength = 8
        #expect(!KaraokeChannels.frontRear.split(source, into: try stereo(frames: 8), vocals: try stereo(frames: 8)))
    }

    @Test("Karaoke's words: nothing to say when it is ready")
    func notes() {
        #expect(KaraokeNote.text(status: .ready, ahead: 0, server: true) == nil)
        #expect(KaraokeNote.text(status: .off, ahead: 0, server: nil) == nil)
        #expect(KaraokeNote.text(status: .preparing, ahead: 0, server: true)
            == "Preparing the karaoke version… it starts by itself when it's ready.")
        #expect(KaraokeNote.text(status: .preparing, ahead: 1, server: true)
            == "Preparing the karaoke version… 1 song before this one.")
        #expect(KaraokeNote.text(status: .preparing, ahead: 4, server: true)
            == "Preparing the karaoke version… 4 songs before this one.")
        #expect(KaraokeNote.text(status: .failed, ahead: 0, server: true) == "The voice couldn't be taken out of this song.")
        #expect(KaraokeNote.text(status: .tooLong, ahead: 0, server: true) == "This song is too long for Karaoke.")
        #expect(KaraokeNote.text(status: .unavailable, ahead: 0, server: false)
            == "Karaoke needs the stem service on your ECHO server (docs/KARAOKE.md).")
        #expect(KaraokeNote.text(status: .unavailable, ahead: 0, server: true) == "Karaoke works with songs from your library.")
    }
}

@MainActor
@Suite("Karaoke: this device's settings")
struct KaraokeSettingsTests {
    @Test("Off, the vocals gone and the key as it was, until chosen")
    func defaults() {
        let device = DeviceSettings(defaults: nil)
        #expect(!device.karaoke)
        #expect(device.vocalLevel == 0)
        #expect(device.karaokeKey == 0)
    }

    @Test("Kept on this device and read back, within the ranges")
    func kept() throws {
        let suite = "echo-test-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let device = DeviceSettings(defaults: defaults)
        device.setKaraoke(true)
        device.setVocalLevel(0.4)
        device.setKaraokeKey(-3)
        let again = DeviceSettings(defaults: defaults)
        #expect(again.karaoke && again.vocalLevel == 0.4 && again.karaokeKey == -3)
        device.setVocalLevel(3)
        device.setKaraokeKey(-30)
        #expect(device.vocalLevel == 1 && device.karaokeKey == -6)
        defaults.set(9, forKey: DeviceSettings.karaokeShiftKey)
        #expect(DeviceSettings(defaults: defaults).karaokeKey == 6)
    }

    @Test("The sliders reach the audio engine at once, and the engine starts with them")
    func controls() {
        let device = DeviceSettings(defaults: nil)
        device.setVocalLevel(0.25)
        device.setKaraokeKey(2)
        let controls = FakeControls()
        let karaoke = Karaoke(device: device, controls: controls)
        #expect(controls.vocalLevel == 0.25 && controls.keyShift == 2)
        karaoke.setLevel(0.9)
        karaoke.setKey(-4)
        #expect(controls.vocalLevel == 0.9 && controls.keyShift == -4)
        #expect(device.vocalLevel == 0.9 && device.karaokeKey == -4)
        karaoke.setKey(40)
        #expect(controls.keyShift == 6)
    }
}

@MainActor
@Suite("Karaoke: asking the server")
struct KaraokeControllerTests {
    let clock = TestClock()
    let device = DeviceSettings(defaults: nil)
    let source = FakeKaraokeSource()

    func make() -> (Rig, Karaoke) {
        let karaoke = Karaoke(device: device, source: source, now: { [clock] in clock.now })
        return (Rig(karaoke: karaoke), karaoke)
    }

    @Test("Off: nothing is asked")
    func off() async {
        let (rig, karaoke) = make()
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await karaoke.tick()
        #expect(source.asks.isEmpty)
        #expect(karaoke.status == .off)
    }

    @Test("On: the song playing is asked at once, the next two as coming up")
    func asks() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        await rig.player.play(songs(1...5), at: 0, context: albumContext)
        await karaoke.tick()
        #expect(source.asks == [
            .init(id: "al-1-t1", soon: false), .init(id: "al-1-t2", soon: true), .init(id: "al-1-t3", soon: true),
        ])
        #expect(karaoke.status == .preparing)
    }

    @Test("The song playing every 5 s until it is ready, the next ones once a minute")
    func cadence() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await karaoke.tick()
        clock.advance(3)
        await karaoke.tick()
        #expect(source.asks.count == 3) // too soon for any
        clock.advance(3) // 6 s
        await karaoke.tick()
        #expect(source.asks.suffix(1) == [.init(id: "al-1-t1", soon: false)])
        clock.advance(55) // 61 s
        await karaoke.tick()
        #expect(source.asks.suffix(3).map(\.soon) == [false, true, true])
    }

    @Test("How far it is: ahead of it in the queue, then ready")
    func progress() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        source.script(
            "al-1-t1", .init(status: .queued, ahead: 2, url: nil), .init(status: .working, ahead: 0, url: nil),
            .init(status: .ready, ahead: 0, url: "/api/v1/karaoke/al-1-t1/audio"))
        await rig.player.play(songs(1...1), at: 0, context: albumContext)
        await karaoke.tick()
        #expect(karaoke.status == .preparing && karaoke.ahead == 2)
        clock.advance(6)
        await karaoke.tick()
        #expect(karaoke.status == .preparing && karaoke.ahead == 0)
        clock.advance(6)
        await karaoke.tick()
        #expect(karaoke.status == .ready)
        #expect(karaoke.audio(for: song(1)) == "/api/v1/karaoke/al-1-t1/audio")
    }

    @Test("Failed and too long are final: the server is not asked again")
    func settled() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        source.script("al-1-t1", .init(status: .skipped, ahead: 0, url: nil))
        await rig.player.play(songs(1...1), at: 0, context: albumContext)
        await karaoke.tick()
        #expect(karaoke.status == .tooLong)
        clock.advance(600)
        await karaoke.tick()
        #expect(source.asks.count == 1)
        #expect(karaoke.status == .tooLong)
        #expect(karaoke.audio(for: song(1)) == nil)
    }

    @Test("No stem service: the songs are never asked about")
    func noServer() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        source.progress = KaraokeProgress(enabled: false, online: false, ready: 0, queued: 0, failed: 0, skipped: 0, bytes: 0)
        await rig.player.play(songs(1...2), at: 0, context: albumContext)
        await karaoke.tick()
        #expect(karaoke.status == .unavailable && karaoke.server == false)
        #expect(source.asks.isEmpty)
    }

    @Test("A song from another service is not asked about")
    func notFromTheLibrary() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        let other = Track(
            id: "yt1", title: "Elsewhere", artists: song(1).artists, album: song(1).album, durationMs: 1000, provider: "youtube")
        await rig.player.play([other], at: 0, context: albumContext)
        await karaoke.tick()
        #expect(karaoke.status == .unavailable)
        #expect(source.asks.isEmpty)
    }

    @Test("A server that cannot be reached is tried again next time")
    func unreachable() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        source.failing = true
        await rig.player.play(songs(1...1), at: 0, context: albumContext)
        await karaoke.tick()
        #expect(karaoke.server == nil)
        source.failing = false
        await karaoke.tick()
        #expect(karaoke.server == true)
        #expect(karaoke.status == .preparing)
    }

    @Test("Turned off, it says nothing; signing out forgets what was known")
    func clears() async {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        source.script("al-1-t1", .init(status: .ready, ahead: 0, url: "/api/v1/karaoke/al-1-t1/audio"))
        await rig.player.play(songs(1...1), at: 0, context: albumContext)
        await karaoke.tick()
        #expect(karaoke.audio(for: song(1)) != nil)
        karaoke.setOn(false)
        #expect(karaoke.status == .off && karaoke.audio(for: song(1)) == nil)
        device.setKaraoke(true)
        karaoke.clear()
        #expect(karaoke.audio(for: song(1)) == nil && karaoke.server == nil)
    }

    @Test("A file that would not play is left alone for five minutes")
    func broken() {
        let (_, karaoke) = make()
        device.setKaraoke(true)
        karaoke.markReady([song(1)])
        #expect(karaoke.audio(for: song(1)) != nil)
        karaoke.unusable(song(1))
        #expect(karaoke.audio(for: song(1)) == nil)
        clock.advance(299)
        #expect(karaoke.audio(for: song(1)) == nil)
        clock.advance(2)
        #expect(karaoke.audio(for: song(1)) != nil)
    }

    @Test("Songs the Home shelf lists play as karaoke at once")
    func shelf() {
        let (_, karaoke) = make()
        karaoke.markReady(songs(1...2))
        #expect(karaoke.audio(for: song(1)) == nil) // Karaoke is off
        device.setKaraoke(true)
        #expect(karaoke.audio(for: song(2)) == "/api/v1/karaoke/al-1-t2/audio")
        #expect(karaoke.audio(for: song(3)) == nil)
    }

    @Test("The progress for Settings: the server's counts, or why there are none")
    func settingsProgress() async {
        let (_, karaoke) = make()
        source.progress = KaraokeProgress(enabled: true, online: true, ready: 5, queued: 1, failed: 0, skipped: 0, bytes: 1)
        await karaoke.refreshProgress()
        #expect(karaoke.progress?.ready == 5 && karaoke.progressNote == nil)
        source.progress = KaraokeProgress(enabled: true, online: false, ready: 5, queued: 1, failed: 0, skipped: 0, bytes: 0)
        await karaoke.refreshProgress()
        #expect(karaoke.progressNote == Karaoke.offline)
        source.progress = KaraokeProgress(enabled: false, online: false, ready: 0, queued: 0, failed: 0, skipped: 0, bytes: 0)
        await karaoke.refreshProgress()
        #expect(karaoke.progressNote == Karaoke.notSetUp)
    }
}

@MainActor
@Suite("Karaoke: playing")
struct KaraokePlaybackTests {
    let device = DeviceSettings(defaults: nil)
    let clock = TestClock()
    let source = FakeKaraokeSource()

    func make(ready: [Track] = []) -> (Rig, Karaoke) {
        let karaoke = Karaoke(device: device, source: source, now: { [clock] in clock.now })
        let rig = Rig(karaoke: karaoke)
        karaoke.markReady(ready)
        return (rig, karaoke)
    }

    @Test("A song with its version ready loads as karaoke: the server's audio, no stream URL")
    func loadsKaraoke() async throws {
        let (rig, _) = make(ready: songs(1...2))
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        let item = try #require(rig.engine.loads.first)
        #expect(item.key == "navidrome:al-1-t1" && item.karaoke)
        #expect(item.url.absoluteString == "/api/v1/karaoke/al-1-t1/audio")
        #expect(!rig.source.streams.contains("al-1-t1"))
    }

    @Test("Karaoke off: the original, whatever is ready")
    func original() async throws {
        let (rig, _) = make(ready: songs(1...2))
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        let item = try #require(rig.engine.loads.first)
        #expect(!item.karaoke)
        #expect(item.url.absoluteString.contains("/navidrome/stream/"))
    }

    @Test("A song without a version plays as it is, even with Karaoke on")
    func noVersion() async throws {
        let (rig, _) = make(ready: [song(2)])
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        #expect(rig.engine.loads.first?.karaoke == false)
    }

    @Test("The next song is buffered as its version when that is ready")
    func preloadsKaraoke() async throws {
        let (rig, _) = make(ready: songs(1...2))
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        let next = try #require(rig.engine.preloaded)
        #expect(next.key == "navidrome:al-1-t2" && next.karaoke)
    }

    @Test("Turned on in the middle of a song, its version goes on from the same second; off, the original does")
    func switchesAtTheSamePlace() async throws {
        let (rig, karaoke) = make(ready: songs(1...1))
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        rig.engine.play(to: 42)
        rig.engine.forget()
        karaoke.setOn(true)
        await rig.settle()
        #expect(rig.engine.calls.contains(.load("navidrome:al-1-t1", at: 42, play: true)))
        #expect(rig.engine.loads.last?.karaoke == true)
        #expect(rig.player.track?.key == "navidrome:al-1-t1")
        rig.engine.play(to: 61)
        rig.engine.forget()
        karaoke.setOn(false)
        await rig.settle()
        #expect(rig.engine.calls.contains(.load("navidrome:al-1-t1", at: 61, play: true)))
        #expect(rig.engine.loads.last?.karaoke == false)
    }

    @Test("Paused, nothing loads until Play, and then from the other source at the same place")
    func pausedSwitch() async throws {
        let (rig, karaoke) = make(ready: songs(1...1))
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        rig.engine.play(to: 30)
        rig.player.pause()
        rig.engine.forget()
        karaoke.setOn(true)
        await rig.settle()
        #expect(rig.engine.loads.isEmpty)
        rig.player.resume()
        await rig.settle()
        let load = try #require(rig.engine.loads.last)
        #expect(load.karaoke)
        #expect(rig.engine.calls.contains(.load("navidrome:al-1-t1", at: 30, play: true)))
    }

    @Test("A version that comes ready while the song plays takes over from the same second")
    func becomesReady() async throws {
        let (rig, karaoke) = make()
        device.setKaraoke(true)
        source.script(
            "al-1-t1", .init(status: .working, ahead: 0, url: nil),
            .init(status: .ready, ahead: 0, url: "/api/v1/karaoke/al-1-t1/audio"))
        await rig.player.play(songs(1...1), at: 0, context: albumContext)
        await rig.settle()
        await karaoke.tick()
        #expect(rig.engine.loads.allSatisfy { !$0.karaoke })
        rig.engine.play(to: 75)
        clock.advance(6)
        await karaoke.tick()
        await rig.settle()
        #expect(rig.engine.loads.last?.karaoke == true)
        #expect(rig.engine.calls.contains(.load("navidrome:al-1-t1", at: 75, play: true)))
    }

    @Test("A version that will not play: the original, from the same place, and no skip")
    func fallsBack() async throws {
        let (rig, _) = make(ready: songs(1...1))
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        rig.engine.play(to: 12)
        rig.engine.forget()
        rig.engine.send(.failed("navidrome:al-1-t1"))
        await rig.settle()
        #expect(rig.player.track?.key == "navidrome:al-1-t1")
        #expect(rig.engine.calls.contains(.load("navidrome:al-1-t1", at: 12, play: true)))
        #expect(rig.engine.loads.last?.karaoke == false)
        #expect(rig.notices.isEmpty)
    }

    @Test("Scrobbles and the lock screen go on as for any song")
    func scrobblesAndLockScreen() async throws {
        let (rig, _) = make(ready: songs(1...1))
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        rig.engine.play(to: 5)
        await rig.settle()
        #expect(rig.source.scrobbles.contains("al-1-t1 now"))
        let info = try #require(rig.media.info)
        #expect(info[MPMediaItemPropertyTitle] as? String == "Song 1")
        #expect(rig.media.playing)
    }

    @Test("The lyrics follow what is heard: the engine's time less the output's latency, a version's too")
    func lyricsClock() async throws {
        let (rig, _) = make(ready: songs(1...1))
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        await rig.settle()
        rig.engine.latency = 0.18
        rig.engine.play(to: 10)
        await rig.settle()
        #expect(rig.engine.loads.first?.karaoke == true)
        #expect(abs(rig.player.audibleTime - 9.82) < 0.0001)
        rig.engine.latency = 0.5 // AirPlay
        #expect(abs(rig.player.audibleTime - 9.5) < 0.0001)
    }

    @Test("Signing out empties what Karaoke knew")
    func signOut() async throws {
        let (rig, karaoke) = make(ready: songs(1...1))
        device.setKaraoke(true)
        await rig.player.play(songs(1...3), at: 0, context: albumContext)
        rig.player.stop()
        #expect(karaoke.audio(for: song(1)) == nil)
    }
}

@MainActor
@Suite("Karaoke: the two engines")
struct RoutedEngineTests {
    func item(_ n: Int, karaoke: Bool) -> EngineItem {
        EngineItem(
            key: "navidrome:al-1-t\(n)", url: URL(string: "https://echo.test/\(n)")!, gain: 1, expiresAt: .distantFuture, karaoke: karaoke)
    }

    func rig() -> (RoutedEngine, FakeEngine, FakeEngine) {
        let plain = FakeEngine()
        let karaoke = FakeEngine()
        return (RoutedEngine(plain: plain, karaoke: karaoke), plain, karaoke)
    }

    @Test("Each song goes to the engine its item names, and loading one stops the other")
    func routes() {
        let (routed, plain, karaoke) = rig()
        routed.load(item(1, karaoke: false), at: 0, play: true)
        #expect(plain.loadedKeys == ["navidrome:al-1-t1"] && karaoke.loadedKeys.isEmpty)
        routed.load(item(1, karaoke: true), at: 42, play: true)
        #expect(karaoke.calls == [.load("navidrome:al-1-t1", at: 42, play: true)])
        #expect(plain.calls.last == .stop)
        #expect(routed.active == .karaoke)
        routed.load(item(2, karaoke: false), at: 0, play: true)
        #expect(karaoke.calls.last == .stop && routed.active == .plain)
    }

    @Test("The transport, the time and the volume go to the engine that has the song")
    func transport() {
        let (routed, plain, karaoke) = rig()
        routed.load(item(1, karaoke: true), at: 0, play: true)
        karaoke.latency = 0.2
        karaoke.play(to: 9)
        #expect(routed.currentTime == 9 && routed.outputLatency == 0.2)
        routed.pause()
        routed.play()
        routed.seek(to: 30)
        #expect(karaoke.calls.suffix(3) == [.pause, .play, .seek(30)])
        #expect(!plain.calls.contains(.pause))
        routed.volume = 0.5
        #expect(plain.volume == 0.5 && karaoke.volume == 0.5)
        routed.stop()
        #expect(plain.calls.last == .stop && karaoke.calls.last == .stop)
    }

    @Test("Only the engine that has the song is heard")
    func events() {
        let (routed, plain, karaoke) = rig()
        var heard: [EngineEvent] = []
        routed.onEvent = { heard.append($0) }
        routed.load(item(1, karaoke: true), at: 0, play: true)
        heard.removeAll()
        plain.send(.time(5))
        #expect(heard.isEmpty)
        karaoke.send(.time(6))
        #expect(heard == [.time(6)])
    }

    @Test("A song is buffered next only by the engine that will play it; across the two the player loads it")
    func preload() {
        let (routed, plain, karaoke) = rig()
        routed.load(item(1, karaoke: true), at: 0, play: true)
        routed.preload(item(2, karaoke: true))
        #expect(karaoke.preloaded?.key == "navidrome:al-1-t2")
        routed.preload(item(3, karaoke: false))
        #expect(karaoke.preloaded == nil && plain.preloaded == nil)
        routed.preload(nil)
        #expect(karaoke.calls.last == .preload(nil))
    }
}

@MainActor
@Suite("Karaoke: making a version")
struct KaraokeMakingTests {
    let device = DeviceSettings(defaults: nil)
    let source = FakeKaraokeSource()

    func make() -> Karaoke { Karaoke(device: device, source: source) }

    @Test("Each state has its words", arguments: [
        (KaraokeAnswer(status: .working, ahead: 0, url: nil), "Making the karaoke version of \u{201C}Song 1\u{201D} now: a few minutes."),
        (KaraokeAnswer(status: .queued, ahead: 1, url: nil), "\u{201C}Song 1\u{201D} is next in line for karaoke: 1 song before it."),
        (KaraokeAnswer(status: .queued, ahead: 3, url: nil), "\u{201C}Song 1\u{201D} is next in line for karaoke: 3 songs before it."),
        (KaraokeAnswer(status: .ready, ahead: 0, url: "/api/v1/karaoke/al-1-t1/audio"), "The karaoke version of \u{201C}Song 1\u{201D} is ready."),
        (KaraokeAnswer(status: .failed, ahead: 0, url: nil), "The voice couldn't be taken out of \u{201C}Song 1\u{201D}."),
        (KaraokeAnswer(status: .skipped, ahead: 0, url: nil), "\u{201C}Song 1\u{201D} is too long for Karaoke."),
        (KaraokeAnswer(status: .off, ahead: 0, url: nil), "Karaoke isn't set up on your ECHO server yet."),
    ])
    func words(answer: KaraokeAnswer, words: String) async {
        source.script("al-1-t1", answer)
        #expect(await make().request(song(1)) == words)
        #expect(source.asks == [.init(id: "al-1-t1", soon: false)]) // now, not "soon"
    }

    @Test("A server that cannot be reached, and a song that is not the library's")
    func errors() async {
        source.failing = true
        #expect(await make().request(song(1)) == "Couldn't reach ECHO. Try again in a moment.")
        let other = Track(id: "yt1", title: "Elsewhere", artists: [], album: song(1).album, durationMs: 1, provider: "youtube")
        #expect(await make().request(other) == "Karaoke works with songs from your library.")
        #expect(source.asks.count == 1)
    }

    @Test("A version that is ready plays when Karaoke is on")
    func readyPlays() async {
        let karaoke = make()
        source.script("al-1-t1", .init(status: .ready, ahead: 0, url: "/api/v1/karaoke/al-1-t1/audio"))
        _ = await karaoke.request(song(1))
        device.setKaraoke(true)
        #expect(karaoke.audio(for: song(1)) == "/api/v1/karaoke/al-1-t1/audio")
    }

    @Test("The menu offers it for the library's songs, and not to a guest")
    func menu() {
        #expect(Karaoke.offersMaking(song(1), listensOnly: false))
        #expect(!Karaoke.offersMaking(song(1), listensOnly: true))
        let other = Track(id: "yt1", title: "x", artists: [], album: song(1).album, durationMs: 1, provider: "youtube")
        #expect(!Karaoke.offersMaking(other, listensOnly: false))
    }

    @Test("Settings' line: ready of all, the disk, and what failed")
    func line() {
        let p = KaraokeProgress(enabled: true, online: true, ready: 126, queued: 214, failed: 2, skipped: 1, bytes: 843_000_000)
        #expect(Karaoke.progressLine(p) == "126 of 343 songs ready · 0.8 GB · 2 couldn't be separated")
        let clean = KaraokeProgress(enabled: true, online: true, ready: 2, queued: 0, failed: 0, skipped: 0, bytes: 13_400_000)
        #expect(Karaoke.progressLine(clean) == "2 of 2 songs ready · 0.0 GB")
    }
}
