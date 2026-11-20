import Foundation
import Observation

/// Karaoke mode (docs/KARAOKE.md), as on Android (Karaoke.kt) and the web (karaoke.ts). While it is
/// on, the server is asked about the song playing (made first, every 5 s until it is ready) and the
/// next two in the queue (made next, once a minute each); each karaoke version that is ready is
/// handed to the player, which switches to it at the same position. The vocals level and the key go
/// straight to the audio engine (`KaraokeControls`), so the sliders act at once.
///
/// What is on, the level and the key are this device's (DeviceSettings), as the web keeps them.
@MainActor @Observable
final class Karaoke {
    /// What Karaoke can say about the song playing.
    enum Status: Equatable, Sendable {
        case off
        /// No stem service on the server, or the song is not from the library.
        case unavailable
        /// Queued or being made.
        case preparing
        case ready
        case failed
        /// Longer than the server's limit.
        case tooLong
    }

    /// Whether the server has a stem service at all (nil: not asked yet).
    private(set) var server: Bool?
    private(set) var status = Status.off
    /// Songs before this one on the server while it is prepared.
    private(set) var ahead = 0
    /// The server's progress through the library (Settings → Karaoke), once asked.
    private(set) var progress: KaraokeProgress?
    /// Why the progress is not shown, in a line.
    private(set) var progressNote: String?

    let device: DeviceSettings

    @ObservationIgnored var source: (any KaraokeSource)?
    @ObservationIgnored var controls: (any KaraokeControls)? {
        didSet { applyControls() }
    }
    @ObservationIgnored weak var player: Player?
    /// The karaoke audio's server path, by track key.
    @ObservationIgnored private var ready: [String: String] = [:]
    /// Songs the server answered for for good (ready, failed or too long), by track key.
    @ObservationIgnored private var settled: [String: Status] = [:]
    /// When each song was last asked about, so polling stays slow.
    @ObservationIgnored private var asked: [String: Date] = [:]
    /// Songs whose karaoke file would not play: the original plays until the time given.
    @ObservationIgnored private var broken: [String: Date] = [:]
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let now: () -> Date

    /// The song playing is asked about this often until it is ready, the next two this often.
    static let playingEvery: TimeInterval = 5
    static let upNextEvery: TimeInterval = 60
    /// A karaoke file that would not play is left alone this long.
    static let brokenFor: TimeInterval = 5 * 60
    /// How often the loop looks.
    static let tickEvery: Duration = .seconds(3)

    init(
        device: DeviceSettings, source: (any KaraokeSource)? = nil, controls: (any KaraokeControls)? = nil,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> Date = { Date() }
    ) {
        self.device = device
        self.source = source
        self.controls = controls
        self.sleep = sleep
        self.now = now
        applyControls()
    }

    // MARK: - What the listener chooses

    var isOn: Bool { device.karaoke }
    var level: Double { device.vocalLevel }
    var key: Int { device.karaokeKey }

    func setOn(_ on: Bool) {
        guard on != device.karaoke else { return }
        device.setKaraoke(on)
        if !on { status = .off }
        // The song plays from the other source at the same place (the original now, or its version).
        player?.karaokeChanged()
        if on { Task { await tick() } }
    }

    func setLevel(_ level: Double) {
        device.setVocalLevel(level)
        applyControls()
    }

    func setKey(_ key: Int) {
        device.setKaraokeKey(key)
        applyControls()
    }

    private func applyControls() {
        controls?.vocalLevel = Float(KaraokeMath.clampLevel(device.vocalLevel))
        controls?.keyShift = KaraokeMath.clampKey(device.karaokeKey)
    }

    // MARK: - What the player asks

    /// The server path of `track`'s karaoke audio, while Karaoke is on and the version is ready.
    func audio(for track: Track) -> String? {
        guard device.karaoke, track.provider == "navidrome", let path = ready[track.key] else { return nil }
        if let until = broken[track.key], until > now() { return nil }
        return path
    }

