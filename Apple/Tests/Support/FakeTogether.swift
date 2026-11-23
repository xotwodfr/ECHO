import Foundation

// Stand-ins for Listen together: a source that answers each call from what the test scripted and keeps
// the calls, and event streams that play a scripted list of events and then end or break.

final class FakeTogether: TogetherSource, @unchecked Sendable {
    enum Call: Equatable {
        case current
        case peek(String)
        case start(TogetherSeed)
        case join(String)
        case leave(String)
        case add(String, id: String, next: Bool)
        case remove(String, uid: String)
        case control(String, TogetherAction)
        case events(String)
    }

    /// One step of an event stream: an event, or the stream breaking.
    enum Step {
        case event(TogetherEvent)
        case fail(TogetherError)
    }

    private let lock = NSLock()
    private var _calls: [Call] = []
    private var answers: [String: [Result<TogetherState, TogetherError>]] = [:]
    private var scripts: [[Step]] = []
    private var _current: TogetherState?
    private var _ended = false

    var calls: [Call] { lock.withLock { _calls } }

    /// The answers to a call ("peek", "join", "start", "add", "remove", "control"), each in turn, the
    /// last again; without any, the call fails as if ECHO did not answer.
    func answer(_ key: String, _ results: Result<TogetherState, TogetherError>...) {
        lock.withLock { answers[key] = results }
    }

    /// The streams, one for each time one is opened (then empty ones, which end at once).
    func script(_ streams: [Step]...) {
        lock.withLock { scripts = streams }
    }

    var current: TogetherState? {
        get { lock.withLock { _current } }
        set { lock.withLock { _current = newValue } }
    }

    /// What `leave` says: whether it ended the session.
    var leaveEnds: Bool {
        get { lock.withLock { _ended } }
        set { lock.withLock { _ended = newValue } }
    }

    func controls() -> [TogetherAction] {
        calls.compactMap { call in
            if case .control(_, let action) = call { return action }
            return nil
        }
    }

    private func next(_ key: String, _ call: Call) throws -> TogetherState {
        try lock.withLock {
            _calls.append(call)
            guard var list = answers[key], let first = list.first else { throw TogetherError.api(.unreachable) }
            if list.count > 1 {
                list.removeFirst()
                answers[key] = list
            }
            return try first.get()
        }
    }

    func current() async throws -> TogetherState? {
        lock.withLock {
            _calls.append(.current)
            return _current
        }
    }

    func peek(_ id: String) async throws -> TogetherState { try next("peek", .peek(id)) }
    func start(_ seed: TogetherSeed) async throws -> TogetherState { try next("start", .start(seed)) }
    func join(_ id: String) async throws -> TogetherState { try next("join", .join(id)) }

    func leave(_ id: String) async throws -> Bool {
        lock.withLock {
            _calls.append(.leave(id))
            return _ended
        }
    }

    func add(_ id: String, track: TrackRef, next: Bool) async throws -> TogetherState {
        try self.next("add", .add(id, id: track.id, next: next))
    }

    func remove(_ id: String, uid: String) async throws -> TogetherState {
        try next("remove", .remove(id, uid: uid))
    }

    func control(_ id: String, _ action: TogetherAction) async throws -> TogetherState {
        try next("control", .control(id, action))
    }

    func events(_ id: String) -> AsyncThrowingStream<TogetherEvent, Error> {
        let steps = lock.withLock { () -> [Step] in
            _calls.append(.events(id))
            return scripts.isEmpty ? [] : scripts.removeFirst()
        }
        return AsyncThrowingStream { continuation in
            for step in steps {
                switch step {
                case .event(let event): continuation.yield(event)
                case .fail(let error):
                    continuation.finish(throwing: error)
                    return
                }
            }
            continuation.finish()
        }
    }
}
