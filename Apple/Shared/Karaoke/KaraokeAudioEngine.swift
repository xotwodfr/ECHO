import AVFoundation
import Foundation

/// The engine Karaoke plays through (docs/KARAOKE.md): the server's 5.1 file (instrumental on front
/// left/right, vocals on rear left/right) is fetched to a file, read in two-second pieces, and each
/// piece split into two stereo pairs for two player nodes. The nodes meet in a mixer, where the
/// vocals' node volume is the Vocals slider (`instrumental + level × vocals`, as Android's
/// VocalMixProcessor and the web's `vocalGains`), so the slider acts at once and without a gap; a
/// time-pitch unit after it moves the key at the same tempo (±6 semitones, in cents). Any other file
/// (stereo or mono) plays whole.
///
/// The song after this one is fetched while this one plays (`preload`) and starts the moment this one
/// ends, so Karaoke songs follow each other with no more than a moment between them; a Karaoke song
/// and an ordinary one hand over through the player (RoutedEngine), not gaplessly.
///
/// Only a device can run it: the tests use a fake engine, and the sums are KaraokeMath's.
@MainActor
final class KaraokeAudioEngine: PlaybackEngine, KaraokeControls {
    var onEvent: ((EngineEvent) -> Void)?

    /// The app's own volume, under the song's ReplayGain.
    var volume: Float = 1 {
        didSet { applyVolume() }
    }

    var vocalLevel: Float = 0 {
        didSet { applyMix() }
    }

    var keyShift = 0 {
        didSet { applyKey() }
    }

    /// Where the song is: the played time of the instrumental node from where it started.
    var currentTime: Double? {
        guard key != nil, file != nil else { return nil }
        return position()
    }

    /// The device's output latency, and the time-pitch unit's own while it works.
    var outputLatency: Double {
        let now = ProcessInfo.processInfo.systemUptime
        if now - latencyReadAt >= 1 {
            latency = AVPlaybackEngine.readLatency()
            latencyReadAt = now
        }
        return latency + (pitch.bypass ? 0 : pitch.latency)
    }

    /// Fetches the karaoke audio for a track key at a server path into a file.
    typealias Download = @Sendable (_ key: String, _ path: String) async throws -> URL

    private let download: Download
    private let engine = AVAudioEngine()
    private let instrumental = AVAudioPlayerNode()
    private let vocals = AVAudioPlayerNode()
    private let sum = AVAudioMixerNode()
    private let pitch = AVAudioUnitTimePitch()
    private var graphRate: Double = 0
    private var latency: Double = 0
    private var latencyReadAt: TimeInterval = -1000

    /// The song loaded, and what it plays from.
    private var key: String?
    private var gain: Float = 1
    private var file: AVAudioFile?
    private var channels = KaraokeChannels.frontRear
    private var fileDuration: Double = 0
    /// Bumped by each load, seek and stop: the callbacks of buffers scheduled before are dropped.
    private var generation = 0
    private var wantsPlay = false
    /// The nodes run (a file is loaded and Play was asked).
    private var started = false
    private var running = false
    /// Where in the song the nodes' time zero is, and where it was left while they do not run.
    private var base: Double = 0
    private var held: Double = 0
    private var reported: EngineStatus?
    private var fetching: Task<Void, Never>?
    private var ticking: Task<Void, Never>?
    /// The song after this one: its item, and its file once fetched.
    private var next: (item: EngineItem, file: URL?)?
    private var nextFetch: Task<Void, Never>?
    private var tokens: [NSObjectProtocol] = []

    /// Frames in a piece: two seconds.
    private static let pieceSeconds = 2.0
    /// Pieces scheduled ahead of the one playing.
    private static let depth = 4

