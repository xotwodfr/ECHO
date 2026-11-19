import Foundation
import Security
import Testing

// Signing in and out as the app does it (Session): the token kept for this device, who is signed
// in and their preferences loaded, a token the server refuses bringing the sign-in back from
// anywhere in the app, signing out revoking the token on the server; the Keychain's terms; and the
// offline state.

@Suite("Signing in and out")
@MainActor
struct AuthFlowTests {
    let stub = Stub()

    func session(_ tokens: TokenStorage) -> Session {
        Session(
            server: stub.base, tokens: tokens, http: stub.session, deviceName: { "ECHO for iPhone" }, cache: nil,
            watchNetwork: false)
    }

    @Test("Signing in keeps the token, then loads who is signed in and their preferences")
    func signIn() async throws {
        stub.on("POST", "/auth/device", .fixture("auth-device-created", status: 201))
        stub.on("GET", "/me", .fixture("me"))
        stub.on("GET", "/me/settings", .fixture("settings-saved"))
        let tokens = MemoryTokenStore()
        let s = session(tokens)
        #expect(s.phase == .signedOut)

        try await s.signIn(username: "ada", password: "correct horse battery staple", code: "123456")

        #expect(s.phase == .signedIn)
        let token = try #require(stored(tokens))
        #expect(token.hasPrefix("echo_dt_"))
        #expect(s.client.token == token)
        #expect(s.account == Account(username: "ada", role: "admin"))
        #expect(s.settings.appearance.theme == .glass)
        #expect(stub.requests("GET", "/me").first?.bearer == token)
        #expect(stub.requests("POST", "/auth/device").first?.json?["name"] as? String == "ECHO for iPhone")
    }

    @Test("Two-factor on and no code: nothing kept, the page asks for the code")
    func needsCode() async throws {
        stub.on("POST", "/auth/device", .fixture("auth-device-totp-required", status: 401))
        let tokens = MemoryTokenStore()
        let s = session(tokens)
        await #expect(throws: ApiError.totpRequired) {
            try await s.signIn(username: "ada", password: "correct horse battery staple", code: "")
        }
        #expect(s.phase == .signedOut)
        #expect(stored(tokens) == nil)
        #expect(s.notice == nil)
    }

    @Test("A token kept from last time signs in at start")
    func tokenAtStart() async throws {
        stub.on("GET", "/me", .fixture("me"))
        stub.on("GET", "/me/settings", .fixture("settings"))
        let s = session(MemoryTokenStore("echo_dt_kept"))
        #expect(s.phase == .signedIn)
        await s.refresh()
        #expect(s.account?.username == "ada")
        #expect(stub.requests.allSatisfy { $0.bearer == "echo_dt_kept" })
    }

    @Test("A refused token at start brings the sign-in back, saying why")
    func refusedAtStart() async throws {
        stub.on("GET", "/me", .fixture("unauthenticated", status: 401))
        stub.on("GET", "/me/settings", .fixture("unauthenticated", status: 401))
        let tokens = MemoryTokenStore("echo_dt_revoked")
        let s = session(tokens)
        await s.refresh()
        #expect(s.phase == .signedOut)
        #expect(s.notice == ApiError.signedOut.userMessage)
        #expect(stored(tokens) == nil)
        #expect(s.client.token == nil)
        #expect(s.account == nil)
    }

    @Test("A token refused anywhere in the app brings the sign-in back")
    func refusedAnywhere() async throws {
        stub.on("GET", "/navidrome/rest/getPlaylists", .fixture("unauthenticated", status: 401))
        let tokens = MemoryTokenStore("echo_dt_revoked")
        let s = session(tokens)
        await #expect(throws: ApiError.signedOut) { try await s.client.playlists() }
        let signedOut = await eventually { s.phase == .signedOut }
        #expect(signedOut)
        #expect(s.notice == ApiError.signedOut.userMessage)
        #expect(stored(tokens) == nil)
    }

    @Test("A late refusal of an old token does not sign out the new one")
    func staleRefusal() async throws {
        let tokens = MemoryTokenStore("echo_dt_new")
        let s = session(tokens)
        s.handle(.tokenRefused("echo_dt_old")) // a request that went out before signing in again
        #expect(s.phase == .signedIn)
        #expect(stored(tokens) == "echo_dt_new")
        s.handle(.tokenRefused("echo_dt_new"))
        #expect(s.phase == .signedOut)
    }

    @Test("Signing out revokes the token on the server and forgets it here")
    func signOut() async throws {
        stub.on("POST", "/auth/logout", .fixture("logout"))
        let tokens = MemoryTokenStore("echo_dt_mine")
        let s = session(tokens)
        await s.signOut()
        let sent = try #require(stub.requests("POST", "/auth/logout").first)
        #expect(sent.bearer == "echo_dt_mine")
        #expect(s.phase == .signedOut)
        #expect(s.notice == nil)
        #expect(stored(tokens) == nil)
        #expect(s.client.token == nil)
    }

    @Test("Offline, signing out still forgets the token here")
    func signOutOffline() async throws {
        stub.on("POST", "/auth/logout", .failure(.notConnectedToInternet))
        let tokens = MemoryTokenStore("echo_dt_mine")
        let s = session(tokens)
        await s.signOut()
        #expect(s.phase == .signedOut)
        #expect(stored(tokens) == nil)
    }

    @Test("No answer marks ECHO away; the next answer brings it back")
    func offlineState() async throws {
        stub.on("GET", "/me", .failure(.cannotConnectToHost), .fixture("me"))
        let s = session(MemoryTokenStore("echo_dt_test"))
        #expect(s.connectivity.status == .online)
        _ = try? await s.client.me()
        let away = await eventually { s.connectivity.status == .serverAway }
        #expect(away)
        #expect(s.phase == .signedIn) // no answer is not a refusal
        _ = try await s.client.me()
        let back = await eventually { s.connectivity.status == .online }
        #expect(back)
    }

    @Test("The device's network decides offline before ECHO does")
    func networkFirst() {
        let c = Connectivity(watchNetwork: false, probe: nil)
        c.networkChanged(false)
        #expect(c.status == .offline)
        c.serverAnswered(false)
        #expect(c.status == .offline)
        c.networkChanged(true)
        #expect(c.status == .serverAway)
        c.serverAnswered(true)
        #expect(c.status == .online)
        #expect(c.isOnline)
    }

    @Test("While ECHO is away, its health check is asked as soon as the network is back")
    func probesWhenNetworkReturns() async {
        let asked = Events()
        let c = Connectivity(watchNetwork: false, probe: { asked.record(.reachable(true)) })
        c.serverAnswered(false)
        c.networkChanged(false)
        c.networkChanged(true)
        let probed = await eventually { !asked.all.isEmpty }
        #expect(probed)
    }
}

