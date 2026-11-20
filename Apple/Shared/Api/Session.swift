import Foundation
import Observation
import os
#if os(iOS)
import UIKit
#endif

/// Signed in or not, who, and their preferences (the baseline every native client has, iOS/README.md):
/// sign in with the username, password and authenticator code in one request; the device token in
/// the Keychain as this device's alone; a token the server refuses (revoked in Sessions & devices,
/// idle 60 days) brings the sign-in back, wherever in the app the refusal came; signing out ends
/// this device's session on the server too.
@MainActor @Observable
final class Session {
    enum Phase: Equatable, Sendable {
        case signedOut
        case signedIn
        /// A token may be saved, but the device is locked and the Keychain keeps it closed (the app
        /// launched in the background): it is read once the device is unlocked.
        case locked
    }

    private(set) var phase: Phase
    private(set) var account: Account? = nil
    private(set) var settings: UserSettings
    /// Signed in with a guest pass (Guests/Passes.swift): it listens only, until the pass ends.
    private(set) var guest: GuestPass? = nil
    /// Why the sign-in page shows, when it is not the first time: the server refused the token.
    var notice: String? = nil

    let client: EchoClient
    let connectivity: Connectivity

    /// The server's name, as the sign-in page shows it.
    var server: String { client.base.host() ?? client.base.absoluteString }

    private let tokens: TokenStorage
    private let deviceName: () -> String
    private let cache: UserDefaults?
    private let isDemo: Bool
    @ObservationIgnored private var events: Task<Void, Never>? = nil
    @ObservationIgnored private var unlock: Task<Void, Never>? = nil

    private static let log = Logger(subsystem: "com.folk3s.echo", category: "session")
    private static let settingsKey = "echo.settings"
    private static let accountKey = "echo.account"
    private static let guestKey = "echo.guest"

    /// - Parameters:
    ///   - cache: where the account's name and preferences are kept for the next start (offline,
    ///     before the server answers); nil keeps nothing.
    ///   - watchNetwork: follow the device's network for the offline state.
    init(
        server: URL,
        tokens: TokenStorage,
        http: URLSession = .shared,
        deviceName: @escaping () -> String,
        cache: UserDefaults? = .standard,
        watchNetwork: Bool = true,
        demo: Bool = false,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        var token: String?
        var phase = Phase.signedOut
        do {
            token = try tokens.load()
            phase = token == nil ? .signedOut : .signedIn
        } catch TokenStoreError.locked {
            phase = .locked
        } catch {
            Session.log.error("The Keychain did not give the token: \(String(describing: error), privacy: .public)")
        }
        let (stream, continuation) = AsyncStream.makeStream(of: ClientEvent.self)
        let client = EchoClient(
            base: server, token: token, http: http, sleep: sleep, onEvent: { continuation.yield($0) })
        self.client = client
        var probe: (@Sendable () async -> Void)?
        if !demo { probe = { _ = try? await client.health() } }
        self.connectivity = Connectivity(watchNetwork: watchNetwork, probe: probe)
        self.tokens = tokens
        self.deviceName = deviceName
        self.cache = demo ? nil : cache
        self.isDemo = demo
        self.phase = phase
        self.settings = UserSettings()
        if phase == .signedIn, let cache = self.cache {
            settings = Session.cached(UserSettings.self, Session.settingsKey, in: cache) ?? UserSettings()
            account = Session.cached(Account.self, Session.accountKey, in: cache)
            guest = Session.cached(GuestPass.self, Session.guestKey, in: cache)
        }
        events = Task { [weak self] in
            for await event in stream { self?.handle(event) }
        }
        if phase == .locked { waitForUnlock() }
    }

    // MARK: - Signing in and out

    /// Signs this device in. Throws ApiError for the page to show: `.totpRequired` when the account
    /// has two-factor and no code came, `.badCode`, `.wrongCredentials`, `.tooManyAttempts`, or no
    /// answer (`.offline`, `.unreachable`).
    func signIn(username: String, password: String, code: String) async throws {
        let token = try await client.signIn(
            username: username, password: password, code: code, deviceName: deviceName())
        do {
            try tokens.save(token)
        } catch {
            // Signed in all the same; only the next start will ask again.
            Self.log.error("The Keychain did not keep the token: \(String(describing: error), privacy: .public)")
        }
        client.setToken(token)
        notice = nil
        phase = .signedIn
        await refresh()
    }

    /// Joins with a guest pass (a scanned code, or an `echo://guest` link): a guest account and a
    /// device token for this device, which listens only until the pass ends. Throws PassError.
    func joinAsGuest(code: String) async throws {
        let joined = try await client.redeemGuest(code: code, deviceName: deviceName())
        do {
            try tokens.save(joined.token)
        } catch {
            Self.log.error("The Keychain did not keep the guest token: \(String(describing: error), privacy: .public)")
        }
        client.setToken(joined.token)
        notice = nil
        let account = Account(username: joined.username, role: "user")
        self.account = account
        guest = joined.pass
        keep(account, Self.accountKey)
        keep(joined.pass, Self.guestKey)
        phase = .signedIn
        await refresh()
    }

