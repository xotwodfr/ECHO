import Foundation
import Observation

/// Where scanned QR codes come from: the iPhone's camera (UI/CodeScanner.swift), or a fixed list
/// (the tests and the demo screens: the camera cannot run on the CI's runner).
protocol QRCodeSource: Sendable {
    func codes() -> AsyncStream<String>
}

/// Codes given in advance, one after another.
struct FixedCodes: QRCodeSource {
    var list: [String]

    init(_ list: String...) { self.list = list }

    func codes() -> AsyncStream<String> {
        let list = list
        return AsyncStream { continuation in
            for code in list { continuation.yield(code) }
            continuation.finish()
        }
    }
}

/// One scan, from the first code to its end (Android's LinkScan.kt and GuestScan.kt): signed in,
/// signing a computer in (peek shows which browser asks, then Approve or Deny); signed out, joining
/// as a guest (peek shows whose pass it is and for how long, then Join). A code that is not for this
/// purpose or this server, one that ran out or was used, and too many tries (429 and its
/// Retry-After: scans wait until then) each leave a note and the camera scanning on.
@MainActor @Observable
final class ScanFlow {
    enum Purpose: Equatable, Sendable {
        /// Signed in: the web sign-in page's code.
        case signInComputer
        /// Signed out: a guest pass.
        case joinAsGuest
    }

    enum Step: Equatable, Sendable {
        case scanning
        /// A code is being checked with ECHO.
        case checking
        /// A browser asks to be signed in.
        case computer(id: String, peek: LinkPeek)
        case approving(id: String, peek: LinkPeek)
        case approved(browser: String)
        /// Not approved: nothing was sent, and the request runs out by itself in two minutes.
        case denied
        /// A guest pass, before joining.
        case pass(code: String, peek: GuestPeek)
        case joining(code: String, peek: GuestPeek)
        /// Signed in as a guest: the app opens.
        case joined
    }

    let purpose: Purpose
    private(set) var step: Step = .scanning
    /// What to say under the frame: why the last code did not go.
    private(set) var note: String? = nil
    /// Too many tries: codes are not checked until then.
    private(set) var waitUntil: Date? = nil

    let session: Session
    private let now: () -> Date
    /// The last code that was refused, not checked again for a few seconds while the camera keeps
    /// seeing it.
    @ObservationIgnored private var refused: (text: String, at: Date)? = nil
    static let refusedFor: TimeInterval = 4

    init(purpose: Purpose, session: Session, now: @escaping () -> Date = Date.init) {
        self.purpose = purpose
        self.session = session
        self.now = now
    }

    /// A screen in a given state, for the demo screens: nothing here reaches the network.
    static func demo(purpose: Purpose, session: Session, step: Step, note: String? = nil) -> ScanFlow {
        let flow = ScanFlow(purpose: purpose, session: session)
        flow.step = step
        flow.note = note
        return flow
    }

    private var server: String { session.server }

    /// Checks every code the source sees, in turn, until it ends or the scan does.
    func listen(to source: some QRCodeSource) async {
        for await code in source.codes() {
            await scanned(code)
            if Task.isCancelled { break }
        }
    }

    /// A code the camera saw (or a link handed to the app).
    func scanned(_ text: String) async {
        guard step == .scanning else { return }
        if let waitUntil {
            if waitUntil > now() { return }
            self.waitUntil = nil
            note = nil
            refused = nil
        }
        if let refused, refused.text == text, now().timeIntervalSince(refused.at) < Self.refusedFor { return }
        switch (ScanPayload(text, server: session.client.base), purpose) {
        case (.signIn(let id), .signInComputer):
            await check(text) { .computer(id: id, peek: try await self.session.client.peekSignIn(id: id)) }
        case (.guest(let code), .joinAsGuest):
            await check(text) { .pass(code: code, peek: try await self.session.client.peekGuest(code: code)) }
        case (.guest, .signInComputer):
            refuse(text, session.isGuest
                ? "That's a guest pass. This phone has one already."
                : "That's a guest pass. To listen as a guest, sign out first, then scan it from the sign-in page.")
        case (.signIn, .joinAsGuest):
            refuse(text, "That's ECHO's sign-in code for a computer. Sign in on this phone first, then scan it from Settings.")
        case (.otherServer(let host), _):
            refuse(text, "That code is for \(host), not \(server).")
        case (.unknown, .signInComputer):
            refuse(text, "That isn't a sign-in code from \(server).")
        case (.unknown, .joinAsGuest):
            refuse(text, "That isn't a guest pass from \(server).")
        }
    }

    /// Signs the browser in.
    func approve() async {
        guard case .computer(let id, let peek) = step else { return }
        step = .approving(id: id, peek: peek)
        note = nil
        do {
            let browser = try await session.client.approveSignIn(id: id)
            step = .approved(browser: browser)
        } catch let error as PassError {
            if error == .expired {
                step = .scanning
                refused = nil
                note = expiredNote
            } else {
                step = .computer(id: id, peek: peek)
                show(error)
            }
        } catch {
            step = .computer(id: id, peek: peek)
            note = ApiError.unreachable.userMessage
        }
    }

    /// Not this one: nothing is sent; the browser's request runs out by itself.
    func deny() {
        guard case .computer = step else { return }
        step = .denied
        note = nil
    }

    /// Joins with the guest pass: this device signs in as the guest.
    func join() async {
        guard case .pass(let code, let peek) = step else { return }
        step = .joining(code: code, peek: peek)
        note = nil
        do {
            try await session.joinAsGuest(code: code)
            step = .joined
        } catch let error as PassError {
            if error == .expired {
                step = .scanning
                note = expiredNote
            } else {
                step = .pass(code: code, peek: peek)
                show(error)
            }
        } catch {
            step = .pass(code: code, peek: peek)
            note = ApiError.unreachable.userMessage
        }
    }

    /// Back to the camera (after Deny, Cancel or a sign-in done).
    func scanAgain() {
        step = .scanning
        note = nil
        refused = nil
    }

    private var expiredNote: String {
        purpose == .signInComputer
            ? "That code ran out. Reload the sign-in page and scan the new one."
            : "That guest pass ran out or was used already. Ask for a new one."
    }

    private func check(_ text: String, _ peek: () async throws -> Step) async {
        step = .checking
        note = nil
        do {
            step = try await peek()
            refused = nil
        } catch let error as PassError {
            step = .scanning
            refused = (text, now())
            if error == .expired { note = expiredNote } else { show(error) }
        } catch {
            step = .scanning
            refused = (text, now())
            note = ApiError.unreachable.userMessage
        }
    }

    private func refuse(_ text: String, _ message: String) {
        refused = (text, now())
        note = message
    }

    private func show(_ error: PassError) {
        switch error {
        case .rateLimited(let seconds):
            waitUntil = now().addingTimeInterval(TimeInterval(seconds))
            note = error.userMessage
        case .guest:
            note = "A guest pass can't sign a computer in."
        default:
            note = error.userMessage
        }
    }
}
