import Foundation

// The queue as every ECHO client keeps and saves it (`QueueState` in src/shared/types.ts), with the
// web's operations on it (src/client/playback/queue.ts, PLAYBACK_ARCHITECTURE.md §6), so a queue
// saved here plays on the web and on Android and the other way round (`/me/queue`, QueueSync).
// `context` always keeps the source's order; with shuffle on, `shuffleOrder` lists context indices
// in play order. So shuffle touches the context only, `nextUp` keeps its order, and turning shuffle
// off brings the original order back.

struct QueueState: Equatable, Sendable {
    /// Whose songs these are ("navidrome": the Apple apps play the user's Navidrome only).
    var provider: String? = nil
    var now: Track? = nil
    /// Songs the user added: Play Next puts them first, Add to Queue last.
    var nextUp: [Track] = []
    /// The rest of the album, playlist or list being played, in its own order.
    var context: [Track] = []
    /// Where the context came from.
    var contextSource: PlayContext? = nil
    /// What played before, for Previous (the last 50).
    var history: [Track] = []
    /// With shuffle on: the context's indices in the order they play.
    var shuffleOrder: [Int]? = nil

    static let historyMax = 50
    /// What a saved queue keeps of the history.
    static let savedHistory = 20
    /// Request bodies are capped at 64 KB (SETTINGS_AND_SECURITY.md §5.6).
    static let maxBytes = 60_000

    /// The context in play order.
    var orderedContext: [Track] {
        guard let shuffleOrder else { return context }
        return shuffleOrder.compactMap { context.indices.contains($0) ? context[$0] : nil }
    }

    /// Everything that plays after `now`, in order.
    var upcoming: [Track] { nextUp + orderedContext }

    // MARK: - Starting

    /// Plays `tracks` from `index` (an album, a playlist, a list of results). With shuffle the rest
    /// of the list plays in a random order; otherwise the songs after `index` follow. `nextUp` stays.
    static func start(
        _ q: QueueState, tracks: [Track], index: Int, source: PlayContext?, provider: String, shuffle: Bool,
        random: () -> Double
    ) -> QueueState {
        let now = tracks.indices.contains(index) ? tracks[index] : nil
        let context = shuffle
            ? tracks.enumerated().filter { $0.offset != index }.map(\.element)
            : Array(tracks.dropFirst(index + 1))
        return QueueState(
            provider: provider, now: now, nextUp: q.provider == provider ? q.nextUp : [], context: context,
            contextSource: source, history: pushHistory(q.history, q.now),
            shuffleOrder: shuffle ? permutation(context.count, random) : nil)
    }

    // MARK: - Moving through it

    /// Next up first, then the context (in shuffle order); nil when nothing is left.
    func advanced() -> QueueState? {
        let history = Self.pushHistory(self.history, now)
        if let first = nextUp.first {
            var q = self
            q.now = first
            q.nextUp.removeFirst()
            q.history = history
            return q
        }
        let at: Int? = shuffleOrder.map { $0.first } ?? 0
        guard let at, context.indices.contains(at) else { return nil }
        var q = without([at])
        q.now = context[at]
        q.history = history
        return q
    }

    /// The song before, from the history; the current one goes back to the front of what plays next.
    func back() -> QueueState? {
        guard let previous = history.last else { return nil }
        var q = self
        q.now = previous
        q.history.removeLast()
        // Queued songs play before the context, so with any left the current one goes before them:
        // Previous then Next always comes back to it.
        if let now, !nextUp.isEmpty {
            q.nextUp = [now] + nextUp
            return q
        }
        q.context = (now.map { [$0] } ?? []) + context
        if let shuffleOrder {
            q.shuffleOrder = now == nil ? shuffleOrder : [0] + shuffleOrder.map { $0 + 1 }
        }
        return q
    }