    /// Whether this device listens with a guest pass: no hearts, playlists, Wanted, inviting or
    /// signing a computer in (the server's GUEST_DENY, auth/routes.ts).
    var isGuest: Bool { guest != nil }

    /// Signs out here and on the server: this device leaves Sessions & devices. Offline, the token
    /// is forgotten here all the same (it can be ended from Sessions & devices on the web).
    func signOut() async {
        if phase == .signedIn, !isDemo {
            do {
                try await client.signOut()
            } catch {
                Self.log.notice("Sign-out did not reach ECHO: \(String(describing: error), privacy: .public)")
            }
        }
        signedOutHere(notice: nil)
    }

    /// Who is signed in and their preferences, from the server: after signing in and at each start.
    /// Offline, the ones kept from last time stay.
    func refresh() async {
        guard phase == .signedIn, !isDemo else { return }
        do {
            async let me = client.me()
            async let settings = client.settings()
            let (account, loaded) = try await (me, settings)
            guard phase == .signedIn else { return }
            self.account = account
            self.settings = loaded
            keep(account, Self.accountKey)
            keep(loaded, Self.settingsKey)
        } catch ApiError.signedOut {
            tokenRefused()
            return
        } catch {
            Self.log.notice("Could not refresh the account: \(String(describing: error), privacy: .public)")
        }
        // A guest pass, or none (one kept since may have been made a normal account). An older
        // server without guests, or no answer, leaves what was known.
        do {
            let pass = try await client.guestPass()
            guard phase == .signedIn else { return }
            guest = pass
            if let pass { keep(pass, Self.guestKey) } else { cache?.removeObject(forKey: Self.guestKey) }
        } catch {
            Self.log.notice("Could not read the guest pass: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Preferences

    /// Changes preferences here at once and then on the server, which keeps them for every device;
    /// if it refuses, they go back as they were and the error is thrown.
    func updateSettings(_ change: (inout UserSettings) -> Void) async throws {
        let before = settings
        var after = settings
        change(&after)
        guard let patch = try after.patch(from: before) else { return }
        settings = after
        if isDemo { return }
        do {
            let saved = try await client.updateSettings(patch)
            settings = saved
            keep(saved, Self.settingsKey)
        } catch {
            settings = before
            if (error as? ApiError) == .signedOut { tokenRefused() }
            throw error
        }
    }

    // MARK: - What the client reports

    /// What the client reported (internal for the tests).
    func handle(_ event: ClientEvent) {
        switch event {
        case .reachable(let up):
            connectivity.serverAnswered(up)
        case .tokenRefused(let token):
            // Only the token in use: a late answer to one signed out already changes nothing.
            if client.token == token { tokenRefused() }
        }
    }

    /// The server refused the token: back to the sign-in page, saying why.
    private func tokenRefused() {
        guard phase == .signedIn else { return }
        Self.log.notice("ECHO refused the device token; signing in again")
        // A guest's account is deleted when its time is up.
        signedOutHere(notice: guest == nil ? ApiError.signedOut.userMessage : Self.passEnded)
    }

    private func signedOutHere(notice: String?) {
        tokens.delete()
        client.setToken(nil)
        account = nil
        guest = nil
        settings = UserSettings()
        cache?.removeObject(forKey: Self.settingsKey)
        cache?.removeObject(forKey: Self.accountKey)
        cache?.removeObject(forKey: Self.guestKey)
        self.notice = notice
        phase = .signedOut
    }

    /// Locked at launch: the token is read once the device is unlocked.
    private func waitForUnlock() {
        #if os(iOS)
        unlock = Task { [weak self] in
            for await _ in NotificationCenter.default.notifications(
                named: UIApplication.protectedDataDidBecomeAvailableNotification)
            {
                self?.tokenReadable()
                break
            }
        }
        #endif
    }

    static let passEnded = "Your guest pass has ended. Ask for a new one, or sign in."

    func tokenReadable() {
        guard phase == .locked else { return }
        let token = try? tokens.load()
        client.setToken(token)
        phase = token == nil ? .signedOut : .signedIn
        if phase == .signedIn { Task { await refresh() } }
    }

    // MARK: - Kept for the next start

    private func keep(_ value: some Encodable, _ key: String) {
        guard let cache, let data = try? JSONEncoder().encode(value) else { return }
        cache.set(data, forKey: key)
    }

    private static func cached<T: Decodable>(_ type: T.Type, _ key: String, in cache: UserDefaults) -> T? {
        cache.data(forKey: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }
}

// MARK: - The preview (-ECHODemo)

extension Session {
    /// A session that never calls the server: the preview's sign-in page and the app around it.
    static func demo(server: URL, signedIn: Bool, serverAway: Bool = false, guest: GuestPass? = nil) -> Session {
        let session = Session(
            server: server, tokens: MemoryTokenStore(signedIn ? "echo_dt_demo" : nil), deviceName: { "Preview" },
            cache: nil, watchNetwork: false, demo: true)
        if signedIn { session.account = Account(username: guest == nil ? "ada" : "guest-4f1c2a", role: "user") }
        session.guest = guest
        if serverAway { session.connectivity.serverAnswered(false) }
        return session
    }
}
