import AVFoundation
import Foundation
import Observation

/// The baseline's player (iOS/README.md), moved here for the playback task to build on: a queue
/// played one song after another through AVPlayer from signed stream URLs, on with the screen off,
/// stopping after the last song. Task 3 makes it the real queue (gapless, `/me/queue`, the lock
/// screen and Control Center).
@MainActor @Observable
final class Player {
    private(set) var queue: [Track] = []
    private(set) var current: Int? = nil
    private(set) var playing = false
    /// Seconds into the current song.
    private(set) var position: Double = 0
    /// Why the last song could not start.
    private(set) var error: ApiError? = nil

    var track: Track? { current.flatMap { queue.indices.contains($0) ? queue[$0] : nil } }

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

    func play(_ tracks: [Track], at index: Int) async {
        queue = tracks
        await play(at: index)
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
        position = 0
    }
}
