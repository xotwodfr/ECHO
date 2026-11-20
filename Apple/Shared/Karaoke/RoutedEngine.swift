import Foundation

/// The engine the player talks to: an ordinary song plays through the ordinary engine, a song with
/// its karaoke version through the Karaoke engine (the item says which, `EngineItem.karaoke`), and
/// loading one stops the other. A song and the one buffered after it hand over without a gap only
/// within one engine; across the two the buffered song is dropped and the player loads it when its
/// turn comes.
@MainActor
final class RoutedEngine: PlaybackEngine {
    enum Kind: Equatable, Sendable {
        case plain, karaoke
    }

    var onEvent: ((EngineEvent) -> Void)?

    var volume: Float = 1 {
        didSet {
            plain.volume = volume
            karaoke.volume = volume
        }
    }

    let plain: any PlaybackEngine
    let karaoke: any PlaybackEngine
    /// The engine that has the song.
    private(set) var active = Kind.plain

    var currentTime: Double? { engine(active).currentTime }
    var outputLatency: Double { engine(active).outputLatency }

    init(plain: any PlaybackEngine, karaoke: any PlaybackEngine) {
        self.plain = plain
        self.karaoke = karaoke
        plain.onEvent = { [weak self] event in self?.forward(event, from: .plain) }
        karaoke.onEvent = { [weak self] event in self?.forward(event, from: .karaoke) }
    }

    private func engine(_ kind: Kind) -> any PlaybackEngine { kind == .karaoke ? karaoke : plain }

    /// What the engine that has the song says; the other one says nothing the player should hear.
    private func forward(_ event: EngineEvent, from kind: Kind) {
        guard kind == active else { return }
        onEvent?(event)
    }

    func load(_ item: EngineItem, at seconds: Double, play: Bool) {
        let kind: Kind = item.karaoke ? .karaoke : .plain
        if kind != active {
            engine(active).stop()
            active = kind
        }
        engine(kind).load(item, at: seconds, play: play)
    }

    func preload(_ item: EngineItem?) {
        guard let item else {
            engine(active).preload(nil)
            return
        }
        let kind: Kind = item.karaoke ? .karaoke : .plain
        // Another engine cannot take over without a gap: nothing is buffered, and the player loads it.
        engine(active).preload(kind == active ? item : nil)
    }

    func play() { engine(active).play() }
    func pause() { engine(active).pause() }
    func seek(to seconds: Double) { engine(active).seek(to: seconds) }

    func stop() {
        plain.stop()
        karaoke.stop()
    }
}
