import Foundation
import Synchronization

// ECHO's API as the Apple apps use it (docs/api/openapi.yaml): a device token from POST
// /auth/device sent as a bearer header on every request (the server's Origin check exempts it),
// ECHO's errors as ApiError, the per-user API budget's 429 answered as the web client does
// (src/client/api.ts), and whether ECHO answers at all, for the offline state. Endpoints.swift
// and Subsonic.swift add the calls; Session.swift keeps the token and the signed-in state.

/// What the client reports as it goes, for the session: whether ECHO answered, and a refused token.
enum ClientEvent: Equatable, Sendable {
    /// ECHO answered the last request (any answer, errors too), or could not be reached.
    case reachable(Bool)
    /// The server refused this token: revoked in Sessions & devices, or idle 60 days.
    case tokenRefused(String)
}

final class EchoClient: Sendable {
    /// The server's origin ("https://echo.folk3s.com"), without a trailing slash.
    let base: URL
    private let origin: String
    private let http: URLSession
    private let tokenBox: Mutex<String?>
    private let sleep: @Sendable (Duration) async throws -> Void
    private let jitter: @Sendable () -> Double
    private let onEvent: @Sendable (ClientEvent) -> Void

    /// Over the per-user budget (SETTINGS_AND_SECURITY.md §5.6: bursts of 50, then 10 a second), a
    /// read asks again after the server's Retry-After, at most this often and for waits this long.
    static let budgetRetries = 2
    static let budgetWaitMax = 5
    /// Each wait is a little longer at random (up to this, in seconds), so a burst refused at once
    /// does not come back at once.
    static let budgetJitter = 0.3

    static let signInPath = "/auth/device"