    /// Songs the Home shelf lists are ready: they play as karaoke from the first note.
    func markReady(_ tracks: [Track]) {
        for track in tracks where track.provider == "navidrome" {
            ready[track.key] = Self.audioPath(track.id)
            settled[track.key] = .ready
        }
    }

    /// A karaoke file that would not play: the original plays, and the file is tried again later.
    func unusable(_ track: Track) {
        broken[track.key] = now().addingTimeInterval(Self.brokenFor)
    }

    static func audioPath(_ id: String) -> String { "/api/v1/karaoke/\(EchoClient.encode(id))/audio" }

    /// Signed out: another account's server knows other songs.
    func clear() {
        ready = [:]
        settled = [:]
        asked = [:]
        broken = [:]
        server = nil
        status = .off
        ahead = 0
        progress = nil
        progressNote = nil
    }

    // MARK: - Asking the server

    /// Follows the player while this runs (the app's signed-in task): looks every few seconds.
    func run() async {
        while !Task.isCancelled {
            await tick()
            try? await sleep(Self.tickEvery)
        }
    }

    /// One look: the song playing, and the next two.
    func tick() async {
        guard let source, let player else { return }
        guard device.karaoke, let track = player.track else {
            if status != .off { status = .off }
            return
        }
        if server == nil {
            guard let enabled = try? await source.karaokeProgress().enabled else { return }
            server = enabled
        }
        guard server == true, track.provider == "navidrome" else {
            status = .unavailable
            return
        }
        if let answer = await ask(track, soon: false, every: Self.playingEvery) {
            status = Self.status(of: answer.status)
            ahead = answer.ahead
        }
        // A version that is ready for the song playing: it plays from there, from the same place (a
        // song that was buffered as the original, or whose version came while it played).
        player.karaokeChanged()
        for next in player.upcoming.prefix(2) where next.provider == "navidrome" {
            _ = await ask(next, soon: true, every: Self.upNextEvery)
        }
    }

    /// Asks about one song (at most every `every` seconds); nil when it was not asked now or the
    /// server could not be reached.
    private func ask(_ track: Track, soon: Bool, every: TimeInterval) async -> KaraokeAnswer? {
        if let done = settled[track.key] {
            return KaraokeAnswer(status: Self.wire(done), ahead: 0, url: ready[track.key])
        }
        let at = now()
        if let last = asked[track.key], last.addingTimeInterval(every) > at { return nil }
        asked[track.key] = at
        guard let answer = try? await source?.karaoke(id: track.id, soon: soon) else { return nil }
        if answer.status == .ready {
            ready[track.key] = answer.url ?? Self.audioPath(track.id)
        }
        switch answer.status {
        case .ready, .failed, .skipped: settled[track.key] = Self.status(of: answer.status)
        case .off: server = false
        default: break
        }
        return answer
    }

    static func status(of answer: KaraokeAnswer.Status) -> Status {
        switch answer {
        case .ready: .ready
        case .failed: .failed
        case .skipped: .tooLong
        case .off: .unavailable
        case .queued, .working: .preparing
        }
    }

    private static func wire(_ status: Status) -> KaraokeAnswer.Status {
        switch status {
        case .ready: .ready
        case .failed: .failed
        case .tooLong: .skipped
        default: .queued
        }
    }

    /// The preview's state (`-ECHODemo karaoke…`): what the server says about the song playing.
    func preview(status: Status, ahead: Int = 0, progress: KaraokeProgress? = nil) {
        server = true
        self.status = status
        self.ahead = ahead
        if let progress { self.progress = progress }
    }

    // MARK: - Make karaoke version

