import Foundation
import Observation

/// Listen together on the iPhone and the Mac (docs/TOGETHER.md; the web's src/client/together and
/// Android's together/Together.kt): join a session from its QR code or link, or start one from Now
/// Playing. While in one, this player follows the session's song and position (TogetherPlan, twice a
/// second) and its controls go to the session (PlayerRemote): the host's transport drives everyone, a
/// member adds songs and is told that only the host controls playback. Updates arrive as Server-Sent
/// Events (reconnecting with a growing wait), with polling as a safety net and for the clock.
///
/// The personal queue is the user's own: while a session plays, nothing is saved to `/me/queue`
/// (Player.beganSession), and leaving puts the queue from before back, paused (as the web does).
@MainActor @Observable
final class Together {
    static let hostOnly = TogetherText.hostOnly
    /// An unreachable stream is asked again 1, 2, 4 … this many seconds apart.
    static let backoffMax = 30.0
    static let tick: Duration = .milliseconds(500)
    static let pollWithStream: Duration = .seconds(5)
    static let pollWithout: Duration = .seconds(1)

    /// The session this person is in.
    private(set) var session: TogetherState?
    /// A scanned code or an opened link, before joining.
    private(set) var offer: TogetherOffer?
    private(set) var joining = false
    private(set) var starting = false
    /// Why starting or joining did not go, for the sheet.
    private(set) var note: String?
    /// Whether the event stream is open (the sheet says "Reconnecting…" when it is not).
    private(set) var connected = false

    /// Now Playing's Together sheet (the Mac's popover).
    var sheetOpen = false
    /// The camera for a Listen together code (the iPhone).
    var scanning = false
    /// The invite, full-screen (the iPhone) or in its own sheet (the Mac).
    var inviteOpen = false
    /// The listeners, in their own sheet.
    var membersOpen = false
    /// Now Playing is open: it shows the sheets (a sheet cannot open under a full-screen cover).
    var nowPlayingShown = false

    @ObservationIgnored weak var player: Player?
    @ObservationIgnored private let source: (any TogetherSource)?
    @ObservationIgnored private let server: URL
    @ObservationIgnored private let notify: @MainActor (String) -> Void
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let loops: Bool
    @ObservationIgnored private var clock = ClockSync()
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var settleUntil = 0.0
    @ObservationIgnored private var cue: (id: String, task: Task<Void, Never>)?
    @ObservationIgnored private var personal: Player.PersonalQueue?
    /// A link opened before signing in: offered once signed in.
    @ObservationIgnored private var pending: String?

    /// - Parameters:
    ///   - source: nil for the demo screens, which never reach the network.
    ///   - loops: whether following, the stream and polling run by themselves (the tests drive them).
    init(
        source: (any TogetherSource)?, player: Player, server: URL,
        notify: @escaping @MainActor (String) -> Void = { _ in },
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> Date = Date.init, loops: Bool = true
    ) {
        self.source = source
        self.player = player
        self.server = server
        self.notify = notify
        self.sleep = sleep
        self.now = now
        self.loops = loops
    }

    /// A screen in a given state, for the demo screens: nothing here reaches the network.
    static func demo(player: Player, server: URL, session: TogetherState? = nil, offer: TogetherOffer? = nil) -> Together {
        let together = Together(source: nil, player: player, server: server, loops: false)
        together.session = session
        together.offer = offer
        together.connected = session != nil
        return together
    }

    var isHost: Bool { session?.you.host == true }

    /// Now Playing's button: "Together", or "Together · 3" in a session.
    var label: String { session.map { "Together · \($0.listeners)" } ?? "Together" }

    /// The link the QR code holds, whole.
    var inviteLink: URL? { session?.link(origin: server) }

    private var nowMs: Double { now().timeIntervalSince1970 * 1000 }

    // MARK: - Joining

    /// A link opened before signing in is offered once signed in.
    func holdLink(_ id: String) {
        pending = id
    }

