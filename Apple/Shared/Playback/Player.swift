import CoreGraphics
import Foundation
import Observation

/// What the app plays, as the web's PlaybackController does it (src/client/playback/controller.ts,
/// PLAYBACK_ARCHITECTURE.md §3, §6) and Android's Playback.kt: the queue (QueueState: what was added,
/// the rest of the album or playlist, the history), shuffle and repeat, the next song buffered for a
/// gapless hand-over, signed stream URLs fetched for each song and again before one runs out, a
/// broken stream asked for again and then skipped, scrobbles and ECHO's play history, the queue that
/// follows the user (QueueSync), the lock screen's and Control Center's info and controls
/// (MediaCenter), and on the iPhone the home-screen widget's (WidgetFeed, its buttons through
/// perform(_:)). The sound itself is the engine's (PlaybackEngine).
///
/// The library's screens reach it through `play(_:at:context:)` (a row, a Play button, a card),
/// `shuffle(_:context:)`, `playNext(_:label:)` and `addToQueue(_:label:)` (the song and album menus),
/// and read `track` and `context` (the row and page that are playing).
@MainActor @Observable
final class Player {
    enum Status: Equatable, Sendable {
        /// Nothing in the queue.
        case idle
        /// Fetching the song's stream URL, then waiting for its first sound.
        case loading
        /// Playing, waiting for data.
        case buffering
        case playing
        case paused
        /// The last song played to its end.
        case ended
        /// The song could not be played.
        case failed
    }

    enum Repeat: String, Sendable {
        case off, all, one
    }

    /// A part of the queue as Now Playing lists it.
    enum Part: Sendable {
        case nextUp, context
    }

    private(set) var queue = QueueState()
    private(set) var status = Status.idle
    /// Shuffle: the rest of a list plays in a random order (the queue's `shuffleOrder`).
    private(set) var shuffled = false
    private(set) var repeatMode = Repeat.off
    /// Seconds into the song at `positionAt`; it moves on from there while playing (time(at:)).
    private(set) var position: Double = 0
    private(set) var positionAt = Date.distantPast
    /// Why the song could not be played.
    private(set) var error: ApiError? = nil
    /// The song's length as the file has it, for one Navidrome gave none.
    private(set) var engineDuration: Double? = nil
    /// The app's own volume (the Mac's slider), 0…1: setVolume(_:).
    private(set) var volume: Float = 1

    var track: Track? { queue.now }
    /// Where the queue was started from (an album, a playlist, a mix…).
    var context: PlayContext? { queue.contextSource }
    var upcoming: [Track] { queue.upcoming }
    /// Playing, or about to (the web's "active"): Pause shows, not Play.
    var isPlaying: Bool { status == .loading || status == .buffering || status == .playing }
    var duration: Double {
        if let track, track.durationMs > 0 { return Double(track.durationMs) / 1000 }
        return engineDuration ?? 0
    }
    /// Whether Next has somewhere to go: Next up, the context, or repeat-all starting again.
    var hasNext: Bool { !upcoming.isEmpty || (repeatMode == .all && list != nil) }

    /// Where the song is at `date`: moving on from the last position while playing.
    func time(at date: Date = Date()) -> Double {
        let live = status == .playing ? position + date.timeIntervalSince(positionAt) : position
        let total = duration
        return total > 0 ? min(max(0, live), total) : max(0, live)
    }

    /// The song's time for what follows it closely (the lyrics' word sync): the engine's own clock
    /// while the song is loaded, else where it was left. Read it each frame (a TimelineView).
    var songTime: Double {
        if loaded != nil, status == .playing, let seconds = engine.currentTime { return seconds }
        return time(at: now())
    }

    /// What the listener hears now (the web's SongClock): the song's time less the output's latency
    /// (AirPlay's is large), for the lyrics. Not playing, it holds where it was left, the latency it
    /// had then and all, so a paused field never drifts (LYR-17).
    var audibleTime: Double {
        if loaded != nil, status == .playing, let seconds = engine.currentTime {
            heldLatency = engine.outputLatency
            return max(0, seconds - heldLatency)
        }
        return max(0, time(at: now()) - heldLatency)
    }

    /// Where the scrubber is held while it is dragged, seconds (the lyrics follow it), else nil.
    private(set) var scrubbing: Double? = nil

    /// The scrubber is held at `seconds` (nil: let go).
    func scrub(_ seconds: Double?) {
        scrubbing = seconds
    }

