import Foundation

// The calls Listen together makes (docs/api/openapi.yaml, src/server/together.ts) and the event
// stream, behind a protocol: EchoClient makes them in the apps, the tests have a fake that scripts
// the answers and the events. The stream itself is read as Server-Sent Events by `SSEParser`, which
// is plain bytes in and messages out, so recorded streams test it.

protocol TogetherSource: Sendable {
    /// The session this person is in, or nil (`GET /together`).
    func current() async throws -> TogetherState?
    /// A session's state: for a member, and for someone about to join (whose host, how many).
    func peek(_ id: String) async throws -> TogetherState
    func start(_ seed: TogetherSeed) async throws -> TogetherState
    func join(_ id: String) async throws -> TogetherState
    /// Leaves; the host's leaving ends the session for everyone (true).
    @discardableResult func leave(_ id: String) async throws -> Bool
    func add(_ id: String, track: TrackRef, next: Bool) async throws -> TogetherState
    func remove(_ id: String, uid: String) async throws -> TogetherState
    /// The host's transport (`POST /together/:id/control`).
    func control(_ id: String, _ action: TogetherAction) async throws -> TogetherState
    /// The event stream: `state` first and on every change, `ping`, `end`. It finishes when the server
    /// closes it and throws when it cannot be opened or breaks (TogetherError, or ApiError inside).
    func events(_ id: String) -> AsyncThrowingStream<TogetherEvent, Error>
}

// MARK: - Server-Sent Events

/// One message of an event stream.
struct SSEMessage: Equatable, Sendable {
    var event: String
    var data: String
    var id: String?
}

/// Reads Server-Sent Events from bytes as they come: lines end in LF, CR or CRLF, a blank line ends a
/// message, `event:` names it, `data:` lines are joined with a newline, a line starting with `:` is a
/// comment (a keep-alive), `id:` is kept. (Not Foundation's `lines`: it drops the blank lines that
/// end each message.)
struct SSEParser: Sendable {
    private var line: [UInt8] = []
    private var event = ""
    private var data: [String] = []
    private var sawCR = false
    /// The last `id:` the server sent (the stream's own, for a Last-Event-ID; this server sends none).
    private(set) var lastEventId: String? = nil

    init() {}

    /// The next byte; a message when it ended one.
    mutating func feed(_ byte: UInt8) -> SSEMessage? {
        if byte == 0x0A {
            // The LF of a CRLF: the CR already ended the line.
            if sawCR {
                sawCR = false
                return nil
            }
            return endLine()
        }
        if byte == 0x0D {
            sawCR = true
            return endLine()
        }
        sawCR = false
        line.append(byte)
        return nil
    }

    /// Several bytes at once (a chunk of the body).
    mutating func feed(_ bytes: Data) -> [SSEMessage] {
        var messages: [SSEMessage] = []
        for byte in bytes {
            if let message = feed(byte) { messages.append(message) }
        }
        return messages
    }

    private mutating func endLine() -> SSEMessage? {
        let text = String(decoding: line, as: UTF8.self)
        line.removeAll(keepingCapacity: true)
        if text.isEmpty {
            defer {
                event = ""
                data = []
            }
            guard !data.isEmpty else { return nil }
            return SSEMessage(event: event.isEmpty ? "message" : event, data: data.joined(separator: "\n"), id: lastEventId)
        }
        if text.hasPrefix(":") { return nil }
        let name: String
        var value: String
        if let colon = text.firstIndex(of: ":") {
            name = String(text[..<colon])
            value = String(text[text.index(after: colon)...])
            if value.hasPrefix(" ") { value.removeFirst() }
        } else {
            name = text
            value = ""
        }
        switch name {
        case "event": event = value
        case "data": data.append(value)
        case "id": if !value.contains("\0") { lastEventId = value }
        default: break
        }
        return nil
    }
}

extension TogetherEvent {
    /// A message as an event; nil for one this app does not know, or whose data is broken (skipped:
    /// the next `state` says everything).
    init?(_ message: SSEMessage) {
        let data = Data(message.data.utf8)
        switch message.event {
        case "state":
            guard let state = try? JSONDecoder().decode(TogetherState.self, from: data) else { return nil }
            self = .state(state)
        case "ping":
            guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let serverTime = (object["serverTime"] as? NSNumber)?.doubleValue
            else { return nil }
            self = .ping(serverTime: serverTime, version: (object["version"] as? NSNumber)?.intValue ?? 0)
        case "end":
            self = .end
        default:
            return nil
        }
    }
}

// MARK: - The calls

extension EchoClient: TogetherSource {
    private struct Current: Decodable { var session: TogetherState? }
    private struct Left: Decodable { var ended: Bool? }
    private struct StartBody: Encodable {
        var track: TrackRef?
        var positionMs: Double?
        var playing: Bool?
        var queue: [TrackRef]?
    }
    private struct QueueBody: Encodable {
        var track: TrackRef
        var next: Bool
    }
    private struct ControlBody: Encodable {
        var action: String
        var positionMs: Double?
        var uid: String?
        var from: String?
    }

