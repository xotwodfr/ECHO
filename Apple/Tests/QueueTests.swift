import Foundation
import Testing

// The queue as the web keeps it (src/client/playback/queue.ts, queue.test.ts): starting a list,
// Next up before the context, the history for Previous, shuffle that keeps the list's own order,
// jumps, removals and moves in either part; as it is saved (trimmed to fit) and read back from
// another client (the web's shape, and Android's with what it leaves out).

@Suite("The queue")
struct QueueTests {
    private func ids(_ tracks: [Track]) -> [String] { tracks.map(\.id) }

    private func start(_ tracks: [Track], at index: Int, from q: QueueState = QueueState()) -> QueueState {
        QueueState.start(q, tracks: tracks, index: index, source: albumContext, provider: "navidrome", shuffle: false, random: { 0 })
    }

    @Test("A list plays from the song tapped, the rest after it; what the user queued stays next")
    func startList() {
        let q = start(songs(1...5), at: 1)
        #expect(q.now?.id == "al-1-t2")
        #expect(ids(q.context) == ["al-1-t3", "al-1-t4", "al-1-t5"])
        #expect(q.contextSource == albumContext)
        #expect(q.history.isEmpty)
        #expect(q.shuffleOrder == nil)
        let queued = q.addingToQueue([song(9, album: "al-3")])
        let again = start(songs(1...3, album: "al-2"), at: 0, from: queued)
        #expect(again.now?.id == "al-2-t1")
        #expect(ids(again.nextUp) == ["al-3-t9"])
        #expect(ids(again.history) == ["al-1-t2"])
    }

    @Test("Shuffled, the rest of the list plays in a random order that keeps the list's own")
    func startShuffled() {
        let random = SeededRandom(42)
        let q = QueueState.start(
            QueueState(), tracks: songs(1...6), index: 2, source: albumContext, provider: "navidrome", shuffle: true,
            random: { random.next() })
        #expect(q.now?.id == "al-1-t3")
        #expect(ids(q.context) == ["al-1-t1", "al-1-t2", "al-1-t4", "al-1-t5", "al-1-t6"])
        #expect(q.shuffleOrder?.sorted() == [0, 1, 2, 3, 4])
        #expect(Set(ids(q.orderedContext)) == Set(ids(q.context)))
        let off = q.shuffling(false, random: { 0 })
        #expect(off.shuffleOrder == nil)
        #expect(ids(off.upcoming) == ids(q.context))
    }

    @Test("Next up plays first, then the context; nothing is left at the end")
    func advance() throws {
        let q = start(songs(1...3), at: 0).playingNext([song(7, album: "al-2")])
        let a = try #require(q.advanced())
        #expect(a.now?.id == "al-2-t7")
        #expect(a.nextUp.isEmpty)
        #expect(ids(a.history) == ["al-1-t1"])
        let b = try #require(a.advanced())
        #expect(b.now?.id == "al-1-t2")
        #expect(ids(b.history) == ["al-1-t1", "al-2-t7"])
        let c = try #require(b.advanced())
        #expect(c.now?.id == "al-1-t3")
        #expect(c.advanced() == nil)
    }

    @Test("Shuffled, the context plays in its shuffle order")
    func advanceShuffled() throws {
        let q = QueueState(provider: "navidrome", now: song(1), context: songs(2...4), shuffleOrder: [2, 0, 1])
        let a = try #require(q.advanced())
        #expect(a.now?.id == "al-1-t4")
        #expect(ids(a.context) == ["al-1-t2", "al-1-t3"])
        #expect(a.shuffleOrder == [0, 1])
        let b = try #require(a.advanced())
        #expect(b.now?.id == "al-1-t2")
    }

    @Test("Previous takes the song before from the history; Next then comes back to this one")
    func back() throws {
        let q = QueueState(provider: "navidrome", now: song(2), context: [song(3)], history: [song(1)])
        let b = try #require(q.back())
        #expect(b.now?.id == "al-1-t1")
        #expect(ids(b.context) == ["al-1-t2", "al-1-t3"])
        #expect(b.history.isEmpty)
        #expect(b.back() == nil)
        // With songs queued next, the current one goes before them.
        let n = QueueState(provider: "navidrome", now: song(2), nextUp: [song(8, album: "al-2")], context: [song(3)], history: [song(1)])
        let nb = try #require(n.back())
        #expect(ids(nb.nextUp) == ["al-1-t2", "al-2-t8"])
        #expect(ids(nb.context) == ["al-1-t3"])
        // Shuffled, it is first in the play order.
        let s = QueueState(provider: "navidrome", now: song(2), context: songs(3...4), history: [song(1)], shuffleOrder: [1, 0])
        let sb = try #require(s.back())
        #expect(sb.shuffleOrder == [0, 2, 1])
        #expect(ids(sb.orderedContext) == ["al-1-t2", "al-1-t4", "al-1-t3"])
    }

