import Foundation

/// The queue that follows the user (the web's src/client/playback/queueSync.ts, Android's
/// Playback.kt): read at sign-in and played from where it was (paused) unless something plays
/// already; saved 2 s after it changes (a song, an edit, play, pause, a seek) and every 15 s while
/// playing, over the version last read. A newer queue from another device refuses the save: the
/// device that is playing keeps its own (and wins on its next save); one that is not takes the newer.
@MainActor
final class QueueSync {
    static let debounce: Duration = .seconds(2)
    static let every: TimeInterval = 15
    /// An unreachable server (a restart) is asked again this far apart at most (1, 2, 4 … s).
    static let backoffMax: Double = 30
    static let changedElsewhere = "Your queue changed on another device."

    /// The `updatedAt` of the queue last read or saved: what a save is based on.
    private(set) var base = 0
    /// The saved queue was read: changes are saved from now on (never before, so a queue another
    /// device saved is not written over unread).
    private(set) var following = false
    /// A Listen together session plays instead of the user's queue: nothing is saved meanwhile
    /// (Player.beganSession), so `/me/queue` stays what the user made.
    private(set) var held = false

    weak var player: Player?
    private let source: any PlaybackSource
    private let sleep: @Sendable (Duration) async throws -> Void
    private let now: () -> Date
    private let notify: @MainActor (String) -> Void
    private var pending: Task<Void, Never>?
    private var lastPeriodic: Date?
    private var saving = false
    private var again = false
    private var session = 0

    init(
        source: any PlaybackSource, sleep: @escaping @Sendable (Duration) async throws -> Void,
        now: @escaping () -> Date, notify: @escaping @MainActor (String) -> Void
    ) {
        self.source = source
        self.sleep = sleep
        self.now = now
        self.notify = notify
    }

    /// Signed in: the saved queue is read (and played from, paused, when nothing plays). An
    /// unreachable server is asked again, 1, 2, 4 … 30 s apart; the API budget's 429 is waited out
    /// by the client (Retry-After, a few times); a refusal that remains (signed out, the budget still
    /// spent) means the queue does not follow this session.
    func start() async {
        stop()
        session += 1
        let session = self.session
        var wait = 1.0
        while !Task.isCancelled, session == self.session {
            do {
                let saved = try await source.savedQueue()
                guard !Task.isCancelled, session == self.session else { return }
                base = saved.updatedAt
                following = true
                if player?.track == nil, let queue = saved.queue?.playable, queue.now != nil {
                    player?.restore(queue, positionMs: saved.positionMs)
                } else if player?.track != nil {
                    // Something started playing while the queue was read: it is saved now.
                    later()
                }
                return
            } catch let error as ApiError {
                switch error {
                case .offline, .unreachable: break
                case .server(let status, _) where status >= 500: break
                default: return
                }
            } catch {
                return
            }
            try? await sleep(.milliseconds(Int(wait * 1000)))
            wait = min(Self.backoffMax, wait * 2)
        }
    }

    /// Signed out: nothing is saved any more, so whoever signs in next does not get this queue.
    func stop() {
        session += 1
        following = false
        base = 0
        lastPeriodic = nil
        pending?.cancel()
        pending = nil
    }

    /// A session begins (true: nothing is saved, and a save that waits is dropped) or ends.
    func hold(_ on: Bool) {
        held = on
        if on { cancelPending() }
    }

    /// Something changed: saved 2 s from now, once however many changes come meanwhile.
    func later() {
        guard following, !held else { return }
        pending?.cancel()
        pending = Task { [weak self] in
            guard let self else { return }
            try? await self.sleep(Self.debounce)
            guard !Task.isCancelled, self.following, !self.held else { return }
            // A save under way is not cancelled by the next change: it would leave its `updatedAt`
            // unread and the next save refused.
            self.pending = nil
            await self.save()
        }
    }

    /// Forgets a save that waits (the queue just read needs none).
    func cancelPending() {
        pending?.cancel()
        pending = nil
    }

    /// While playing, a save every 15 s (the position moves on).
    func tick() {
        guard following, !held else { return }
        let date = now()
        guard let last = lastPeriodic else {
            lastPeriodic = date
            return
        }
        if date.timeIntervalSince(last) >= Self.every {
            lastPeriodic = date
            later()
        }
    }

    /// Leaving the app: a save that waits goes now.
    func flush() async {
        guard following, !held, pending != nil else { return }
        cancelPending()
        await save()
    }

    /// Saves the queue now; one at a time, so each is based on the `updatedAt` the last one got.
    func save() async {
        if saving {
            again = true
            return
        }
        saving = true
        defer { saving = false }
        repeat {
            again = false
            await saveOnce()
        } while again && following
    }

    private func saveOnce() async {
        guard following, !held, let player else { return }
        let session = self.session
        let playing = player.isPlaying
        var queue = player.queue
        queue.provider = "navidrome"
        let positionMs = player.time(at: now()) * 1000
        do {
            let updated = try await source.saveQueue(queue.trimmed(), positionMs: positionMs, base: base)
            guard session == self.session else { return }
            base = updated
        } catch ApiError.server(409, _) {
            guard session == self.session else { return }
            notify(Self.changedElsewhere)
            guard let newer = try? await source.savedQueue(), session == self.session else { return }
            base = newer.updatedAt
            // The device that is playing keeps its queue (and wins on its next save).
            if !playing, let queue = newer.queue?.playable, queue.now != nil {
                player.restore(queue, positionMs: newer.positionMs)
            }
        } catch {
            // Offline or refused: the next change or the next 15 s try again.
        }
    }
}