    /// Signed in: a link that waited is offered; else a session this person is already in (the app was
    /// started again) is joined again.
    func resume() async {
        if let id = pending {
            pending = nil
            await consider(id)
            return
        }
        guard session == nil, let source else { return }
        let sent = nowMs
        guard let state = try? await source.current() else { return }
        clock.request(serverTime: state.serverTime, sentAt: sent, receivedAt: nowMs)
        attach(state)
    }

    /// A scanned code or an opened link: say whose session it is, then Join.
    func consider(_ id: String) async {
        guard let source else { return }
        offer = .loading(id: id)
        do {
            let state = try await fetch(id, using: source)
            if state.you.member {
                attach(state)
            } else {
                offer = .ready(id: id, host: state.host.username, members: state.members.count)
            }
        } catch let error as TogetherError {
            switch error {
            case .otherLibrary(let host): offer = .otherLibrary(id: id, host: host ?? "The host")
            case .gone, .notMember: offer = .gone(id: id)
            default: offer = .failed(id: id, message: error.userMessage)
            }
        } catch {
            offer = .failed(id: id, message: ApiError.unreachable.userMessage)
        }
    }

    func dismissOffer() {
        offer = nil
    }

    /// Joins: this player follows the session from now on.
    func join(_ id: String) async {
        guard let source, !joining else { return }
        joining = true
        note = nil
        defer { joining = false }
        do {
            let sent = nowMs
            let state = try await source.join(id)
            clock.request(serverTime: state.serverTime, sentAt: sent, receivedAt: nowMs)
            attach(state)
            notify("Listening together with \(state.host.username)")
        } catch let error as TogetherError {
            if case .otherLibrary(let host) = error {
                offer = .otherLibrary(id: id, host: host ?? "The host")
            } else if error.endsSession {
                offer = .gone(id: id)
            } else {
                offer = .failed(id: id, message: error.userMessage)
            }
        } catch {
            offer = .failed(id: id, message: ApiError.unreachable.userMessage)
        }
    }

    // MARK: - Starting and leaving

    /// Starts a session on what plays here (and what is up next), and shows its invite.
    func start() async {
        guard session == nil else {
            sheetOpen = true
            return
        }
        guard let source, let player, !starting else { return }
        starting = true
        note = nil
        defer { starting = false }
        var seed = TogetherSeed()
        if let track = player.track, track.provider == "navidrome" {
            seed.track = TrackRef(track)
            seed.positionMs = player.time(at: now()) * 1000
            seed.playing = player.isPlaying
            seed.queue = player.upcoming.filter { $0.provider == "navidrome" }.prefix(TogetherSeed.queueMax).map { TrackRef($0) }
        }
        do {
            let sent = nowMs
            let state = try await source.start(seed)
            clock.request(serverTime: state.serverTime, sentAt: sent, receivedAt: nowMs)
            // The host's own player carries on where it was.
            settleUntil = nowMs + TogetherTiming.settle
            attach(state)
            inviteOpen = true
        } catch let error as TogetherError {
            note = error == .noLibrary ? error.userMessage : "Couldn't start listening together. \(error.userMessage)"
        } catch {
            note = "ECHO didn't answer. Try again."
        }
    }

    /// Leaves; the host's leaving ends it for everyone.
    func leave() async {
        guard let state = session else { return }
        if let source { _ = try? await source.leave(state.id) }
        detach(ended: state.you.host)
    }

    /// Signed out: no session follows the next account.
    func clear() {
        stopTasks()
        player?.remote = nil
        personal = nil
        session = nil
        offer = nil
        pending = nil
        connected = false
        sheetOpen = false
        inviteOpen = false
        membersOpen = false
        clock = ClockSync()
    }

    // MARK: - The shared queue and the host's transport

    func remove(_ item: TogetherItem) async {
        guard let state = session, let source else { return }
        do { apply(try await source.remove(state.id, uid: item.uid)) } catch { failed(error) }
    }

