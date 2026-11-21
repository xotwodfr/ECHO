import Foundation

// A stand-in for ECHO: a URLProtocol that answers each request from the recorded responses in
// Fixtures/ (recorded from the server's own code with its mock Navidrome by
// scripts/apple-fixtures.ts), and keeps what the app sent. Each Stub has its own host, so tests run
// in parallel without sharing answers.

/// One canned answer.
enum Reply: Sendable {
    case json(Int, Data, headers: [String: String] = [:])
    case failure(URLError.Code)

    /// A recorded body from Fixtures/<name>.json, with its status.
    static func fixture(_ name: String, status: Int = 200, headers: [String: String] = [:]) -> Reply {
        .json(status, Fixture.data(name), headers: headers)
    }

    static func body(_ json: String, status: Int = 200, headers: [String: String] = [:]) -> Reply {
        .json(status, Data(json.utf8), headers: headers)
    }
}

/// What the app sent.
struct SentRequest: Sendable {
    let method: String
    /// The path under /api/v1 ("/me/settings").
    let path: String
    let query: [String: String]
    let headers: [String: String]
    let body: Data?

    var json: [String: Any]? { body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    var bearer: String? {
        headers["Authorization"].flatMap { $0.hasPrefix("Bearer ") ? String($0.dropFirst(7)) : nil }
    }
}

final class Stub: @unchecked Sendable {
    let host: String
    let base: URL
    let session: URLSession

    private let lock = NSLock()
    private var routes: [String: [Reply]] = [:]
    private var sent: [SentRequest] = []

    init() {
        host = "echo-\(UUID().uuidString.lowercased()).test"
        base = URL(string: "https://\(host)")!
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        session = URLSession(configuration: config)
        StubProtocol.register(self)
    }

    /// Answers `method path` (the path under /api/v1, without the query) with these replies in
    /// turn, the last one again and again.
    @discardableResult
    func on(_ method: String, _ path: String, _ replies: Reply...) -> Stub {
        lock.withLock { routes["\(method) \(path)"] = replies }
        return self
    }

    var requests: [SentRequest] { lock.withLock { sent } }

    func requests(_ method: String, _ path: String) -> [SentRequest] {
        requests.filter { $0.method == method && $0.path == path }
    }

    fileprivate func answer(_ request: URLRequest, body: Data?) -> Reply {
        let url = request.url!
        var path = url.path
        if path.hasPrefix("/api/v1") { path.removeFirst("/api/v1".count) }
        var query: [String: String] = [:]
        for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
            query[item.name] = item.value ?? ""
        }
        let method = request.httpMethod ?? "GET"
        let record = SentRequest(
            method: method, path: path, query: query, headers: request.allHTTPHeaderFields ?? [:], body: body)
        return lock.withLock {
            sent.append(record)
            guard var replies = routes["\(method) \(path)"], let first = replies.first else {
                return .body(#"{"error":"not_stubbed"}"#, status: 404)
            }
            if replies.count > 1 {
                replies.removeFirst()
                routes["\(method) \(path)"] = replies
            }
            return first
        }
    }
}

final class StubProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var stubs: [String: Stub] = [:]

    static func register(_ stub: Stub) {
        lock.withLock { stubs[stub.host] = stub }
    }

    private static func stub(for host: String?) -> Stub? {
        lock.withLock { host.flatMap { stubs[$0] } }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let stub = Self.stub(for: request.url?.host) else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        switch stub.answer(request, body: request.httpBody ?? request.httpBodyStream.map(Self.read)) {
        case .failure(let code):
            client?.urlProtocol(self, didFailWithError: URLError(code))
        case .json(let status, let data, let headers):
            var fields = headers
            fields["Content-Type"] = fields["Content-Type"] ?? "application/json"
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}

    /// URLSession hands a protocol the body as a stream.
    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}

enum Fixture {
    private final class Token {}

    /// Fixtures/<name>.json from the test bundle.
    static func data(_ name: String) -> Data {
        guard let url = Bundle(for: Token.self).url(forResource: name, withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { fatalError("No fixture \(name).json in the test bundle") }
        return data
    }
}

/// Waits until `condition` holds (an event the client sent on to the main actor), up to 2 s.
@MainActor
func eventually(_ condition: () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + .seconds(2)
    while !condition() {
        if ContinuousClock.now > deadline { return false }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return true
}

/// The waits the client asked for, instead of sleeping them.
final class Sleeps: @unchecked Sendable {
    private let lock = NSLock()
    private var list: [Duration] = []

    var all: [Duration] { lock.withLock { list } }

    var sleep: @Sendable (Duration) async throws -> Void {
        { [self] duration in lock.withLock { list.append(duration) } }
    }
}

/// Collects what the client reports.
final class Events: @unchecked Sendable {
    private let lock = NSLock()
    private var list: [ClientEvent] = []

    var all: [ClientEvent] { lock.withLock { list } }

    var record: @Sendable (ClientEvent) -> Void {
        { [self] event in lock.withLock { list.append(event) } }
    }
}