    /// Plays an upcoming song now (`index` into `upcoming`); the ones before it are skipped: they
    /// leave the queue and do not go into the history.
    func jumped(to index: Int) -> QueueState? {
        guard index >= 0 else { return nil }
        let history = Self.pushHistory(self.history, now)
        if index < nextUp.count {
            var q = self
            q.now = nextUp[index]
            q.nextUp = Array(nextUp.dropFirst(index + 1))
            q.history = history
            return q
        }
        let p = index - nextUp.count
        let order = shuffleOrder ?? Array(context.indices)
        guard order.indices.contains(p), context.indices.contains(order[p]) else { return nil }
        var q = without(Set(order.prefix(p + 1)))
        q.now = context[order[p]]
        q.nextUp = []
        q.history = history
        return q
    }

    // MARK: - Editing

    /// Play Next: before anything already queued, in their order.
    func playingNext(_ tracks: [Track]) -> QueueState {
        var q = self
        q.nextUp = tracks + nextUp
        return q
    }

    /// Add to Queue: after everything already queued.
    func addingToQueue(_ tracks: [Track]) -> QueueState {
        var q = self
        q.nextUp += tracks
        return q
    }

    func shuffling(_ on: Bool, random: () -> Double) -> QueueState {
        var q = self
        q.shuffleOrder = on ? Self.permutation(context.count, random) : nil
        return q
    }

    /// Removes the upcoming song at `index` (its place in `upcoming`), from either part.
    func removing(at index: Int) -> QueueState {
        guard index >= 0 else { return self }
        if index < nextUp.count {
            var q = self
            q.nextUp.remove(at: index)
            return q
        }
        let order = shuffleOrder ?? Array(context.indices)
        let p = index - nextUp.count
        guard order.indices.contains(p) else { return self }
        return without([order[p]])
    }

    /// Moves an upcoming song from `from` to `to` (places in `upcoming`), so what plays is exactly
    /// the order shown. A song that lands among Next up becomes one of them; one that lands in the
    /// album or playlist part joins it (in shuffle order when shuffle is on, so turning shuffle off
    /// still brings back the list's own order around it).
    func moving(from: Int, to: Int) -> QueueState {
        let up = upcoming
        guard up.indices.contains(from), from != to, up.indices.contains(to) else { return self }
        let track = up[from]
        let n = nextUp.count
        // Within the shuffled album part only the play order changes; the album keeps its own.
        if var order = shuffleOrder, from >= n, to >= n {
            let moved = order.remove(at: from - n)
            order.insert(moved, at: to - n)
            var q = self
            q.shuffleOrder = order
            return q
        }
        var r = removing(at: from)
        if to < r.nextUp.count || (to == r.nextUp.count && from < n && to < n) {
            r.nextUp.insert(track, at: to)
            return r
        }
        let p = min(to - r.nextUp.count, r.context.count)
        if var order = r.shuffleOrder {
            r.context.append(track)
            order.insert(r.context.count - 1, at: min(p, order.count))
            r.shuffleOrder = order
            return r
        }
        r.context.insert(track, at: p)
        return r
    }

    /// Everything upcoming goes; what plays now keeps playing.
    func clearingUpcoming() -> QueueState {
        var q = self
        q.nextUp = []
        q.context = []
        q.shuffleOrder = nil
        return q
    }

    // MARK: - Saving

    /// The queue as it is saved: the history's last 20, then cut until it fits the server's limit
    /// (the far end of the context first, then of Next up), as the web trims it.
    func trimmed(maxBytes: Int = QueueState.maxBytes) -> QueueState {
        var out = self
        out.history = Array(history.suffix(Self.savedHistory))
        func size() -> Int { (try? JSONEncoder().encode(out))?.count ?? 0 }
        while size() > maxBytes, !out.context.isEmpty {
            // Shuffle positions point into the context; they no longer fit once it is cut.
            out.shuffleOrder = nil
            out.context = Array(out.context.prefix(out.context.count / 2))
        }
        while size() > maxBytes, !out.nextUp.isEmpty {
            out.nextUp = Array(out.nextUp.prefix(out.nextUp.count / 2))
        }
        return out
    }

