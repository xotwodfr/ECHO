import AVFoundation
import Foundation

/// The engine the apps play through: an AVQueuePlayer with the next song queued behind the one
/// playing, so it starts without a gap where the formats allow (PLAYBACK_ARCHITECTURE.md §5.6; the
/// web does it with two audio elements). On the iPhone the audio session is set for music, so it
/// plays on with the screen off (the app's `UIBackgroundModes` audio), and its interruptions and the
/// headphones coming out are passed to the player.
@MainActor
final class AVPlaybackEngine: PlaybackEngine {
    var onEvent: ((EngineEvent) -> Void)?
    var volume: Float = 1 {
        didSet { applyVolume() }
    }

    var currentTime: Double? {
        // An item on its way to its start position is not there yet.
        guard current != nil, pendingSeek == nil else { return nil }
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? seconds : nil
    }

    /// A song in the player's queue, and what watches it.
    private final class Entry {
        let key: String
        let item: AVPlayerItem
        let gain: Float
        var watches: [NSKeyValueObservation] = []

        init(_ source: EngineItem) {
            key = source.key
            gain = source.gain
            item = AVPlayerItem(url: source.url)
        }
    }

    private let player = AVQueuePlayer()
    private var current: Entry?
    private var next: Entry?
    /// Asked to play, whatever the player is doing now.
    private var wantsPlay = false
    /// Where an item not ready yet starts: it plays from there once it is (an item cannot seek
    /// before it is ready).
    private var pendingSeek: Double?
    private var reported: EngineStatus?
    private var watches: [NSKeyValueObservation] = []
    private var tokens: [NSObjectProtocol] = []
    private var timeToken: Any?