    /// Plays a queued song now (the host's).
    func jump(_ item: TogetherItem) {
        guard isHost else { return deny() }
        control(.jump(uid: item.uid))
    }

    /// The host's transport, as the player's controls send it.
    func perform(_ action: TogetherAction) async {
        guard let state = session, let source else { return }
        do { apply(try await source.control(state.id, action)) } catch { failed(error) }
    }

    private func control(_ action: TogetherAction) {
        Task { await perform(action) }
    }

    private func deny() {
        notify(Self.hostOnly)
    }

    /// Adds a song to the shared queue; the session it answers with, or nil (and what went wrong said).
    @discardableResult
    func share(_ track: Track, next: Bool) async -> TogetherState? {
        guard let state = session, let source else { return nil }
        guard track.provider == "navidrome" else {
            notify("Only songs from your library can be shared.")
            return nil
        }
        do {
            let answer = try await source.add(state.id, track: TrackRef(track), next: next)
            apply(answer)
            return answer
        } catch {
            failed(error)
            return nil
        }
    }

    private func failed(_ error: Error) {
        if error is CancellationError { return }
        guard let error = error as? TogetherError else {
            notify(ApiError.unreachable.userMessage)
            return
        }
        if error.endsSession {
            detach(ended: true)
        } else {
            notify(error.userMessage)
        }
    }

    private static func label(_ tracks: [Track]) -> String {
        tracks.count == 1 ? tracks[0].title : "\(tracks.count) songs"
    }

    // MARK: - The session's state

    private func fetch(_ id: String, using source: any TogetherSource) async throws -> TogetherState {
        let sent = nowMs
        let state = try await source.peek(id)
        clock.request(serverTime: state.serverTime, sentAt: sent, receivedAt: nowMs)
        return state
    }

    /// A newer state of the session this player is in (an older or another session's is dropped:
    /// answers and events can arrive out of order).
    func apply(_ state: TogetherState) {
        guard let current = session, current.id == state.id, state.version >= current.version else { return }
        session = state
        follow()
    }

    /// What one event says; true when the session ended.
    func handle(_ event: TogetherEvent, receivedAt: Double? = nil) async -> Bool {
        let received = receivedAt ?? nowMs
        switch event {
        case .state(let state):
            clock.pushed(serverTime: state.serverTime, receivedAt: received)
            apply(state)
        case .ping(let serverTime, let version):
            clock.pushed(serverTime: serverTime, receivedAt: received)
            // A change this player missed (the stream dropped a state): asked for.
            if let current = session, version > current.version { await refresh() }
        case .end:
            return true
        }
        return false
    }

    /// The state asked for again (a gap in the events).
    func refresh() async {
        guard let id = session?.id, let source else { return }
        do { apply(try await fetch(id, using: source)) } catch { failed(error) }
    }

    private func attach(_ state: TogetherState) {
        guard let player else { return }
        let changed = session?.id != state.id
        if changed {
            stopTasks()
            // Joining another session straight from one keeps the queue from before the first.
            if personal == nil { personal = player.beganSession() }
        }
        player.remote = self
        session = state
        offer = nil
        if changed, loops { startTasks(state.id) }
        follow()
    }

    private func detach(ended: Bool) {
        guard session != nil else { return }
        stopTasks()
        session = nil
        connected = false
        sheetOpen = false
        inviteOpen = false
        membersOpen = false
        player?.endedSession(restoring: personal)
        personal = nil
        notify(ended ? "The listening session ended." : "You left the listening session.")
    }

    private func stopTasks() {
        for task in tasks { task.cancel() }
        tasks = []
        cue?.task.cancel()
        cue = nil
        settleUntil = 0
    }

    private func startTasks(_ id: String) {
        tasks = [
            Task { await listen(id) },
            Task { await poll(id) },
            Task { await ticker() },
        ]
    }

    // MARK: - The event stream