    /// Whether this album, playlist or mix is what plays.
    func isCurrent(_ context: PlayContext) -> Bool {
        self.context?.kind == context.kind && self.context?.id == context.id && track != nil
    }

    /// Previous goes back to the song's start once this much of it has played.
    static let restartAfter: Double = 3
    /// The next song is buffered this far into the current one (Next then starts at once), or 20 s
    /// before its end when it is shorter.
    static let preloadAfter: Double = 5
    static let preloadBeforeEnd: Double = 20
    /// A signed URL used for a song must last until its end and this much more.
    static let urlMargin: TimeInterval = 10 * 60
    /// A broken stream is asked for again at its position this many times (0.5, 1, 2 s apart).
    static let streamRetries = 3
    /// How long a widget's button waits for the saved queue when the app was started for it, and
    /// then for the song to start.
    static let restoreLimit: Duration = .seconds(8)
    static let skipped = "This track could not be played. Skipped to the next."
    static let unplayable = "This track could not be played from Navidrome."

    // MARK: - What it works with

    @ObservationIgnored private let source: any PlaybackSource
    @ObservationIgnored private let engine: any PlaybackEngine
    @ObservationIgnored private let media: (any MediaCenter)?
    @ObservationIgnored private weak var hearts: (any Hearts)?
    @ObservationIgnored private let images: ImageLoader?
    /// The iPhone's animated lock-screen covers (nil on the Mac, in the tests that leave it out).
    @ObservationIgnored let motion: MotionCovers?
    /// The iPhone's home-screen widget (nil on the Mac and in the preview).
    @ObservationIgnored let widget: WidgetFeed?
    @ObservationIgnored private let settings: @MainActor () -> UserSettings.Playback
    @ObservationIgnored private let quality: @MainActor () -> StreamQuality
    @ObservationIgnored private let notify: @MainActor (String) -> Void
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let random: () -> Double
    /// The queue that follows the user; nil in the preview.
    @ObservationIgnored let sync: QueueSync?

    // MARK: - Where it is

    /// The whole list started from, for repeat-all to start again.
    @ObservationIgnored private var list: (tracks: [Track], context: PlayContext?)? = nil
    /// Bumped by each new song, so a stream URL that comes late for an older one is dropped.
    @ObservationIgnored private var generation = 0
    /// What the engine has loaded, and what it has buffered next.
    @ObservationIgnored private var loaded: EngineItem? = nil
    @ObservationIgnored private var preloaded: EngineItem? = nil
    @ObservationIgnored private var loadTask: Task<Void, Never>? = nil
    @ObservationIgnored private var preloadTask: Task<Void, Never>? = nil
    @ObservationIgnored private var retryTask: Task<Void, Never>? = nil
    @ObservationIgnored private var retries = 0
    @ObservationIgnored private var scrobbles = Scrobbles()
    @ObservationIgnored private var history = PlayHistory()
    @ObservationIgnored private var artwork: (key: String, image: CGImage)? = nil
    @ObservationIgnored private var artworkKey: String? = nil
    @ObservationIgnored private var heldLatency: Double = 0
    @ObservationIgnored private var resumeAfterInterruption = false
    @ObservationIgnored private var pausedBySystemAt: Date? = nil

    /// - Parameters:
    ///   - media: the lock screen and Control Center (nil: none, as in the preview and the tests).
    ///   - hearts: the library's Liked Songs, for the heart on the lock screen.
    ///   - images: covers for the lock screen.
    ///   - motion: the lock screen's animated covers (the iPhone's).
    ///   - widget: the home-screen widget (the iPhone's).
    ///   - follows: whether the queue follows the user (`/me/queue`).
    ///   - settings: the preferences that follow the user (scrobbling, ReplayGain).
    ///   - quality: the stream quality this device chose (DeviceSettings).
    ///   - notify: a short message for the user (a toast).
    init(
        source: any PlaybackSource,
        engine: any PlaybackEngine,
        media: (any MediaCenter)? = nil,
        hearts: (any Hearts)? = nil,
        images: ImageLoader? = nil,
        motion: MotionCovers? = nil,
        widget: WidgetFeed? = nil,
        follows: Bool = true,
        settings: @escaping @MainActor () -> UserSettings.Playback = { UserSettings.Playback() },
        quality: @escaping @MainActor () -> StreamQuality = { .auto },
        notify: @escaping @MainActor (String) -> Void = { _ in },
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> Date = { Date() },
        random: @escaping () -> Double = { Double.random(in: 0..<1) }
    ) {
        self.source = source
        self.engine = engine
        self.media = media
        self.hearts = hearts
        self.images = images
        self.motion = motion
        self.widget = widget
        self.settings = settings
        self.quality = quality
        self.notify = notify
        self.sleep = sleep
        self.now = now
        self.random = random
        sync = follows ? QueueSync(source: source, sleep: sleep, now: now, notify: notify) : nil
        sync?.player = self
        engine.onEvent = { [weak self] event in self?.handle(event) }
        media?.onCommand = { [weak self] command in self?.handle(command) ?? false }
    }