/// What a store holds now.
func stored(_ tokens: TokenStorage) -> String? {
    (try? tokens.load()) ?? nil
}

@Suite("Keychain")
struct KeychainTests {
    @Test("The token is added for this device only, while unlocked, never synced")
    func terms() {
        let q = KeychainTokenStore(account: "https://echo.folk3s.com").addQuery("echo_dt_x")
        #expect(q[kSecClass as String] as? String == kSecClassGenericPassword as String)
        #expect(q[kSecAttrService as String] as? String == "com.folk3s.echo.device-token")
        #expect(q[kSecAttrAccount as String] as? String == "https://echo.folk3s.com")
        #expect(q[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
        #expect(q[kSecAttrSynchronizable as String] as? Bool == false)
        #expect(q[kSecValueData as String] as? Data == Data("echo_dt_x".utf8))
        #if os(macOS)
        #expect(q[kSecUseDataProtectionKeychain as String] as? Bool == true)
        #endif
    }

    @Test(
        "Saved, read back, replaced and forgotten",
        .enabled(if: KeychainTokenStore.dataProtectionKeychainWorks(), "this test host has no Keychain entitlement"))
    func roundTrip() throws {
        let store = KeychainTokenStore(
            account: "https://test-\(UUID().uuidString).invalid", service: "com.folk3s.echo.tests",
            fileKeychainFallback: false)
        defer { store.delete() }
        let empty = try store.load()
        #expect(empty == nil)
        try store.save("echo_dt_one")
        let one = try store.load()
        #expect(one == "echo_dt_one")
        try store.save("echo_dt_two")
        let two = try store.load()
        #expect(two == "echo_dt_two")
        store.delete()
        let gone = try store.load()
        #expect(gone == nil)
    }
}