    /// Reads the session's events, opening the stream again (1, 2, 4 … 30 s apart, or when the server
    /// says) when it closes or breaks; the first state it sends puts a gap right. Ends with the session.
    func listen(_ id: String) async {
        guard let source else { return }
        var wait = 1.0
        while !Task.isCancelled, session?.id == id {
            var heard = false
            do {
                for try await event in source.events(id) {
                    heard = true
                    connected = true
                    if await handle(event) {
                        detach(ended: true)
                        return
                    }
                    if Task.isCancelled || session?.id != id { return }
                }
            } catch let error as TogetherError {
                connected = false
                if error.endsSession {
                    detach(ended: true)
                    return
                }
                if case .rateLimited(let seconds) = error {
                    try? await sleep(.seconds(seconds))
                    continue
                }
            } catch {
                connected = false
            }
            connected = false
            guard !Task.isCancelled, session?.id == id else { return }
            if heard { wait = 1 }
            try? await sleep(.milliseconds(Int(wait * 1000)))
            wait = min(Self.backoffMax, wait * 2)
        }
    }

    /// The state asked for every 5 s (every second while the stream is down): the clock's round trips,
    /// and a missed change.
    private func poll(_ id: String) async {
        guard let source else { return }
        while !Task.isCancelled, session?.id == id {
            try? await sleep(connected ? Self.pollWithStream : Self.pollWithout)
            guard !Task.isCancelled, session?.id == id else { return }
            do {
                apply(try await fetch(id, using: source))
            } catch let error as TogetherError {
                if error.endsSession {
                    detach(ended: true)
                    return
                }
                if case .rateLimited(let seconds) = error { try? await sleep(.seconds(seconds)) }
            } catch {}
        }
    }

    private func ticker() async {
        while !Task.isCancelled, session != nil {
            try? await sleep(Self.tick)
            guard !Task.isCancelled else { return }
            follow()
        }
    }

    // MARK: - Following

    /// One step of following: the player is compared with the session and corrected.
    func follow() {
        guard let state = session, let player, !player.followHeld else { return }
        let ref = state.now?.track
        let date = now()
        let nowMs = date.timeIntervalSince1970 * 1000
        let duration = Double(ref?.durationMs ?? 0)
        let target = TogetherTarget(
            trackId: ref?.id, playing: state.playing,
            positionMs: ref == nil ? 0 : state.expectedPosition(at: clock.toServer(nowMs)), durationMs: duration)
        // A song cued to start when the session gets there is left to do so.
        if let cue, cue.id == target.trackId, target.playing { return }
        let playing = player.isPlaying
        let local = TogetherLocal(
            trackId: player.track.flatMap { $0.provider == "navidrome" ? $0.id : nil },
            active: playing,
            loading: player.status == .loading || player.status == .buffering,
            // What is heard: the audio's latency is taken off while it plays (Player.audibleTime).
            positionMs: (playing ? player.audibleTime : player.time(at: date)) * 1000)
        guard let step = TogetherPlan.step(target, local, settling: nowMs < settleUntil) else { return }
        settleUntil = nowMs + TogetherTiming.settle
        cue?.task.cancel()
        cue = nil
        // The engine's clock runs ahead of what is heard by the output's latency: a place is asked of
        // it that far on, so it is heard when the session gets there.
        let latency = player.outputLatency * 1000
        let context = PlayContext(kind: "together", id: state.id, title: "\(state.host.username)'s session")
        if let track = ref?.track, target.playing {
            switch step {
            case .load(let position, _), .seek(let position):
                let place = TogetherPlan.cue(positionMs: position, durationMs: duration)
                if case .load = step {
                    player.followLoad(track, at: (place.atMs + latency) / 1000, play: place.waitMs == 0, context: context)
                } else {
                    if place.waitMs > 0 { player.followPause() }
                    player.followSeek(to: (place.atMs + latency) / 1000)
                }
                if place.waitMs > 0 { cuePlay(track.id, after: place.waitMs) }
                settleUntil = nowMs + place.waitMs + TogetherTiming.settle
                return
            default: break
            }
        }
        switch step {
        case .load(let position, let play):
            if let track = ref?.track { player.followLoad(track, at: position / 1000, play: play, context: context) }
        case .seek(let position): player.followSeek(to: (position + latency) / 1000)
        case .play: player.followPlay()
        case .pause(let position):
            player.followPause()
            player.followSeek(to: position / 1000)
        case .stop: player.followPause()
        }
    }

