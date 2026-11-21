import Foundation

/// Everything that can go wrong talking to ECHO, as values the app can switch on, each with a
/// message to show (docs/api/openapi.yaml; the web's src/client/api.ts and Android's Api.kt answer
/// the same codes).
enum ApiError: Error, Equatable, Sendable {
    /// This device has no network.
    case offline
    /// The network is up but ECHO did not answer: a timeout, a refused connection, a name that
    /// did not resolve, or the proxy in front of ECHO answering 502–504 while ECHO restarts.
    case unreachable
    /// Signing in: the username or password is wrong (the server does not say which).
    case wrongCredentials
    /// Signing in: the account has two-factor on and no code came with the request.
    case totpRequired
    /// Signing in: the code (or recovery code) did not work.
    case badCode
    /// Signing in: too many attempts from this address.
    case tooManyAttempts
    /// The server refused the device token (revoked in Sessions & devices, or idle 60 days).
    case signedOut
    /// The per-user API budget, still over it after the retries Retry-After allows.
    case rateLimited
    /// "Require two-factor for all" is on and this account has none yet.
    case totpEnrolmentRequired
    /// A guest pass cannot do this (it only listens).
    case guestNotAllowed
    /// The user has not connected a Navidrome in ECHO's Settings.
    case navidromeNotConnected
    /// ECHO's proxy could not use the user's Navidrome (`navidrome.unreachable`, `navidrome.auth`…).
    case navidrome(code: String, message: String?)
    /// Navidrome answered and refused (Subsonic's `status: failed`): 70 is "not found".
    case subsonic(code: Int, message: String?)
    case notFound
    /// Any other answer than 2xx: the status and ECHO's error code, when it sent one.
    case server(status: Int, code: String?)
    /// An answer that could not be read.
    case badResponse

    /// The error code the server answers with, when that is all there is to go on.
    init(status: Int, code: String?, message: String?, signingIn: Bool) {
        switch (status, code) {
        case (_, "navidrome.not_connected"): self = .navidromeNotConnected
        case (401, "totp_required") where signingIn: self = .totpRequired
        case (401, "bad_code") where signingIn: self = .badCode
        case (401, _) where signingIn: self = .wrongCredentials
        case (401, _): self = .signedOut
        case (429, _) where signingIn: self = .tooManyAttempts
        case (429, _): self = .rateLimited
        case (403, "totp_enrolment_required"): self = .totpEnrolmentRequired
        case (403, "guest"): self = .guestNotAllowed
        case (404, _): self = .notFound
        case (_, let code?) where code.hasPrefix("navidrome."): self = .navidrome(code: code, message: message)
        default: self = .server(status: status, code: code)
        }
    }

    /// A request that got no answer at all.
    init(transport error: URLError) {
        switch error.code {
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff, .callIsActive:
            self = .offline
        default:
            self = .unreachable
        }
    }

    /// Whether trying the same again later can work (no answer, a busy server, Navidrome away).
    var retriable: Bool {
        switch self {
        case .offline, .unreachable, .rateLimited, .tooManyAttempts: true
        case .navidrome(let code, _): code == "navidrome.unreachable"
        default: false
        }
    }

    var userMessage: String {
        switch self {
        case .offline: "You're offline. ECHO comes back when your connection does."
        case .unreachable: "ECHO isn't answering right now. Try again in a moment."
        case .wrongCredentials: "Username or password is incorrect."
        case .totpRequired: "Enter the code from your authenticator app too."
        case .badCode: "That code did not work. Try the current one."
        case .tooManyAttempts: "Too many attempts. Wait a minute and try again."
        case .signedOut: "You were signed out. Sign in again."
        case .rateLimited: "ECHO is busy. Try again in a moment."
        case .totpEnrolmentRequired:
            "Your ECHO asks everyone to use two-factor. Set it up in ECHO on the web, then sign in here."
        case .guestNotAllowed: "A guest pass can't do that."
        case .navidromeNotConnected: "Connect your Navidrome in ECHO's Settings on the web first."
        case .navidrome(_, let message): message ?? "Something went wrong talking to Navidrome."
        case .subsonic(70, _): "That isn't in your library any more."
        case .subsonic(_, let message): "Navidrome answered: \(message ?? "it refused")"
        case .notFound: "That isn't on ECHO any more."
        case .server(let status, let code): "ECHO answered with an error (\(code ?? "HTTP \(status)"))."
        case .badResponse: "ECHO's answer could not be read."
        }
    }
}

extension ApiError: LocalizedError {
    var errorDescription: String? { userMessage }
}