    /// What this player can play of a saved queue: the user's Navidrome songs. A queue of another
    /// provider's (Spotify's, as Android checks) is not restored; a YouTube song (the web keeps a
    /// queue with any still to play in its own slot, but one may linger) is left out.
    var playable: QueueState? {
        if let provider, provider != "navidrome" { return nil }
        if let now, now.provider != "navidrome" { return nil }
        let ours = { (t: Track) in t.provider == "navidrome" }
        var q = self
        q.provider = "navidrome"
        q.nextUp = nextUp.filter(ours)
        q.history = history.filter(ours)
        let context = self.context.filter(ours)
        if context.count != self.context.count {
            q.context = context
            q.shuffleOrder = nil
        }
        return q
    }

    // MARK: - Helpers

    private static func pushHistory(_ history: [Track], _ track: Track?) -> [Track] {
        guard let track else { return history }
        return Array((history + [track]).suffix(historyMax))
    }

    /// The queue without these context entries, its shuffle order kept consistent.
    private func without(_ drop: Set<Int>) -> QueueState {
        var q = self
        q.context = context.enumerated().filter { !drop.contains($0.offset) }.map(\.element)
        if let shuffleOrder {
            // The new index of old index i: i less the dropped indices below it.
            q.shuffleOrder = shuffleOrder.filter { !drop.contains($0) }.map { i in i - drop.filter { $0 < i }.count }
        }
        return q
    }

    /// A random order of 0..<n (Fisher–Yates, as the web's).
    static func permutation(_ n: Int, _ random: () -> Double) -> [Int] {
        var order = Array(0..<max(0, n))
        var i = n - 1
        while i > 0 {
            let j = min(i, Int(random() * Double(i + 1)))
            order.swapAt(i, j)
            i -= 1
        }
        return order
    }
}

// MARK: - As the clients save it

extension QueueState: Codable {
    enum CodingKeys: String, CodingKey {
        case provider, now, nextUp, context, contextSource, history, shuffleOrder
    }

    /// A queue as another client saved it: what it left out because it was empty or the default
    /// (Android omits `nextUp: []` and its songs' `provider`) takes its default, as the web's
    /// savedQueue does; a song that cannot be read is left out, not the whole queue.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if c.contains(.provider), (try? c.decodeNil(forKey: .provider)) == true {
            provider = nil
        } else {
            provider = (try? c.decodeIfPresent(String.self, forKey: .provider)) ?? "navidrome"
        }
        now = try? c.decodeIfPresent(Track.self, forKey: .now)
        nextUp = (try? c.decodeIfPresent(LossyList<Track>.self, forKey: .nextUp))?.items ?? []
        context = (try? c.decodeIfPresent(LossyList<Track>.self, forKey: .context))?.items ?? []
        contextSource = try? c.decodeIfPresent(PlayContext.self, forKey: .contextSource)
        history = (try? c.decodeIfPresent(LossyList<Track>.self, forKey: .history))?.items ?? []
        // Only an order of exactly the context's indices is one.
        let order = try? c.decodeIfPresent([Int].self, forKey: .shuffleOrder)
        shuffleOrder = order.flatMap { $0.sorted() == Array(context.indices) ? $0 : nil }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        // The web's shape: `provider` and `now` are always there, null when empty.
        try c.encode(provider, forKey: .provider)
        try c.encode(now, forKey: .now)
        try c.encode(nextUp, forKey: .nextUp)
        try c.encode(context, forKey: .context)
        try c.encodeIfPresent(contextSource, forKey: .contextSource)
        try c.encode(history, forKey: .history)
        try c.encodeIfPresent(shuffleOrder, forKey: .shuffleOrder)
    }
}