    /// The cued song starts when the session gets to where it was cued.
    private func cuePlay(_ id: String, after wait: Double) {
        guard loops else {
            cue = (id, Task {})
            return
        }
        let task = Task { [weak self] in
            try? await self?.sleep(.milliseconds(Int(wait)))
            guard let self, !Task.isCancelled else { return }
            self.cue = nil
            if self.session?.now?.track.id == id, self.session?.playing == true, self.player?.followHeld == false {
                self.player?.followPlay()
            }
        }
        cue = (id, task)
    }

    /// Plays the cued song now (the wait is over): what `cuePlay` does after its sleep, for the tests.
    func cueElapsed() {
        guard let id = cue?.id else { return }
        cue?.task.cancel()
        cue = nil
        if session?.now?.track.id == id, session?.playing == true, player?.followHeld == false { player?.followPlay() }
    }
}

// MARK: - The player's controls, in a session

extension Together: PlayerRemote {
    var canGoNext: Bool {
        guard let session else { return false }
        return session.you.host ? !session.queue.isEmpty : true
    }

    /// The system paused the sound and the person plays on: following again (nothing is asked of
    /// the session). True when that was all.
    private func resumeHearing() -> Bool {
        guard let player, player.followHeld, session?.playing == true else { return false }
        player.releaseFollow()
        follow()
        return true
    }

    func togglePlaying() {
        guard let session else { return }
        if resumeHearing() { return }
        guard session.you.host else { return deny() }
        control(session.playing ? .pause : .play)
    }

    func setPlaying(_ on: Bool) {
        guard let session else { return }
        if on, resumeHearing() { return }
        guard session.you.host else { return deny() }
        if on != session.playing { control(on ? .play : .pause) }
    }

    func skipNext() {
        guard isHost else { return deny() }
        control(.next(from: nil))
    }

    func skipPrevious() {
        guard isHost else { return deny() }
        control(.previous)
    }

    func seek(to seconds: Double) {
        guard isHost else { return deny() }
        control(.seek(positionMs: max(0, seconds * 1000)))
    }

    func playNext(_ tracks: [Track], label: String?) {
        Task {
            // Each song goes first, so the last goes in first to keep their order.
            for track in tracks.prefix(50).reversed() {
                guard await share(track, next: true) != nil else { return }
            }
            notify("“\(label ?? Self.label(tracks))” plays next for everyone")
        }
    }

    func addToQueue(_ tracks: [Track], label: String?) {
        Task {
            for track in tracks.prefix(50) {
                guard await share(track, next: false) != nil else { return }
            }
            notify("Added “\(label ?? Self.label(tracks))” to the shared queue")
        }
    }

    func play(_ tracks: [Track], at index: Int) {
        guard tracks.indices.contains(index) else { return }
        let track = tracks[index]
        Task {
            guard let state = session else { return }
            if !state.you.host {
                if await share(track, next: false) != nil { notify("Added “\(track.title)” to the shared queue") }
                return
            }
            // Queued first, then played: the host's pick is what plays now.
            guard let after = await share(track, next: true) else { return }
            if let first = after.queue.first, first.track.id == track.id, after.now?.track.id != track.id {
                await perform(.jump(uid: first.uid))
            }
        }
    }

    func songEnded() {
        guard isHost, let uid = session?.now?.uid else { return }
        control(.next(from: uid))
    }
}