    init(
        base: URL,
        token: String? = nil,
        http: URLSession = .shared,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        jitter: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) },
        onEvent: @escaping @Sendable (ClientEvent) -> Void = { _ in }
    ) {
        var origin = base.absoluteString
        while origin.hasSuffix("/") { origin.removeLast() }
        self.origin = origin
        self.base = URL(string: origin) ?? base
        self.http = http
        self.tokenBox = Mutex(token)
        self.sleep = sleep
        self.jitter = jitter
        self.onEvent = onEvent
    }

    /// The device token this client sends, if signed in.
    var token: String? { tokenBox.withLock { $0 } }

    func setToken(_ token: String?) {
        tokenBox.withLock { $0 = token }
    }

    // MARK: - URLs

    /// A server path, as tracks keep their artwork ("/api/v1/navidrome/cover/…"), as a full URL.
    func url(_ path: String) -> URL? {
        if path.hasPrefix("http://") || path.hasPrefix("https://") || path.hasPrefix("file:") {
            return URL(string: path)
        }
        return URL(string: origin + (path.hasPrefix("/") ? path : "/" + path))
    }

    /// An API path ("/me") with its query, as a full URL under /api/v1.
    func apiURL(_ path: String, _ query: [(String, String)] = []) -> URL? {
        URL(string: origin + "/api/v1" + path + (query.isEmpty ? "" : "?" + Self.formEncoded(query)))
    }

    /// A request for one of ECHO's own URLs with the bearer header (an image loader's, say).
    func authorized(_ url: URL) -> URLRequest {
        var req = URLRequest(url: url)
        if let token, url.absoluteString.hasPrefix(origin + "/") {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    /// Characters that stay as they are in a path segment or a query value; everything else is
    /// percent-encoded, `+` and `&` and non-ASCII letters included.
    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// Percent-encodes an id for a path segment or a value for a query.
    static func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s
    }

    static func formEncoded(_ query: [(String, String)]) -> String {
        query.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&")
    }

    // MARK: - Requests

    /// One call to /api/v1: the body of a 2xx answer, or ApiError. A GET over the API budget is
    /// asked again after Retry-After (by default up to 5 s, twice, each wait longer than the last;
    /// `retries` and `waitMax` change that for one call); writes are never repeated, and the sign-in
    /// limits send no Retry-After. `accepting`: other statuses whose body is the answer too (the
    /// lyrics' 404, which lists the sources tried).
    func data(
        _ method: String, _ path: String, query: [(String, String)] = [], body: Data? = nil,
        retries: Int = EchoClient.budgetRetries, waitMax: Int = EchoClient.budgetWaitMax,
        accepting: Set<Int> = []
    ) async throws -> Data {
        try await answer(method, path, query: query, body: body, retries: retries, waitMax: waitMax, accepting: accepting).data
    }

    /// As data(…), with the answer's status and headers (a 202's Retry-After, say).
    func answer(
        _ method: String, _ path: String, query: [(String, String)] = [], body: Data? = nil,
        retries: Int = EchoClient.budgetRetries, waitMax: Int = EchoClient.budgetWaitMax,
        accepting: Set<Int> = []
    ) async throws -> (data: Data, response: HTTPURLResponse) {
        var attempt = 0
        while true {
            let (data, res, sent) = try await exchange(method, path, query, body)
            let status = res.statusCode
            if status == 429, method == "GET", attempt < retries,
               let header = res.value(forHTTPHeaderField: "Retry-After"),
               let wait = Int(header.trimmingCharacters(in: .whitespaces)),
               wait > 0, wait <= waitMax
            {
                onEvent(.reachable(true))
                attempt += 1
                let seconds = Double(wait * attempt) + jitter() * Self.budgetJitter
                try await sleep(.milliseconds(Int((seconds * 1000).rounded())))
                continue
            }
            if (200..<300).contains(status) || accepting.contains(status) {
                onEvent(.reachable(true))
                return (data, res)
            }
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let code = (object?["code"] as? String) ?? (object?["error"] as? String)
            // A 502–504 without ECHO's own error body came from the proxy in front of it (Caddy
            // while ECHO restarts): unreachable, as when no answer came at all.
            if (502...504).contains(status), code == nil {
                onEvent(.reachable(false))
                throw ApiError.unreachable
            }
            onEvent(.reachable(true))
            let signingIn = path == Self.signInPath
            if status == 401, !signingIn, let sent {
                onEvent(.tokenRefused(sent))
            }
            throw ApiError(
                status: status, code: code, message: object?["userMessage"] as? String, signingIn: signingIn)
        }
    }

    /// The request itself: what came back, and the token it carried.
    private func exchange(
        _ method: String, _ path: String, _ query: [(String, String)], _ body: Data?
    ) async throws -> (Data, HTTPURLResponse, String?) {
        guard let url = apiURL(path, query) else { throw ApiError.server(status: 0, code: "bad_url") }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let token = self.token
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await http.data(for: req)
            guard let res = response as? HTTPURLResponse else { throw ApiError.badResponse }
            return (data, res, token)
        } catch let error as URLError {
            // A request given up on (a page left, a cover scrolled away) says nothing about ECHO.
            if error.code == .cancelled { throw CancellationError() }
            onEvent(.reachable(false))
            throw ApiError(transport: error)
        }
    }

    /// The bytes at one of ECHO's own URLs, a server path as the models keep covers
    /// ("/api/v1/navidrome/cover/al-1?size=300"), with the bearer header: an image loader's request.
    /// A cover that does not come says nothing about ECHO, so nothing is reported to the session.
    func fetch(_ path: String) async throws -> Data {
        let (data, res) = try await fetchAnswer(path)
        guard (200..<300).contains(res.statusCode) else {
            throw ApiError(status: res.statusCode, code: nil, message: nil, signingIn: false)
        }
        return data
    }

    /// As fetch(_:), whatever the status, with the answer's headers (a motion cover's 202).
    func fetchAnswer(_ path: String) async throws -> (data: Data, response: HTTPURLResponse) {
        guard let url = url(path) else { throw ApiError.badResponse }
        var req = authorized(url)
        req.timeoutInterval = 30
        let answer: (Data, URLResponse)
        do {
            answer = try await http.data(for: req)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw ApiError(transport: error)
        }
        guard let res = answer.1 as? HTTPURLResponse else { throw ApiError.badResponse }
        return (answer.0, res)
    }

    /// A GET whose JSON answer decodes as `T`.
    func get<T: Decodable>(_ path: String, query: [(String, String)] = [], as type: T.Type = T.self) async throws -> T {
        let raw = try await data("GET", path, query: query)
        return try Self.decode(T.self, from: raw)
    }

    /// A request with a JSON body whose JSON answer decodes as `T`.
    func send<T: Decodable>(_ method: String, _ path: String, json: some Encodable, as type: T.Type = T.self) async throws -> T {
        let body: Data
        do { body = try JSONEncoder().encode(json) } catch { throw ApiError.badResponse }
        let raw = try await data(method, path, body: body)
        return try Self.decode(T.self, from: raw)
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ApiError.badResponse
        }
    }
}
