import AVFoundation
import Foundation
import Observation

/// The baseline's player (iOS/README.md), moved here for the playback task to build on: a queue
/// played one song after another through AVPlayer from signed stream URLs, on with the screen off,
/// stopping after the last song. Task 3 makes it the real queue (gapless, `/me/queue`, the lock
/// screen and Control Center).
///
/// The library's screens reach it through these entry points only: `play(_:at:context:)` (a row,
/// a Play button, a shelf's card), `shuffle(_:context:)`, `playNext(_:)` and `addToQueue(_:)`
/// (the song and album menus), `track` and `context` (the row and page that are playing).
@MainActor @Observable
final class Player {
    private(set) var queue: [Track] = []
    private(set) var current: Int? = nil
    private(set) var playing = false
    /// Seconds into the current song.
    private(set) var position: Double = 0
    /// Why the last song could not start.
    private(set) var error: ApiError? = nil

    /// Where the queue was started from (an album, a playlist, a mix…).
    private(set) var context: PlayContext? = nil

    var track: Track? { current.flatMap { queue.indices.contains($0) ? queue[$0] : nil } }

    /// Whether this album, playlist or mix is what plays.
    func isCurrent(_ context: PlayContext) -> Bool {
        self.context?.kind == context.kind && self.context?.id == context.id && track != nil
    }

    @ObservationIgnored private let client: EchoClient
    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var observers: [Any] = []

    init(client: EchoClient) {
        self.client = client
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback) // plays on with the screen off
        #endif
        observers.append(NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.next() }
        })
        observers.append(player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 1), queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated { self?.position = time.seconds.isFinite ? time.seconds : 0 }
        })
    }

    /// A new queue: `tracks` from `index`, started from `context`.
    func play(_ tracks: [Track], at index: Int, context: PlayContext? = nil) async {
        queue = tracks
        self.context = context
        await play(at: index)
    }

    /// A new queue in a random order.
    func shuffle(_ tracks: [Track], context: PlayContext? = nil) async {
        await play(tracks.shuffled(), at: 0, context: context)
    }

    /// Songs to play after the current one (or now, when nothing plays).
    func playNext(_ tracks: [Track]) {
        guard let c = current, !queue.isEmpty else {
            Task { await play(tracks, at: 0) }
            return
        }
        queue.insert(contentsOf: tracks, at: c + 1)
    }

    /// Songs at the end of the queue (or now, when nothing plays).
    func addToQueue(_ tracks: [Track]) {
        guard current != nil, !queue.isEmpty else {
            Task { await play(tracks, at: 0) }
            return
        }
        queue.append(contentsOf: tracks)
    }

    private func play(at index: Int) async {
        guard queue.indices.contains(index) else { return }
        current = index
        position = 0
        error = nil
        do {
            let stream = try await client.streamURL(for: queue[index])
            guard current == index else { return } // a newer tap won meanwhile
            player.replaceCurrentItem(with: AVPlayerItem(url: stream.url))
            player.play()
            playing = true
        } catch {
            self.error = error as? ApiError ?? .unreachable
            playing = false
        }
    }

    func toggle() {
        if playing { player.pause() } else { player.play() }
        playing.toggle()
    }

    /// The queue goes on; after its last song the player stops.
    func next() {
        if let c = current, c + 1 < queue.count {
            Task { await play(at: c + 1) }
        } else {
            playing = false
        }
    }

    /// Everything stops and the queue empties (signing out).
    func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        playing = false
        current = nil
        queue = []
        context = nil
        position = 0
    }
}