    @Test("Play Next goes before what is queued, in order; Add to Queue after")
    func queueing() {
        let q = QueueState(provider: "navidrome", now: song(1), nextUp: [song(5, album: "al-2")])
            .playingNext([song(1, album: "al-2"), song(2, album: "al-2")])
            .addingToQueue([song(9, album: "al-2")])
        #expect(ids(q.nextUp) == ["al-2-t1", "al-2-t2", "al-2-t5", "al-2-t9"])
    }

    @Test("A tap in Up next plays that song; the ones before it are skipped")
    func jump() throws {
        let q = QueueState(
            provider: "navidrome", now: song(1), nextUp: [song(1, album: "al-2"), song(2, album: "al-2")],
            context: songs(2...4))
        let a = try #require(q.jumped(to: 1))
        #expect(a.now?.id == "al-2-t2")
        #expect(a.nextUp.isEmpty)
        #expect(ids(a.context) == ["al-1-t2", "al-1-t3", "al-1-t4"])
        #expect(ids(a.history) == ["al-1-t1"])
        let b = try #require(q.jumped(to: 3))
        #expect(b.now?.id == "al-1-t3")
        #expect(b.nextUp.isEmpty)
        #expect(ids(b.context) == ["al-1-t4"])
        #expect(q.jumped(to: 9) == nil)
    }

    @Test("Removing from either part keeps the shuffle order right")
    func remove() {
        let q = QueueState(
            provider: "navidrome", now: song(1), nextUp: [song(1, album: "al-2"), song(2, album: "al-2")],
            context: songs(2...4), shuffleOrder: [2, 0, 1])
        #expect(ids(q.upcoming) == ["al-2-t1", "al-2-t2", "al-1-t4", "al-1-t2", "al-1-t3"])
        #expect(ids(q.removing(at: 0).nextUp) == ["al-2-t2"])
        let first = q.removing(at: 2)
        #expect(ids(first.context) == ["al-1-t2", "al-1-t3"])
        #expect(ids(first.orderedContext) == ["al-1-t2", "al-1-t3"])
        let second = q.removing(at: 3)
        #expect(ids(second.context) == ["al-1-t3", "al-1-t4"])
        #expect(second.shuffleOrder == [1, 0])
        #expect(ids(second.orderedContext) == ["al-1-t4", "al-1-t3"])
        #expect(q.removing(at: 9) == q)
    }

    @Test("Moving: the order that plays is the order shown, in and between the parts")
    func move() {
        let a1 = song(1, album: "al-2"), a2 = song(2, album: "al-2"), a3 = song(3, album: "al-2")
        let within = QueueState(provider: "navidrome", now: song(1), nextUp: [a1, a2, a3]).moving(from: 0, to: 2)
        #expect(ids(within.nextUp) == ["al-2-t2", "al-2-t3", "al-2-t1"])
        let up = QueueState(provider: "navidrome", now: song(1), nextUp: [a1], context: songs(2...3)).moving(from: 2, to: 0)
        #expect(ids(up.nextUp) == ["al-1-t3", "al-2-t1"])
        #expect(ids(up.context) == ["al-1-t2"])
        let down = QueueState(provider: "navidrome", now: song(1), nextUp: [a1], context: songs(2...3)).moving(from: 0, to: 2)
        #expect(down.nextUp.isEmpty)
        #expect(ids(down.context) == ["al-1-t2", "al-1-t3", "al-2-t1"])
        let shuffled = QueueState(provider: "navidrome", now: song(1), context: songs(2...4), shuffleOrder: [2, 0, 1])
            .moving(from: 0, to: 2)
        #expect(shuffled.shuffleOrder == [0, 1, 2])
        #expect(ids(shuffled.context) == ["al-1-t2", "al-1-t3", "al-1-t4"])
        let cleared = shuffled.clearingUpcoming()
        #expect(cleared.upcoming.isEmpty)
        #expect(cleared.now?.id == "al-1-t1")
    }