    // MARK: - Playing from the library

    /// A new queue: `tracks` from `index`, started from `context` (with shuffle on, the rest of the
    /// list in a random order). Songs the user queued stay next.
    func play(_ tracks: [Track], at index: Int, context: PlayContext? = nil) async {
        guard tracks.indices.contains(index) else { return }
        list = (tracks, context)
        let q = QueueState.start(
            queue, tracks: tracks, index: index, source: context, provider: tracks[index].provider, shuffle: shuffled,
            random: random)
        await load(q, autoplay: true)?.value
    }

    /// Shuffle on, and the list from a random song.
    func shuffle(_ tracks: [Track], context: PlayContext? = nil) async {
        guard !tracks.isEmpty else { return }
        shuffled = true
        await play(tracks, at: min(tracks.count - 1, Int(random() * Double(tracks.count))), context: context)
    }

    /// Play Next: before anything already queued. `label` names them in the message (a song's title
    /// by default, an album's name from its menu).
    func playNext(_ tracks: [Track], label: String? = nil) {
        guard !tracks.isEmpty else { return }
        enqueue(queue.playingNext(tracks))
        notify("Playing “\(label ?? Self.label(tracks))” next")
    }

    /// Add to Queue: after everything already queued.
    func addToQueue(_ tracks: [Track], label: String? = nil) {
        guard !tracks.isEmpty else { return }
        enqueue(queue.addingToQueue(tracks))
        notify("Added “\(label ?? Self.label(tracks))” to the queue")
    }

    private static func label(_ tracks: [Track]) -> String {
        tracks.count == 1 ? tracks[0].title : "\(tracks.count) songs"
    }

    /// Queueing with nothing loaded cues the first queued song, paused, so there is something to play.
    private func enqueue(_ q: QueueState) {
        if q.now != nil {
            edit(q)
            return
        }
        guard var cued = q.advanced() else { return }
        cued.provider = cued.now?.provider ?? "navidrome"
        load(cued, autoplay: false)
    }

    // MARK: - The transport

    func toggle() {
        if isPlaying { pause() } else { resume() }
    }

    /// Plays on from where it is (from the start after the last song ended).
    func resume() {
        guard let track, !isPlaying else { return }
        if status == .ended {
            load(queue, autoplay: true, startAt: 0, fresh: false)
            return
        }
        let at = time(at: now())
        // A URL that would run out before the song ends (paused for hours) is fetched again.
        guard let loaded, loaded.key == track.key, lasts(loaded, for: duration - at) else {
            load(queue, autoplay: true, startAt: at, fresh: false)
            return
        }
        status = .buffering
        pausedBySystemAt = nil
        setPosition(at)
        refreshPreloadIfStale()
        engine.play()
        publish()
        sync?.later()
    }

    func pause() {
        guard isPlaying else { return }
        let at = time(at: now())
        status = .paused
        setPosition(at)
        engine.pause()
        publish()
        sync?.later()
    }

    /// The next song: Next up, then the context, then (repeat-all) the list again.
    func next() {
        guard let next = queue.advanced() ?? (repeatMode == .all ? wrap() : nil) else { return }
        load(next, autoplay: isPlaying)
    }

    /// Past 3 s the song starts again; before that, the song before it.
    func previous() {
        guard track != nil else { return }
        if time(at: now()) > Self.restartAfter {
            seek(to: 0)
        } else if let back = queue.back() {
            load(back, autoplay: isPlaying)
        } else {
            seek(to: 0)
        }
    }

    func seek(to seconds: Double) {
        guard track != nil else { return }
        let total = duration
        let to = total > 0 ? min(max(0, seconds), total) : max(0, seconds)
        if status == .ended { status = .paused }
        setPosition(to)
        if loaded != nil { engine.seek(to: to) }
        // From the new position, or the hand-over has a gap.
        schedulePreload()
        publish()
        sync?.later()
    }