    /// A call whose refusals Listen together tells apart (404 gone, 403 not a member or host only, 409
    /// other library, 429 with its wait…); writes are never repeated.
    private func together(_ method: String, _ path: String, body: Data? = nil) async throws -> Data {
        let answer: (data: Data, response: HTTPURLResponse)
        do {
            answer = try await self.answer(
                method, path, body: body, retries: method == "GET" ? Self.budgetRetries : 0,
                accepting: [400, 403, 404, 409, 429, 503])
        } catch let error as ApiError {
            throw TogetherError.api(error)
        }
        guard (200..<300).contains(answer.response.statusCode) else {
            throw TogetherError(
                status: answer.response.statusCode, body: answer.data,
                retryAfter: answer.response.value(forHTTPHeaderField: "Retry-After"))
        }
        return answer.data
    }

    private func togetherState(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> TogetherState {
        let data = try await together(method, path, body: try body.map(Self.encoded))
        do { return try JSONDecoder().decode(TogetherState.self, from: data) } catch { throw TogetherError.api(.badResponse) }
    }

    private static func encoded(_ value: any Encodable) throws -> Data {
        do { return try JSONEncoder().encode(value) } catch { throw TogetherError.api(.badResponse) }
    }

    private static func path(_ id: String, _ rest: String = "") -> String { "/together/\(encode(id))\(rest)" }

    func current() async throws -> TogetherState? {
        let data = try await together("GET", "/together")
        do { return try JSONDecoder().decode(Current.self, from: data).session } catch { throw TogetherError.api(.badResponse) }
    }

    func peek(_ id: String) async throws -> TogetherState {
        try await togetherState("GET", Self.path(id))
    }

    func start(_ seed: TogetherSeed) async throws -> TogetherState {
        // No song: an empty session, where the first song added plays. `playing` and `positionMs` only
        // mean something with a song.
        let body = StartBody(
            track: seed.track, positionMs: seed.track == nil ? nil : max(0, seed.positionMs.rounded()),
            playing: seed.track == nil ? nil : seed.playing,
            queue: seed.track == nil ? nil : Array(seed.queue.prefix(TogetherSeed.queueMax)))
        return try await togetherState("POST", "/together", body: body)
    }

    func join(_ id: String) async throws -> TogetherState {
        try await togetherState("POST", Self.path(id, "/join"), body: [String: String]())
    }

    @discardableResult
    func leave(_ id: String) async throws -> Bool {
        let data = try await together("POST", Self.path(id, "/leave"), body: Data("{}".utf8))
        return (try? JSONDecoder().decode(Left.self, from: data))?.ended ?? false
    }

    func add(_ id: String, track: TrackRef, next: Bool) async throws -> TogetherState {
        try await togetherState("POST", Self.path(id, "/queue"), body: QueueBody(track: track, next: next))
    }

    func remove(_ id: String, uid: String) async throws -> TogetherState {
        try await togetherState("DELETE", Self.path(id, "/queue/\(Self.encode(uid))"))
    }

    func control(_ id: String, _ action: TogetherAction) async throws -> TogetherState {
        var body: ControlBody
        switch action {
        case .play: body = ControlBody(action: "play")
        case .pause: body = ControlBody(action: "pause")
        case .seek(let ms): body = ControlBody(action: "seek", positionMs: max(0, ms.rounded()))
        case .next(let from): body = ControlBody(action: "next", from: from)
        case .previous: body = ControlBody(action: "previous")
        case .jump(let uid): body = ControlBody(action: "jump", uid: uid)
        }
        return try await togetherState("POST", Self.path(id, "/control"), body: body)
    }

    func events(_ id: String) -> AsyncThrowingStream<TogetherEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await self.open(Self.path(id, "/events"), accept: "text/event-stream")
                    guard (200..<300).contains(response.statusCode) else {
                        // The refusal's body is a few bytes of JSON.
                        var body = Data()
                        for try await byte in bytes { body.append(byte) }
                        throw TogetherError(
                            status: response.statusCode, body: body, retryAfter: response.value(forHTTPHeaderField: "Retry-After"))
                    }
                    var parser = SSEParser()
                    for try await byte in bytes {
                        guard let message = parser.feed(byte), let event = TogetherEvent(message) else { continue }
                        continuation.yield(event)
                        if event == .end { break }
                    }
                    continuation.finish()
                } catch let error as TogetherError {
                    continuation.finish(throwing: error)
                } catch let error as ApiError {
                    continuation.finish(throwing: TogetherError.api(error))
                } catch is CancellationError {
                    continuation.finish()
                } catch let error as URLError {
                    continuation.finish(throwing: TogetherError.api(ApiError(transport: error)))
                } catch {
                    continuation.finish(throwing: TogetherError.api(.unreachable))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