    @Test("Saved, the history keeps its last 20 and a queue too big for the server is cut to fit")
    func trimmed() throws {
        let q = QueueState(
            provider: "navidrome", now: song(1), nextUp: [song(1, album: "al-2")], context: songs(2...401),
            contextSource: albumContext, history: songs(1...30, album: "al-9"),
            shuffleOrder: Array((0..<400).reversed()))
        let out = q.trimmed()
        #expect(ids(out.history) == ids(Array(songs(11...30, album: "al-9"))))
        #expect(out.context.count < 400)
        #expect(ids(out.context) == ids(Array(q.context.prefix(out.context.count))))
        #expect(out.shuffleOrder == nil)
        #expect(ids(out.nextUp) == ["al-2-t1"])
        #expect(try JSONEncoder().encode(out).count <= QueueState.maxBytes)
        let small = QueueState(provider: "navidrome", now: song(1), context: songs(2...3), shuffleOrder: [1, 0])
        #expect(small.trimmed() == small)
    }

    @Test("A queue the web saved reads back whole: shuffle, the source, a song's format and gain")
    func webQueue() throws {
        let saved = try EchoClient.decode(SavedQueue.self, from: Fixture.data("me-queue"))
        #expect(saved.updatedAt == 1_800_001_155_000)
        #expect(saved.positionMs == 12345.678)
        let q = try #require(saved.queue)
        #expect(q.provider == "navidrome")
        let now = try #require(q.now)
        #expect(now.key == "navidrome:al-1-t2")
        #expect(now.contentType == "audio/flac")
        #expect(now.suffix == "flac")
        #expect(now.replayGain == ReplayGain(trackGain: -6.5, albumGain: -7.25, trackPeak: 0.98, albumPeak: 1))
        #expect(ids(q.nextUp) == ["al-3-t1"])
        #expect(ids(q.context) == ["al-1-t3", "al-1-t4"])
        #expect(q.shuffleOrder == [1, 0])
        #expect(ids(q.upcoming) == ["al-3-t1", "al-1-t4", "al-1-t3"])
        #expect(ids(q.history) == ["al-1-t1"])
        #expect(q.contextSource == albumContext)
        // Written back, it reads the same.
        let again = try JSONDecoder().decode(QueueState.self, from: JSONEncoder().encode(q))
        #expect(again == q)
    }

    @Test("A queue Android saved reads back with what it left out: Next up empty, its songs Navidrome's")
    func androidQueue() throws {
        let saved = try EchoClient.decode(SavedQueue.self, from: Fixture.data("me-queue-newer"))
        #expect(saved.updatedAt == 1_800_001_155_001)
        #expect(saved.positionMs == 12000)
        let q = try #require(saved.queue)
        #expect(q.now?.provider == "navidrome")
        #expect(q.now?.key == "navidrome:al-3-t2")
        #expect(q.nextUp.isEmpty)
        #expect(ids(q.context) == ["al-1-t3"])
        #expect(q.contextSource == PlayContext(kind: "playlist", id: "pl-1", title: "Late Ferries"))
        let none = try EchoClient.decode(SavedQueue.self, from: Fixture.data("me-queue-empty"))
        #expect(none == SavedQueue(queue: nil, positionMs: 0, updatedAt: 0))
    }

    @Test("Written as the web writes it: provider and now always there, null when empty")
    func encoded() throws {
        let json = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(QueueState())) as? [String: Any])
        #expect(json["provider"] is NSNull)
        #expect(json["now"] is NSNull)
        #expect((json["nextUp"] as? [Any])?.isEmpty == true)
        #expect(json["contextSource"] == nil)
        #expect(json["shuffleOrder"] == nil)
    }

    @Test("A song that cannot be read is left out, and a shuffle order that does not fit is dropped")
    func lenient() throws {
        let raw = """
            {"now":{"id":"x1","title":"X"},"nextUp":[{"title":"no id"},{"id":"x2"}],
             "context":[{"id":"x3"},{"id":"x4"}],"shuffleOrder":[0,5],"history":"not a list"}
            """
        let q = try JSONDecoder().decode(QueueState.self, from: Data(raw.utf8))
        #expect(q.provider == "navidrome")
        #expect(ids(q.nextUp) == ["x2"])
        #expect(q.nextUp.first?.key == "navidrome:x2")
        #expect(q.shuffleOrder == nil)
        #expect(q.history.isEmpty)
    }

    @Test("What this player can play of a saved queue: Navidrome's songs, never another provider's queue")
    func playable() throws {
        var youtube = song(3)
        youtube.provider = "youtube"
        let q = QueueState(provider: "navidrome", now: song(1), context: [song(2), youtube, song(4)], shuffleOrder: [2, 1, 0])
        let ours = try #require(q.playable)
        #expect(ids(ours.context) == ["al-1-t2", "al-1-t4"])
        #expect(ours.shuffleOrder == nil)
        #expect(QueueState(provider: "spotify", now: song(1)).playable == nil)
        #expect(QueueState(provider: "navidrome", now: youtube).playable == nil)
        #expect(QueueState(provider: nil, now: song(1)).playable?.provider == "navidrome")
    }
}