    func setVolume(_ value: Float) {
        volume = min(1, max(0, value))
        engine.volume = volume
    }

    func toggleShuffle() {
        shuffled.toggle()
        edit(queue.shuffling(shuffled, random: random))
    }

    /// Off, all, one, off.
    func cycleRepeat() {
        switch repeatMode {
        case .off: repeatMode = .all
        case .all: repeatMode = .one
        case .one: repeatMode = .off
        }
        // Repeat-one buffers nothing next: the engine would move on to it.
        schedulePreload()
        publishControls()
    }

    // MARK: - The queue (Now Playing's Up next)

    /// Plays an upcoming song now (`index` into `upcoming`), skipping the ones before it.
    func jump(to index: Int) {
        guard let next = queue.jumped(to: index) else { return }
        load(next, autoplay: true)
    }

    func move(from: Int, to: Int) {
        edit(queue.moving(from: from, to: to))
    }

    func remove(at index: Int) {
        edit(queue.removing(at: index))
    }

    /// A list's move (SwiftUI's onMove: the rows' offsets in their part, and the offset they go
    /// before), one song at a time.
    func move(_ part: Part, fromOffsets: IndexSet, toOffset: Int) {
        guard let from = fromOffsets.first else { return }
        let base = part == .nextUp ? 0 : queue.nextUp.count
        move(from: base + from, to: base + (toOffset > from ? toOffset - 1 : toOffset))
    }

    func remove(_ part: Part, atOffsets: IndexSet) {
        let base = part == .nextUp ? 0 : queue.nextUp.count
        var q = queue
        for offset in atOffsets.sorted(by: >) { q = q.removing(at: base + offset) }
        edit(q)
    }

    /// Everything after the song playing goes; it keeps playing.
    func clearUpcoming() {
        edit(queue.clearingUpcoming())
    }

    /// A queue another device saved (or this one, last time), cued paused at its position.
    func restore(_ saved: QueueState, positionMs: Double) {
        guard saved.now != nil else { return }
        list = nil
        shuffled = saved.shuffleOrder != nil
        var q = saved
        q.provider = q.provider ?? "navidrome"
        load(q, autoplay: false, startAt: max(0, positionMs / 1000))
        // Read just now: there is nothing to save.
        sync?.cancelPending()
    }

    /// A queue cued paused at `position` (the preview, which never streams).
    func cue(_ q: QueueState, at position: Double) {
        let tracks = (q.now.map { [$0] } ?? []) + q.context
        list = tracks.isEmpty ? nil : (tracks, q.contextSource)
        load(q, autoplay: false, startAt: position)
    }

    // MARK: - Signing in and out

    /// Signed in: the saved queue comes back (QueueSync).
    func signedIn() async {
        await sync?.start()
    }

    /// Leaving the app: a save that waits goes now.
    func flushQueue() async {
        await sync?.flush()
    }

    /// Everything stops and the queue empties (signing out); nothing is saved after.
    func stop() {
        sync?.stop()
        generation &+= 1
        cancelTasks()
        stopEngine()
        queue = QueueState()
        list = nil
        status = .idle
        shuffled = false
        repeatMode = .off
        error = nil
        engineDuration = nil
        artwork = nil
        artworkKey = nil
        // The downloaded motion covers go too, as the library's covers do, and the widget's song.
        motion?.clear()
        setPosition(0)
        media?.publish(nil, playing: false)
        widget?.clear()
    }

    /// The lock screen's loop speed changed in Settings: its cover is asked for at the new length.
    func lockScreenChanged() {
        publish()
    }

    // MARK: - Controls from outside the app