    init() {
        player.actionAtItemEnd = .advance
        #if os(iOS)
        // Music: on with the screen locked and the switch on silent; AirPlay 2 for its route.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, policy: .longFormAudio)
        #endif
        timeToken = player.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 2), queue: .main
        ) { [weak self] time in
            let seconds = time.seconds
            MainActor.assumeIsolated { self?.ticked(seconds) }
        }
        watches.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.report() }
        })
        let center = NotificationCenter.default
        tokens.append(center.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main
        ) { [weak self] note in
            let id = (note.object as? AVPlayerItem).map { ObjectIdentifier($0) }
            MainActor.assumeIsolated { self?.itemEnded(id) }
        })
        tokens.append(center.addObserver(
            forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: nil, queue: .main
        ) { [weak self] note in
            let id = (note.object as? AVPlayerItem).map { ObjectIdentifier($0) }
            MainActor.assumeIsolated { self?.itemFailed(id) }
        })
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        tokens.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard let type = raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) else { return }
            let options = AVAudioSession.InterruptionOptions(
                rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            let event: EngineEvent
            switch type {
            case .began: event = .interruptionBegan
            case .ended: event = .interruptionEnded(shouldResume: options.contains(.shouldResume))
            @unknown default: return
            }
            MainActor.assumeIsolated { self?.onEvent?(event) }
        })
        tokens.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            guard raw.flatMap(AVAudioSession.RouteChangeReason.init(rawValue:)) == .oldDeviceUnavailable else { return }
            MainActor.assumeIsolated { self?.onEvent?(.headphonesOut) }
        })
        #endif
    }

    // MARK: - PlaybackEngine

    func load(_ item: EngineItem, at seconds: Double, play: Bool) {
        wantsPlay = play
        reported = nil
        if let next, next.key == item.key, seconds <= 0, current != nil {
            // The next song is buffered already: on at once (Next, or a tap on it in the queue).
            player.advanceToNextItem()
            current = next
            self.next = nil
            pendingSeek = nil
            applyVolume()
            if play { start() } else { player.pause() }
            report()
            return
        }
        clear()
        let entry = watched(Entry(item))
        current = entry
        player.insert(entry.item, after: nil)
        applyVolume()
        if seconds > 0 {
            // Held until the item is ready and has gone to the start position.
            pendingSeek = seconds
            player.pause()
        } else if play {
            start()
        } else {
            player.pause()
        }
        report()
    }

    func preload(_ item: EngineItem?) {
        if let next {
            player.remove(next.item)
            self.next = nil
        }
        guard let item, let current, player.items().contains(current.item) else { return }
        let entry = watched(Entry(item))
        guard player.canInsert(entry.item, after: current.item) else { return }
        player.insert(entry.item, after: current.item)
        next = entry
    }

    func play() {
        wantsPlay = true
        guard current != nil else { return }
        if pendingSeek == nil { start() }
        report()
    }

    func pause() {
        wantsPlay = false
        player.pause()
        report()
    }

    func seek(to seconds: Double) {
        guard let current else { return }
        guard current.item.status == .readyToPlay else {
            pendingSeek = seconds
            return
        }
        player.seek(
            to: CMTime(seconds: max(0, seconds), preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
        if pendingSeek != nil {
            // This seek replaces a start position still on its way.
            pendingSeek = nil
            if wantsPlay { start() }
            report()
        }
    }

    func stop() {
        wantsPlay = false
        player.pause()
        clear()
        reported = nil
    }

    // MARK: - What the player says

    private func start() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        player.play()
    }

    private func clear() {
        player.removeAllItems()
        current = nil
        next = nil
        pendingSeek = nil
    }

    private func applyVolume() {
        player.volume = max(0, min(1, volume)) * (current?.gain ?? 1)
    }

    private func watched(_ entry: Entry) -> Entry {
        let id = ObjectIdentifier(entry.item)
        entry.watches.append(entry.item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            Task { @MainActor in self?.itemStatus(id, status) }
        })
        entry.watches.append(entry.item.observe(\.duration, options: [.new]) { [weak self] item, _ in
            let seconds = item.duration.seconds
            Task { @MainActor in self?.itemDuration(id, seconds) }
        })
        return entry
    }

    private func isCurrent(_ id: ObjectIdentifier?) -> Bool {
        guard let current, let id else { return false }
        return ObjectIdentifier(current.item) == id
    }

    /// The engine's status as the player should see it, told once per change.
    private func report() {
        guard current != nil else { return }
        let status: EngineStatus
        if pendingSeek != nil {
            status = wantsPlay ? .buffering : .paused
        } else {
            switch player.timeControlStatus {
            case .playing: status = .playing
            case .waitingToPlayAtSpecifiedRate: status = .buffering
            default: status = .paused
            }
        }
        guard status != reported else { return }
        reported = status
        onEvent?(.status(status))
    }

    private func ticked(_ seconds: Double) {
        report()
        guard current != nil, pendingSeek == nil, seconds.isFinite else { return }
        onEvent?(.time(seconds))
    }

    private func itemStatus(_ id: ObjectIdentifier, _ status: AVPlayerItem.Status) {
        switch status {
        case .readyToPlay:
            guard isCurrent(id), let current, let seconds = pendingSeek else { return }
            current.item.seek(
                to: CMTime(seconds: seconds, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero
            ) { [weak self] _ in
                Task { @MainActor in self?.sought(id) }
            }
        case .failed:
            itemFailed(id)
        default:
            break
        }
    }

    /// The item went to its start position: it plays from there if asked to.
    private func sought(_ id: ObjectIdentifier) {
        guard isCurrent(id), pendingSeek != nil else { return }
        pendingSeek = nil
        if wantsPlay { start() }
        report()
        if let seconds = currentTime { onEvent?(.time(seconds)) }
    }

    private func itemDuration(_ id: ObjectIdentifier, _ seconds: Double) {
        guard isCurrent(id), seconds.isFinite, seconds > 0 else { return }
        onEvent?(.duration(seconds))
    }

    private func itemEnded(_ id: ObjectIdentifier?) {
        guard isCurrent(id) else { return }
        reported = nil
        if let next {
            // The queue player went on to the song buffered behind it: no gap.
            current = next
            self.next = nil
            applyVolume()
            onEvent?(.advanced(next.key))
            report()
        } else {
            current = nil
            onEvent?(.ended)
        }
    }

    private func itemFailed(_ id: ObjectIdentifier?) {
        if isCurrent(id), let current {
            let key = current.key
            clear()
            reported = nil
            onEvent?(.failed(key))
        } else if let next, let id, ObjectIdentifier(next.item) == id {
            player.remove(next.item)
            self.next = nil
            onEvent?(.preloadFailed(next.key))
        }
    }
}
