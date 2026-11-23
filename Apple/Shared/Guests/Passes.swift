import Foundation

// Signing a computer in with the phone and guest passes (src/server/qrlogin.ts, src/server/guests.ts;
// Android's api/Guests.kt): what a scanned QR code holds, the calls, and their refusals. The web's
// sign-in page shows `<origin>/link#<id>`; an inviter's guest pass is `<origin>/guest#<code>`.

/// What a scanned QR code (or a link) holds.
enum ScanPayload: Equatable, Sendable {
    /// The web sign-in page of this ECHO, asking to be signed in (`<origin>/link#<id>`).
    case signIn(id: String)
    /// A guest pass for this ECHO (`<origin>/guest#<code>`, or `echo://guest#<code>`).
    case guest(code: String)
    /// A Listen together invitation for this ECHO (`<origin>/together/<id>`, or `echo://together/<id>`).
    case together(id: String)
    /// A sign-in page or guest pass of another ECHO server.
    case otherServer(host: String)
    /// Anything else: a shop's QR code, a Wi-Fi password, a link with a broken code.
    case unknown

    /// The ids and codes the server makes (base64url, 16 bytes or more) and accepts.
    static func isCode(_ s: String) -> Bool {
        (16...64).contains(s.count) && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    /// Reads a scanned text against this app's server (`https://echo.folk3s.com`).
    init(_ text: String, server: URL) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // A Listen together invitation holds the session in its path, not after a #.
        if let id = TogetherLink.id(in: text, server: server) {
            self = .together(id: id)
            return
        }
        if let host = TogetherLink.host(of: text) {
            self = .otherServer(host: host)
            return
        }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
              let fragment = url.fragment(percentEncoded: false)
        else {
            self = .unknown
            return
        }
        if scheme == AppLink.scheme {
            let place = (url.host() ?? url.path(percentEncoded: false)).lowercased()
            self = place == "guest" && Self.isCode(fragment) ? .guest(code: fragment) : .unknown
            return
        }
        guard scheme == "https" || scheme == "http", let host = url.host()?.lowercased() else {
            self = .unknown
            return
        }
        let path = url.path(percentEncoded: false)
        guard path == "/link" || path == "/guest" else {
            self = .unknown
            return
        }
        let same = host == server.host()?.lowercased() && scheme == server.scheme?.lowercased()
            && (url.port ?? (scheme == "https" ? 443 : 80)) == (server.port ?? (server.scheme == "https" ? 443 : 80))
        guard same else {
            self = .otherServer(host: host)
            return
        }
        guard Self.isCode(fragment) else {
            self = .unknown
            return
        }
        self = path == "/link" ? .signIn(id: fragment) : .guest(code: fragment)
    }
}

/// Which browser asks to be signed in, and from where (`POST /auth/qr/peek`).
struct LinkPeek: Codable, Equatable, Sendable {
    /// "Chrome on Windows".
    var browser: String
    /// The network it asks from, as a hint ("203.0.113.0/24").
    var ip: String
    /// Milliseconds since 1970.
    var expiresAt: Double
}

/// Whose guest pass a code is and for how long (`POST /guests/peek`).
struct GuestPeek: Codable, Equatable, Sendable {
    var invitedBy: String
    var durationMs: Double
}

/// A guest pass to show as a QR code (`POST /guests/codes`): scanned once, within 10 minutes.
struct GuestCode: Codable, Equatable, Sendable {
    var code: String
    /// What the QR code holds: `https://<origin>/guest#<code>`.
    var url: String
    var expiresAt: Double
    var durationMs: Double

    var expires: Date { Date(timeIntervalSince1970: expiresAt / 1000) }
}

/// A guest's request to keep the account, under a name it chose.
struct KeepRequest: Codable, Equatable, Sendable {
    var username: String
    var requestedAt: Double?
}

/// This device's guest pass (`GET /guests/me`): when it ends and who gave it.
struct GuestPass: Codable, Equatable, Sendable {
    var expiresAt: Double
    var invitedBy: String?
    var keep: KeepRequest?

    var ends: Date { Date(timeIntervalSince1970: expiresAt / 1000) }
}

/// A guest the user invited (every guest, for an admin): `GET /guests`.
struct Guest: Codable, Equatable, Identifiable, Sendable {
    var id: Int
    var username: String
    var invitedBy: String?
    var createdAt: Double
    var expiresAt: Double
    var keep: KeepRequest?

    var ends: Date { Date(timeIntervalSince1970: expiresAt / 1000) }
}

/// A guest's sign-in, from a redeemed pass.
struct GuestJoin: Equatable, Sendable {
    var token: String
    var username: String
    var pass: GuestPass
}

/// How long a guest may stay: what the server offers (guests.ts GUEST_DURATIONS).
enum GuestLength: Int, CaseIterable, Identifiable, Sendable {
    case hour = 3_600_000
    case day = 86_400_000
    case week = 604_800_000

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .hour: "1 hour"
        case .day: "1 day"
        case .week: "1 week"
        }
    }
}

enum PassText {
    /// "1 hour", "1 day", "1 week"; "3 days" and the like for others (Android's durationText).
    static func duration(ms: Double) -> String {
        let h = Int(ms / 3_600_000)
        if h < 24 { return h == 1 ? "1 hour" : "\(h) hours" }
        if h % (24 * 7) == 0 { return h == 24 * 7 ? "1 week" : "\(h / (24 * 7)) weeks" }
        return h == 24 ? "1 day" : "\(h / 24) days"
    }