    /// A button on the home-screen widget (its App Intent, run in this process). With nothing in the
    /// queue (the app was started for it, in the background) the saved queue is read first
    /// (QueueSync), so Play plays on from where the widget showed; given up on after 8 s (no
    /// network: the button does nothing).
    func perform(_ command: WidgetCommand) async {
        if track == nil, let sync {
            let limit = Self.restoreLimit
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await sync.start() }
                group.addTask { try? await Task.sleep(for: limit) }
                _ = await group.next()
                group.cancelAll()
            }
        }
        switch command {
        case .toggle: handle(.toggle)
        case .next: handle(.next)
        case .previous: handle(.previous)
        }
        // Until the song plays (or cannot), so the app is not suspended before the music starts.
        let deadline = ContinuousClock.now + Self.restoreLimit
        while status == .loading, ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    /// A control from the lock screen, Control Center, headphones, the Mac's media keys or its Now
    /// Playing; false when there is nothing to do it to.
    @discardableResult
    func handle(_ command: RemoteCommand) -> Bool {
        guard let track else { return false }
        switch command {
        case .play: resume()
        case .pause: pause()
        case .toggle: toggle()
        case .next: next()
        case .previous: previous()
        case .seek(let seconds): seek(to: seconds)
        case .like:
            guard let hearts else { return false }
            let liked = hearts.isLiked(track)
            Task {
                await hearts.setLiked(track, !liked)
                self.publishControls()
            }
        }
        return true
    }

    // MARK: - Loading songs

    /// `q` becomes the queue and its song loads: playing (fetching its stream URL first) or cued
    /// paused at `startAt` (nothing fetched until Play). `fresh` is a new play of a song: retries
    /// and scrobbles start over (not for the same play asked for again).
    @discardableResult
    private func load(_ q: QueueState, autoplay: Bool, startAt: Double = 0, fresh: Bool = true) -> Task<Void, Never>? {
        let wasPlaying = status == .playing
        queue = q
        generation &+= 1
        let generation = self.generation
        cancelTasks()
        if fresh {
            retries = 0
            scrobbles = Scrobbles()
        }
        error = nil
        engineDuration = nil
        setPosition(startAt)
        sync?.later()
        guard let song = q.now else {
            stopEngine()
            status = .idle
            publish()
            return nil
        }
        if !autoplay {
            stopEngine()
            status = .paused
            publish()
            return nil
        }
        // The next song is buffered already: the engine hands over at once (an instant Next).
        if startAt == 0, let ready = preloaded, ready.key == song.key, loaded != nil {
            status = wasPlaying ? .playing : .loading
            preloaded = nil
            loaded = ready
            engine.load(ready, at: 0, play: true)
            schedulePreload()
            publish()
            return nil
        }
        // What played stops now, not when the new URL comes (and says nothing meanwhile).
        stopEngine()
        status = .loading
        publish()
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                let item = try await self.item(for: song)
                guard generation == self.generation else { return }
                self.loaded = item
                self.preloaded = nil
                // Paused while the URL came: it loads paused.
                self.engine.load(item, at: self.position, play: self.status == .loading)
                self.schedulePreload()
            } catch {
                guard generation == self.generation, !(error is CancellationError) else { return }
                self.couldNotLoad(error)
            }
        }
        loadTask = task
        return task
    }

    /// A song as the engine plays it: its signed stream URL and its ReplayGain.
    private func item(for track: Track) async throws -> EngineItem {
        let stream = try await source.streamURL(for: track, quality: quality())
        let gain = ReplayGain.volume(
            track.replayGain, mode: settings().replayGain, inAlbum: queue.contextSource?.kind == "album")
        return EngineItem(key: track.key, url: stream.url, gain: gain, expiresAt: stream.expiresAt)
    }

    /// Whether a signed URL still works for `seconds` more of the song (and the margin).
    private func lasts(_ item: EngineItem, for seconds: Double) -> Bool {
        item.expiresAt.timeIntervalSince(now()) >= max(0, seconds) + Self.urlMargin
    }

    private func couldNotLoad(_ error: Error) {
        let failure = error as? ApiError ?? .unreachable
        self.error = failure
        status = .failed
        publish()
        notify(failure.userMessage)
    }

    private func stopEngine() {
        engine.stop()
        loaded = nil
        preloaded = nil
    }

    private func cancelTasks() {
        loadTask?.cancel()
        preloadTask?.cancel()
        retryTask?.cancel()
        loadTask = nil
        preloadTask = nil
        retryTask = nil
    }

    /// The queue changed but not its song (an edit, Play Next, shuffle).
    private func edit(_ q: QueueState) {
        queue = q
        schedulePreload()
        publish()
        sync?.later()
    }

    /// Repeat-all: the list from its start again (reshuffled, with shuffle on).
    private func wrap() -> QueueState? {
        guard let list, !list.tracks.isEmpty else { return nil }
        let start = shuffled ? min(list.tracks.count - 1, Int(random() * Double(list.tracks.count))) : 0
        return QueueState.start(
            queue, tracks: list.tracks, index: start, source: list.context, provider: list.tracks[0].provider,
            shuffle: shuffled, random: random)
    }

    // MARK: - Buffering the next song

    /// The next song is buffered 5 s into this one, or 20 s before it ends when it is shorter, for a
    /// gapless hand-over; a different next song (an edit, Play Next, shuffle) is buffered in its turn.
    private func schedulePreload() {
        preloadTask?.cancel()
        preloadTask = nil
        let next = repeatMode == .one ? nil : upcoming.first
        if let preloaded, preloaded.key != next?.key {
            self.preloaded = nil
            engine.preload(nil)
        }
        guard let current = track, let next, loaded != nil, preloaded == nil else { return }
        let delay = min(Self.preloadAfter, max(0, duration - time(at: now()) - Self.preloadBeforeEnd))
        let generation = self.generation
        preloadTask = Task { [weak self] in
            guard let self else { return }
            try? await self.sleep(.milliseconds(Int(delay * 1000)))
            guard !Task.isCancelled, generation == self.generation, self.track?.key == current.key,
                  self.upcoming.first?.key == next.key, self.repeatMode != .one
            else { return }
            guard let item = try? await self.item(for: next) else { return }
            guard generation == self.generation, self.upcoming.first?.key == next.key, self.loaded != nil else { return }
            self.preloaded = item
            self.engine.preload(item)
        }
    }

    /// Resuming after a long pause: a buffered next song whose URL would run out before it ends is
    /// buffered again.
    private func refreshPreloadIfStale() {
        guard let preloaded, let next = upcoming.first, next.key == preloaded.key else { return }
        let ahead = duration - time(at: now()) + Double(next.durationMs) / 1000
        if !lasts(preloaded, for: ahead) {
            self.preloaded = nil
            engine.preload(nil)
            schedulePreload()
        }
    }

    // MARK: - What the engine says

    private func handle(_ event: EngineEvent) {
        switch event {
        case .status(let engineStatus): engineChanged(engineStatus)
        case .time(let seconds): ticked(seconds)
        case .duration(let seconds): engineDuration = seconds
        case .advanced(let key): handedOver(key)
        case .ended: ended()
        case .failed(let key): streamFailed(key)
        case .preloadFailed(let key): if preloaded?.key == key { preloaded = nil }
        case .interruptionBegan:
            let justPaused = pausedBySystemAt.map { now().timeIntervalSince($0) < 2 } ?? false
            resumeAfterInterruption = isPlaying || justPaused
            pause()
        case .interruptionEnded(let shouldResume):
            if shouldResume, resumeAfterInterruption { resume() }
            resumeAfterInterruption = false
        case .headphonesOut:
            // Out of the headphones the music stops (it never moves to the speaker by itself).
            resumeAfterInterruption = false
            pause()
        }
    }

    private func engineChanged(_ engineStatus: EngineStatus) {
        guard loaded != nil, track != nil else { return }
        let at = engine.currentTime ?? time(at: now())
        switch engineStatus {
        case .playing:
            status = .playing
            retries = 0
            pausedBySystemAt = nil
            setPosition(at)
            playing()
            publish()
        case .buffering:
            if status == .playing {
                status = .buffering
                setPosition(at)
                publish()
            }
        case .paused:
            // Paused by the system (an interruption, the headphones out, another app), not here.
            guard isPlaying, status != .loading else { return }
            status = .paused
            pausedBySystemAt = now()
            setPosition(at)
            publish()
            sync?.later()
        }
    }

    private func ticked(_ seconds: Double) {
        guard loaded != nil, track != nil else { return }
        let expected = time(at: now())
        setPosition(seconds)
        if status == .playing {
            playing()
            sync?.tick()
        }
        // A jump (a seek from elsewhere): the lock screen and the saved position follow.
        if abs(seconds - expected) > 2 {
            publish()
            sync?.later()
        }
    }

    /// The song plays: Navidrome's scrobbles and ECHO's history, as far as it has played.
    private func playing() {
        guard let track else { return }
        let at = time(at: now())
        if settings().scrobble {
            for submission in scrobbles.update(at: at, duration: duration) {
                let source = self.source
                Task { try? await source.scrobble(id: track.id, submission: submission) }
            }
        }
        if history.update(track: track, at: at, duration: duration) {
            let source = self.source
            let context = queue.contextSource
            Task { try? await source.recordPlay(track, context: context) }
        }
    }

    /// The engine went on to the song it had buffered, without a gap.
    private func handedOver(_ key: String) {
        guard let next = queue.advanced(), next.now?.key == key, let ready = preloaded, ready.key == key else {
            // The queue changed under the engine: play what is next now.
            loaded = nil
            preloaded = nil
            if let next = queue.advanced() ?? (repeatMode == .all ? wrap() : nil) {
                load(next, autoplay: true)
            } else {
                stopEngine()
                status = .ended
                publish()
            }
            return
        }
        queue = next
        generation &+= 1
        cancelTasks()
        retries = 0
        scrobbles = Scrobbles()
        engineDuration = nil
        loaded = ready
        preloaded = nil
        setPosition(0)
        schedulePreload()
        publish()
        sync?.later()
    }

    /// The song ended with nothing buffered: repeat it, play what is next, or stop on it.
    private func ended() {
        loaded = nil
        preloaded = nil
        if repeatMode == .one {
            load(queue, autoplay: true, startAt: 0, fresh: false)
        } else if let next = queue.advanced() ?? (repeatMode == .all ? wrap() : nil) {
            load(next, autoplay: true)
        } else {
            // The end of the queue: stopped on the last song.
            status = .ended
            setPosition(duration)
            publish()
            sync?.later()
        }
    }

    /// A broken stream is asked for again at its position (a fresh URL) up to 3 times, 0.5, 1 and
    /// 2 s apart; then it is skipped, saying so, or with nothing after it, what failed is said.
    private func streamFailed(_ key: String) {
        guard key == track?.key else { return }
        loaded = nil
        preloaded = nil
        let at = time(at: now())
        let play = isPlaying
        if retries < Self.streamRetries {
            let wait = 0.5 * pow(2, Double(retries))
            retries += 1
            let generation = self.generation
            retryTask = Task { [weak self] in
                try? await self?.sleep(.milliseconds(Int(wait * 1000)))
                guard let self, !Task.isCancelled, generation == self.generation else { return }
                self.load(self.queue, autoplay: play, startAt: at, fresh: false)
            }
            return
        }
        if let next = queue.advanced() {
            notify(Self.skipped)
            load(next, autoplay: true)
        } else {
            status = .failed
            error = .navidrome(code: "navidrome.stream", message: Self.unplayable)
            publish()
            notify(Self.unplayable)
        }
    }

    // MARK: - The lock screen and Control Center

    private func setPosition(_ seconds: Double) {
        position = seconds
        positionAt = now()
    }

    /// Tells the system what plays (NowPlayingInfo.build) and the iPhone's widget the same (WidgetFeed,
    /// from the same values at the same moment, so the widget, the lock screen and Control Center
    /// never disagree), and loads the cover for them once; on the iPhone the album's animated cover
    /// is asked for too, and told once it is downloaded.
    private func publish() {
        guard media != nil || widget != nil else { return }
        guard let track else {
            motion?.want(nil) {}
            media?.publish(nil, playing: false)
            widget?.showNothing()
            return
        }
        let cover = artwork?.key == track.key ? artwork?.image : nil
        let at = now()
        let elapsed = time(at: at)
        let total = duration
        media?.publish(
            NowPlayingInfo.build(
                track: track, elapsed: elapsed, duration: total, playing: status == .playing,
                index: queue.history.count, count: queue.history.count + 1 + upcoming.count, artwork: cover,
                animated: motion?.cover(for: track)),
            playing: isPlaying)
        widget?.show(
            track: track, elapsed: elapsed, at: at, duration: total, playing: isPlaying, advancing: status == .playing,
            artwork: cover)
        publishControls()
        motion?.want(track) { [weak self] in self?.publish() }
        guard cover == nil, artworkKey != track.key, let path = track.cover, let images else { return }
        artworkKey = track.key
        let key = track.key
        Task { [weak self] in
            guard let image = await images.image(path), let self, self.track?.key == key else { return }
            self.artwork = (key, image.cgImage)
            self.publish()
        }
    }

    private func publishControls() {
        guard let media else { return }
        media.update(liked: track.map { hearts?.isLiked($0) ?? false } ?? false, canGoNext: hasNext)
    }
}

/// Liked Songs as the player sees them: the heart on the lock screen and Now Playing.
@MainActor
protocol Hearts: AnyObject {
    func isLiked(_ track: Track) -> Bool
    func setLiked(_ track: Track, _ on: Bool) async
}

extension Library: Hearts {}