    init(download: @escaping Download) {
        self.download = download
        for node in [instrumental, vocals, sum, pitch] as [AVAudioNode] { engine.attach(node) }
        pitch.rate = 1
        applyMix()
        applyKey()
        KaraokeFiles.prune(keeping: [])
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        let center = NotificationCenter.default
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
            MainActor.assumeIsolated { if self?.key != nil { self?.onEvent?(event) } }
        })
        tokens.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            guard raw.flatMap(AVAudioSession.RouteChangeReason.init(rawValue:)) == .oldDeviceUnavailable else { return }
            MainActor.assumeIsolated { if self?.key != nil { self?.onEvent?(.headphonesOut) } }
        })
        #endif
        // The engine stopped by itself (the output changed, an interruption ended): play on from where
        // it was.
        tokens.append(NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.recover() }
        })
    }

    // MARK: - PlaybackEngine

    func load(_ item: EngineItem, at seconds: Double, play: Bool) {
        halt()
        key = item.key
        gain = item.gain
        wantsPlay = play
        held = max(0, seconds)
        reported = nil
        applyVolume()
        // The song was fetched while the one before it played.
        if let next, next.item.key == item.key, let url = next.file, seconds <= 0 {
            self.next = nil
            open(url, gen: generation)
        } else {
            fetch(item, gen: generation)
        }
        say(play ? .buffering : .paused)
    }

    func preload(_ item: EngineItem?) {
        nextFetch?.cancel()
        nextFetch = nil
        guard let item, item.karaoke, key != nil else {
            next = nil
            return
        }
        next = (item, nil)
        let path = item.url.absoluteString
        let itemKey = item.key
        let download = self.download
        nextFetch = Task { [weak self] in
            guard let url = try? await download(itemKey, path), !Task.isCancelled else { return }
            await MainActor.run {
                guard let self, self.next?.item.key == itemKey else { return }
                self.next?.file = url
            }
        }
    }

    func play() {
        wantsPlay = true
        guard key != nil else { return }
        if file != nil, !started { startNodes() }
        say(started ? .playing : .buffering)
    }

    func pause() {
        wantsPlay = false
        if started {
            held = position()
            instrumental.pause()
            vocals.pause()
            started = false
            ticking?.cancel()
        }
        say(.paused)
    }

    func seek(to seconds: Double) {
        guard key != nil else { return }
        held = max(0, seconds)
        guard let file else { return }
        generation += 1
        stopNodes()
        position(of: file, at: held)
        refill(gen: generation)
        if wantsPlay { startNodes() }
    }

    func stop() {
        halt()
        key = nil
        next = nil
        nextFetch?.cancel()
        nextFetch = nil
        wantsPlay = false
        reported = nil
        held = 0
        if engine.isRunning { engine.pause() }
    }

    // MARK: - Fetching and opening

    private func fetch(_ item: EngineItem, gen: Int) {
        let path = item.url.absoluteString
        let itemKey = item.key
        let download = self.download
        fetching = Task { [weak self] in
            do {
                let url = try await download(itemKey, path)
                await MainActor.run { if let self, gen == self.generation { self.open(url, gen: gen) } }
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    guard let self, gen == self.generation else { return }
                    self.key = nil
                    self.onEvent?(.failed(itemKey))
                }
            }
        }
    }

    /// The file is here: it is connected at its sample rate, and plays from where it was asked to.
    private func open(_ url: URL, gen: Int) {
        guard let key else { return }
        do {
            let opened = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
            let format = opened.processingFormat
            channels = KaraokeChannels.forFile(
                channels: Int(format.channelCount), layout: format.channelLayout?.layoutTag)
            fileDuration = Double(opened.length) / format.sampleRate
            connect(rate: format.sampleRate)
            file = opened
            position(of: opened, at: held)
            onEvent?(.duration(fileDuration))
            refill(gen: gen)
            KaraokeFiles.prune(keeping: Set([key, next?.item.key].compactMap { $0 }))
            if wantsPlay { startNodes() } else { say(.paused) }
        } catch {
            self.key = nil
            onEvent?(.failed(key))
        }
    }

    /// The graph at the file's rate: both nodes into the mixer, the mixer through the time-pitch unit
    /// to the output.
    private func connect(rate: Double) {
        guard rate != graphRate, let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) else { return }
        engine.stop()
        engine.disconnectNodeOutput(instrumental)
        engine.disconnectNodeOutput(vocals)
        engine.disconnectNodeOutput(sum)
        engine.disconnectNodeOutput(pitch)
        engine.connect(instrumental, to: sum, fromBus: 0, toBus: 0, format: format)
        engine.connect(vocals, to: sum, fromBus: 0, toBus: 1, format: format)
        engine.connect(sum, to: pitch, format: format)
        engine.connect(pitch, to: engine.mainMixerNode, format: format)
        graphRate = rate
        applyMix()
        applyVolume()
    }

    private func position(of file: AVAudioFile, at seconds: Double) {
        let rate = file.processingFormat.sampleRate
        file.framePosition = min(max(0, AVAudioFramePosition(seconds * rate)), max(0, file.length - 1))
        base = Double(file.framePosition) / rate
        held = base
    }

    // MARK: - Feeding the nodes

    /// Schedules pieces until `depth` are waiting: each piece's end schedules one more.
    private func refill(gen: Int) {
        guard gen == generation, file != nil else { return }
        while pending < Self.depth, schedulePiece(gen: gen) {}
    }

    /// Pieces handed to the nodes that have not been consumed.
    private var pending = 0

    /// Reads the next piece of the file into the two nodes; false at the file's end or on an error.
    private func schedulePiece(gen: Int) -> Bool {
        guard let file, file.framePosition < file.length else { return false }
        let format = file.processingFormat
        let frames = AVAudioFrameCount(min(Int64(format.sampleRate * Self.pieceSeconds), file.length - file.framePosition))
        guard frames > 0, let stereo = AVAudioFormat(standardFormatWithSampleRate: format.sampleRate, channels: 2),
              let source = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let front = AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: frames),
              let rear = AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: frames)
        else { return false }
        do { try file.read(into: source, frameCount: frames) } catch { return false }
        guard source.frameLength > 0, channels.split(source, into: front, vocals: rear) else { return false }
        let last = file.framePosition >= file.length
        pending += 1
        if last {
            instrumental.scheduleBuffer(front, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                Task { @MainActor in self?.finished(gen: gen) }
            }
        } else {
            instrumental.scheduleBuffer(front, completionCallbackType: .dataConsumed) { [weak self] _ in
                Task { @MainActor in self?.consumed(gen: gen) }
            }
        }
        vocals.scheduleBuffer(rear, completionCallbackType: .dataConsumed, completionHandler: nil)
        return !last
    }

    private func consumed(gen: Int) {
        guard gen == generation else { return }
        pending = max(0, pending - 1)
        refill(gen: gen)
    }

    /// The last piece was heard: the song after it starts at once if it was fetched, else the player
    /// is told and loads it.
    private func finished(gen: Int) {
        guard gen == generation, key != nil else { return }
        started = false
        ticking?.cancel()
        if let next, let url = next.file, wantsPlay {
            self.next = nil
            generation += 1
            stopNodes()
            self.key = next.item.key
            gain = next.item.gain
            held = 0
            applyVolume()
            // The player moves on to the song first, then hears its length.
            onEvent?(.advanced(next.item.key))
            open(url, gen: generation)
        } else {
            self.key = nil
            file = nil
            onEvent?(.ended)
        }
    }

    // MARK: - Running the nodes

    /// Both nodes begin together, a moment from now.
    private func startNodes() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        if !engine.isRunning {
            engine.prepare()
            do { try engine.start() } catch {
                if let key { onEvent?(.failed(key)) }
                return
            }
        }
        let at = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.05))
        instrumental.play(at: at)
        vocals.play(at: at)
        started = true
        say(.playing)
        ticking?.cancel()
        ticking = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                await MainActor.run { if let self, self.started { self.onEvent?(.time(self.position())) } }
            }
        }
    }

    private func stopNodes() {
        instrumental.stop()
        vocals.stop()
        pending = 0
        started = false
        ticking?.cancel()
    }

    /// Everything of the song loaded stops, and what it scheduled is forgotten.
    private func halt() {
        generation += 1
        fetching?.cancel()
        fetching = nil
        stopNodes()
        file = nil
    }

    /// Where the song is now.
    private func position() -> Double {
        guard started, let time = instrumental.lastRenderTime, let player = instrumental.playerTime(forNodeTime: time),
              player.sampleRate > 0
        else { return held }
        return min(max(base, base + Double(player.sampleTime) / player.sampleRate), max(fileDuration, base))
    }

    /// The engine stopped by itself: the song goes on from where it was heard.
    private func recover() {
        guard key != nil, let file else { return }
        let at = started ? position() : held
        generation += 1
        stopNodes()
        position(of: file, at: at)
        refill(gen: generation)
        if wantsPlay { startNodes() }
    }

    // MARK: - The mix, the key and the volume

    private func applyMix() {
        let v = KaraokeMath.volumes(level: Double(vocalLevel))
        instrumental.volume = v.instrumental
        vocals.volume = v.vocals
    }

    private func applyKey() {
        pitch.pitch = KaraokeMath.cents(key: keyShift)
        // No shift: the signal goes through untouched.
        pitch.bypass = keyShift == 0
    }

    private func applyVolume() {
        engine.mainMixerNode.outputVolume = max(0, min(1, volume)) * gain
    }

    private func say(_ status: EngineStatus) {
        guard status != reported else { return }
        reported = status
        onEvent?(.status(status))
    }
}