    /// "42 min left", "18 h left", "3 days left" (the web's timeLeft).
    static func left(until end: Date, now: Date) -> String {
        let min = max(0, Int(end.timeIntervalSince(now) / 60))
        if min < 60 { return "\(min) min left" }
        if min < 48 * 60 { return "\(min / 60) h left" }
        return "\(min / (24 * 60)) days left"
    }

    /// "9:41" for the seconds a code still works.
    static func clock(_ seconds: Int) -> String {
        String(format: "%d:%02d", max(0, seconds) / 60, max(0, seconds) % 60)
    }
}

/// Why a scan, a pass or an invite did not go through.
enum PassError: Error, Equatable, Sendable {
    /// The request or code ran out, was used already, or never was (404).
    case expired
    /// Too many tries: wait this long (Retry-After, seconds), or a minute when it does not say.
    case rateLimited(retryAfter: Int)
    /// Five codes are still waiting to be scanned.
    case tooManyCodes
    /// A guest pass can't do this (403 guest).
    case guest
    case api(ApiError)

    var userMessage: String {
        switch self {
        case .expired: "That code ran out or was used already."
        case .rateLimited(let s): "Too many tries. Try again in \(s < 60 ? "\(s) s" : "a minute")."
        case .tooManyCodes: "You have five codes waiting. Let them run out first."
        case .guest: ApiError.guestNotAllowed.userMessage
        case .api(let e): e.userMessage
        }
    }
}

extension EchoClient {
    private struct Id: Encodable { let id: String }
    private struct Code: Encodable { let code: String }
    private struct Redeem: Encodable {
        let code: String
        let name: String
    }
    private struct Length: Encodable { let durationMs: Int }
    private struct Approved: Decodable { let browser: String }
    private struct Joined: Decodable {
        let token: String
        let username: String
        let expiresAt: Double
        let invitedBy: String?
    }
    private struct Me: Decodable { let guest: GuestPass? }

    /// A POST whose refusals the scan and invite screens tell apart: 404 as expired, 429 with its
    /// Retry-After, 403 guest; anything else as ApiError. Writes are never repeated.
    private func pass<T: Decodable>(_ path: String, _ body: some Encodable, as type: T.Type = T.self) async throws -> T {
        let json: Data
        do { json = try JSONEncoder().encode(body) } catch { throw PassError.api(.badResponse) }
        let answer: (data: Data, response: HTTPURLResponse)
        do {
            answer = try await self.answer("POST", path, body: json, retries: 0, accepting: [403, 404, 429])
        } catch let error as ApiError {
            throw PassError.api(error)
        }
        let object = (try? JSONSerialization.jsonObject(with: answer.data)) as? [String: Any]
        let code = object?["error"] as? String
        switch answer.response.statusCode {
        case 404: throw PassError.expired
        case 429:
            if code == "too_many_codes" { throw PassError.tooManyCodes }
            let header = answer.response.value(forHTTPHeaderField: "Retry-After")?.trimmingCharacters(in: .whitespaces)
            throw PassError.rateLimited(retryAfter: header.flatMap { Int($0) }.map { max(1, $0) } ?? 60)
        case 403:
            throw code == "guest" ? PassError.guest : PassError.api(.server(status: 403, code: code))
        default:
            do { return try Self.decode(T.self, from: answer.data) } catch { throw PassError.api(.badResponse) }
        }
    }

    // MARK: Signing a computer in

    /// Which browser asks (signed in, not a guest).
    func peekSignIn(id: String) async throws -> LinkPeek {
        try await pass("/auth/qr/peek", Id(id: id))
    }

    /// Signs that browser in as this user; the browser's name comes back.
    func approveSignIn(id: String) async throws -> String {
        try await pass("/auth/qr/approve", Id(id: id), as: Approved.self).browser
    }

    // MARK: Joining as a guest (no sign-in: the code is the secret)

    func peekGuest(code: String) async throws -> GuestPeek {
        try await pass("/guests/peek", Code(code: code))
    }

    /// Redeems the pass: a guest account and a device token for this phone, until the time is up.
    func redeemGuest(code: String, deviceName: String) async throws -> GuestJoin {
        let joined: Joined = try await pass("/guests/redeem", Redeem(code: code, name: String(deviceName.prefix(64))))
        guard joined.token.hasPrefix("echo_dt_") else { throw PassError.api(.badResponse) }
        return GuestJoin(
            token: joined.token, username: joined.username,
            pass: GuestPass(expiresAt: joined.expiresAt, invitedBy: joined.invitedBy, keep: nil))
    }

    /// This device's guest pass; nil for a normal account.
    func guestPass() async throws -> GuestPass? {
        try await get("/guests/me", as: Me.self).guest
    }

    // MARK: Inviting

    func createGuestCode(_ length: GuestLength) async throws -> GuestCode {
        try await pass("/guests/codes", Length(durationMs: length.rawValue))
    }

    func guests() async throws -> [Guest] {
        try await get("/guests")
    }

    /// Ends a guest's time now: signed out, its account deleted.
    func endGuest(_ id: Int) async throws {
        struct Ok: Decodable {}
        let _: Ok = try await pass("/guests/\(id)/end", [String: String]())
    }

    /// Approves a guest's request to stay: it becomes a normal user under the name it chose.
    func keepGuest(_ id: Int) async throws {
        struct Ok: Decodable {}
        let _: Ok = try await pass("/guests/\(id)/approve", [String: String]())
    }
}