    /// A song's menu → Make karaoke version: the server makes it next (ahead of the library), and the
    /// notice says where it is (the web's `requestKaraoke`, Android's `Karaoke.request`).
    func request(_ track: Track) async -> String {
        guard track.provider == "navidrome" else { return Self.requestWords.unavailable }
        guard let source, let answer = try? await source.karaoke(id: track.id, soon: false) else {
            return Self.requestWords.error
        }
        switch answer.status {
        case .ready:
            ready[track.key] = answer.url ?? Self.audioPath(track.id)
            settled[track.key] = .ready
            if player?.track?.key == track.key { player?.karaokeChanged() }
            return "The karaoke version of \u{201C}\(track.title)\u{201D} is ready."
        case .failed:
            settled[track.key] = .failed
            return "The voice couldn't be taken out of \u{201C}\(track.title)\u{201D}."
        case .skipped:
            settled[track.key] = .tooLong
            return "\u{201C}\(track.title)\u{201D} is too long for Karaoke."
        case .off:
            server = false
            return Self.requestWords.off
        case .queued, .working:
            if answer.ahead == 0 { return "Making the karaoke version of \u{201C}\(track.title)\u{201D} now: a few minutes." }
            let songs = answer.ahead == 1 ? "song" : "songs"
            return "\u{201C}\(track.title)\u{201D} is next in line for karaoke: \(answer.ahead) \(songs) before it."
        }
    }

    /// Whether a song's menu offers Make karaoke version: songs of the library, and not to a guest, who
    /// only listens (asking costs the host's CPU).
    static func offersMaking(_ track: Track, listensOnly: Bool) -> Bool {
        track.provider == "navidrome" && !listensOnly
    }

    static let requestWords = (
        unavailable: "Karaoke works with songs from your library.",
        off: "Karaoke isn't set up on your ECHO server yet.",
        error: "Couldn't reach ECHO. Try again in a moment."
    )

    /// The line under Settings → Karaoke: "12 of 340 songs ready · 0.1 GB · 2 couldn't be separated".
    static func progressLine(_ p: KaraokeProgress) -> String {
        let gb = String(format: "%.1f", Double(p.bytes) / 1e9)
        let failed = p.failed > 0 ? " · \(p.failed) couldn't be separated" : ""
        return "\(p.ready.formatted()) of \(p.total.formatted()) songs ready · \(gb) GB\(failed)"
    }

    // MARK: - Settings → Karaoke

    /// Asks the server for its progress (when Settings opens).
    func refreshProgress() async {
        guard let source else { return }
        do {
            let p = try await source.karaokeProgress()
            server = p.enabled
            progress = p
            progressNote = p.enabled ? (p.online ? nil : Self.offline) : Self.notSetUp
        } catch {
            progress = nil
            progressNote = nil
        }
    }

    static let notSetUp = "Not set up on your server yet: it needs the stem service (docs/KARAOKE.md)."
    static let offline = "The server's stem service isn't answering right now."
}

/// What the audio engine takes live from Karaoke: how much of the voice is left and the key.
@MainActor
protocol KaraokeControls: AnyObject {
    /// 0 (the instrumental) to 1 (the song as recorded).
    var vocalLevel: Float { get set }
    /// Whole semitones, −6 to 6.
    var keyShift: Int { get set }
}

/// What Karaoke tells the listener about the song playing; nil when there is nothing to say (it is
/// ready and playing). The words of the web (karaokeNote) and Android.
enum KaraokeNote {
    static func text(status: Karaoke.Status, ahead: Int, server: Bool?) -> String? {
        switch status {
        case .off, .ready: nil
        case .unavailable:
            server == false
                ? "Karaoke needs the stem service on your ECHO server (docs/KARAOKE.md)."
                : "Karaoke works with songs from your library."
        case .preparing:
            switch ahead {
            case 0: "Preparing the karaoke version… it starts by itself when it's ready."
            case 1: "Preparing the karaoke version… 1 song before this one."
            default: "Preparing the karaoke version… \(ahead) songs before this one."
            }
        case .failed: "The voice couldn't be taken out of this song."
        case .tooLong: "This song is too long for Karaoke."
        }
    }
}
