import Foundation
import Testing

// Signing a computer in by scanning its code, and guest passes, against ECHO's recorded answers
// (src/server/qrlogin.ts, src/server/guests.ts; scripts/apple-fixtures.ts): what a scanned code
// holds, the scan from peek to Approve or Deny, a code run out or used, too many tries; joining as a
// guest and the limits that puts on the app; inviting, listing and ending guests; guest links.

private let server = URL(string: "https://echo.folk3s.com")!

@Suite("What a scanned code holds")
struct ScanPayloadTests {
    @Test("The web sign-in page's code and a guest pass, for this server")
    func ours() {
        #expect(ScanPayload("https://echo.folk3s.com/link#qr-request-for-tests-0001", server: server)
            == .signIn(id: "qr-request-for-tests-0001"))
        #expect(ScanPayload("https://echo.folk3s.com/guest#guest-code-for-tests-0001", server: server)
            == .guest(code: "guest-code-for-tests-0001"))
        // As a scanner may hand it over: the host in capitals, spaces around it.
        #expect(ScanPayload("  https://ECHO.folk3s.com/link#AbC_dEf-0123456789xyz\n", server: server)
            == .signIn(id: "AbC_dEf-0123456789xyz"))
        #expect(ScanPayload("echo://guest#guest-code-for-tests-0001", server: server)
            == .guest(code: "guest-code-for-tests-0001"))
    }

    @Test("Another ECHO's code says whose it is")
    func otherServer() {
        #expect(ScanPayload("https://music.example.org/link#qr-request-for-tests-0001", server: server)
            == .otherServer(host: "music.example.org"))
        #expect(ScanPayload("https://echo.folk3s.com:8443/guest#guest-code-for-tests-0001", server: server)
            == .otherServer(host: "echo.folk3s.com"))
        #expect(ScanPayload("http://echo.folk3s.com/link#qr-request-for-tests-0001", server: server)
            == .otherServer(host: "echo.folk3s.com"))
    }

    @Test("Anything else is not a code: other pages, broken codes, Wi-Fi, text")
    func junk() {
        for text in [
            "https://echo.folk3s.com/link#short",
            "https://echo.folk3s.com/link#has spaces in it, sixteen+",
            "https://echo.folk3s.com/link",
            "https://echo.folk3s.com/album/al-1#qr-request-for-tests-0001",
            "https://echo.folk3s.com/link#" + String(repeating: "a", count: 65),
            "WIFI:S:Harbour;T:WPA;P:lamplight;;",
            "hello",
            "",
            "echo://now-playing#qr-request-for-tests-0001",
        ] {
            #expect(ScanPayload(text, server: server) == .unknown, "\(text)")
        }
    }

    @Test("Guest links into the app: echo://guest#code, /code or ?code=; others are not")
    func links() throws {
        let code = "guest-code-for-tests-0001"
        for text in ["echo://guest#\(code)", "echo://guest/\(code)", "echo://guest?code=\(code)", "ECHO://Guest#\(code)"] {
            #expect(AppLink(try #require(URL(string: text))) == .guest(code: code), "\(text)")
        }
        #expect(AppLink.guest(code: code).url.absoluteString == "echo://guest#\(code)")
        #expect(AppLink(AppLink.guest(code: code).url) == .guest(code: code))
        #expect(ScanPayload(AppLink.guest(code: code).url.absoluteString, server: server) == .guest(code: code))
        #expect(AppLink(try #require(URL(string: "echo://guest#short"))) == nil)
        #expect(AppLink(try #require(URL(string: "echo://guest"))) == nil)
        #expect(AppLink(try #require(URL(string: "echo://now-playing"))) == .nowPlaying)
    }

    @Test("Times as people say them")
    func texts() {
        #expect(PassText.duration(ms: 3_600_000) == "1 hour")
        #expect(PassText.duration(ms: 86_400_000) == "1 day")
        #expect(PassText.duration(ms: 604_800_000) == "1 week")
        #expect(PassText.duration(ms: 3 * 86_400_000) == "3 days")
        let now = Date(timeIntervalSince1970: 0)
        #expect(PassText.left(until: now.addingTimeInterval(42 * 60 + 30), now: now) == "42 min left")
        #expect(PassText.left(until: now.addingTimeInterval(18.4 * 3600), now: now) == "18 h left")
        #expect(PassText.left(until: now.addingTimeInterval(5.2 * 86400), now: now) == "5 days left")
        #expect(PassText.left(until: now.addingTimeInterval(-10), now: now) == "0 min left")
        #expect(PassText.clock(581) == "9:41")
        #expect(GuestLength.allCases.map(\.rawValue) == [3_600_000, 86_400_000, 604_800_000])
    }
}

@Suite("Signing a computer in")
@MainActor
struct SignInComputerTests {
    let stub = Stub()
    let clock = TestClock()

    func session(_ token: String? = "echo_dt_test") -> Session {
        Session(
            server: stub.base, tokens: MemoryTokenStore(token), http: stub.session, deviceName: { "ECHO for iPhone" },
            cache: nil, watchNetwork: false)
    }

    func flow(_ session: Session) -> ScanFlow {
        ScanFlow(purpose: .signInComputer, session: session, now: { [clock] in clock.now })
    }

    func link(_ id: String = "qr-request-for-tests-0001") -> String { "\(stub.base.absoluteString)/link#\(id)" }

    @Test("A scanned code shows which browser asks; Approve signs it in")
    func approve() async throws {
        stub.on("POST", "/auth/qr/peek", .fixture("qr-peek"))
        stub.on("POST", "/auth/qr/approve", .fixture("qr-approve"))
        let f = flow(session())
        await f.scanned(link())
        guard case .computer(let id, let peek) = f.step else { Issue.record("not asking: \(f.step)"); return }
        #expect(id == "qr-request-for-tests-0001")
        #expect(peek == LinkPeek(browser: "Chrome on Windows", ip: "203.0.113.0/24", expiresAt: 1_800_001_415_000))
        let sentPeek = try #require(stub.requests("POST", "/auth/qr/peek").first)
        #expect(sentPeek.json?["id"] as? String == "qr-request-for-tests-0001")
        #expect(sentPeek.bearer == "echo_dt_test")

        // The camera keeps seeing the code: nothing more is asked while the browser waits.
        await f.scanned(link())
        #expect(stub.requests("POST", "/auth/qr/peek").count == 1)

        await f.approve()
        #expect(f.step == .approved(browser: "Chrome on Windows"))
        #expect(stub.requests("POST", "/auth/qr/approve").first?.json?["id"] as? String == "qr-request-for-tests-0001")
        #expect(f.note == nil)
    }

    @Test("Deny sends nothing: the request runs out by itself")
    func deny() async {
        stub.on("POST", "/auth/qr/peek", .fixture("qr-peek"))
        let f = flow(session())
        await f.scanned(link())
        f.deny()
        #expect(f.step == .denied)
        #expect(stub.requests("POST", "/auth/qr/approve").isEmpty)
        f.scanAgain()
        #expect(f.step == .scanning)
    }

    @Test("A code run out, or used already, says to reload the page; the camera scans on")
    func expired() async {
        stub.on("POST", "/auth/qr/peek", .fixture("qr-peek-expired", status: 404))
        let f = flow(session())
        await f.scanned(link())
        #expect(f.step == .scanning)
        #expect(f.note == "That code ran out. Reload the sign-in page and scan the new one.")
        // The same code still in front of the camera is not asked about again at once…
        await f.scanned(link())
        #expect(stub.requests("POST", "/auth/qr/peek").count == 1)
        // …but is a few seconds later (the page may have been reloaded behind it).
        clock.advance(ScanFlow.refusedFor + 1)
        await f.scanned(link())
        #expect(stub.requests("POST", "/auth/qr/peek").count == 2)
    }

    @Test("Approved elsewhere in the meantime: Approve finds it used and goes back to scanning")
    func usedOnApprove() async {
        stub.on("POST", "/auth/qr/peek", .fixture("qr-peek"))
        stub.on("POST", "/auth/qr/approve", .fixture("qr-approve-used", status: 404))
        let f = flow(session())
        await f.scanned(link())
        await f.approve()
        #expect(f.step == .scanning)
        #expect(f.note == "That code ran out. Reload the sign-in page and scan the new one.")
    }

    @Test("Too many tries: the wait Retry-After gives, no code checked until it is over")
    func rateLimited() async {
        stub.on(
            "POST", "/auth/qr/peek", .fixture("rate-limited", status: 429, headers: ["Retry-After": "20"]), .fixture("qr-peek"))
        let f = flow(session())
        await f.scanned(link())
        #expect(f.step == .scanning)
        #expect(f.note == "Too many tries. Try again in 20 s.")
        #expect(f.waitUntil == clock.now.addingTimeInterval(20))
        clock.advance(10)
        await f.scanned(link("qr-request-for-tests-0002"))
        #expect(stub.requests("POST", "/auth/qr/peek").count == 1)
        clock.advance(11)
        await f.scanned(link("qr-request-for-tests-0002"))
        #expect(stub.requests("POST", "/auth/qr/peek").count == 2)
        #expect(f.waitUntil == nil)
        guard case .computer = f.step else { Issue.record("not asking: \(f.step)"); return }
    }

    @Test("A 429 without Retry-After waits a minute; a write is never repeated")
    func rateLimitedNoHeader() async {
        stub.on("POST", "/auth/qr/approve", .fixture("rate-limited", status: 429))
        stub.on("POST", "/auth/qr/peek", .fixture("qr-peek"))
        let f = flow(session())
        await f.scanned(link())
        await f.approve()
        guard case .computer = f.step else { Issue.record("not asking: \(f.step)"); return }
        #expect(f.note == "Too many tries. Try again in a minute.")
        #expect(stub.requests("POST", "/auth/qr/approve").count == 1)
    }

    @Test("A guest pass, another server's code or anything else: a note, nothing asked")
    func notASignInCode() async {
        let f = flow(session())
        await f.scanned("\(stub.base.absoluteString)/guest#guest-code-for-tests-0001")
        #expect(f.note == "That's a guest pass. To listen as a guest, sign out first, then scan it from the sign-in page.")
        await f.scanned("https://music.example.org/link#qr-request-for-tests-0001")
        #expect(f.note == "That code is for music.example.org, not \(stub.host).")
        await f.scanned("WIFI:S:Harbour;T:WPA;P:lamplight;;")
        #expect(f.note == "That isn't a sign-in code from \(stub.host).")
        #expect(f.step == .scanning)
        #expect(stub.requests.isEmpty)
    }

    @Test("A guest cannot sign a computer in (403 guest)")
    func guestRefused() async {
        stub.on("POST", "/auth/qr/peek", .fixture("guest-denied-qr", status: 403))
        let f = flow(session())
        await f.scanned(link())
        #expect(f.step == .scanning)
        #expect(f.note == "A guest pass can't sign a computer in.")
    }

    @Test("No answer from ECHO: the note says so, and the code can be tried again")
    func unreachable() async {
        stub.on("POST", "/auth/qr/peek", .failure(.timedOut))
        let f = flow(session())
        await f.scanned(link())
        #expect(f.step == .scanning)
        #expect(f.note == ApiError.unreachable.userMessage)
    }

    @Test("Codes from a source (the camera's stand-in) are checked in turn")
    func fromSource() async {
        stub.on("POST", "/auth/qr/peek", .fixture("qr-peek"))
        let f = flow(session())
        await f.listen(to: FixedCodes("hello", link()))
        guard case .computer = f.step else { Issue.record("not asking: \(f.step)"); return }
        #expect(stub.requests("POST", "/auth/qr/peek").count == 1)
    }
}

@Suite("Guest passes")
@MainActor
struct GuestPassTests {
    let stub = Stub()

    func session(_ token: String? = nil, cache: UserDefaults? = nil) -> Session {
        Session(
            server: stub.base, tokens: MemoryTokenStore(token), http: stub.session, deviceName: { "ECHO for iPhone" },
            cache: cache, watchNetwork: false)
    }

    var pass: String { "\(stub.base.absoluteString)/guest#guest-code-for-tests-0001" }

    @Test("Signed out: a scanned pass shows whose it is; Join signs in as the guest, listening only")
    func join() async throws {
        stub.on("POST", "/guests/peek", .fixture("guest-peek"))
        stub.on("POST", "/guests/redeem", .fixture("guest-redeem", status: 201))
        stub.on("GET", "/me", .fixture("me-guest"))
        stub.on("GET", "/me/settings", .fixture("settings"))
        stub.on("GET", "/guests/me", .fixture("guests-me-guest"))
        let tokens = MemoryTokenStore()
        let s = Session(
            server: stub.base, tokens: tokens, http: stub.session, deviceName: { "ECHO for iPhone" }, cache: nil,
            watchNetwork: false)
        let f = ScanFlow(purpose: .joinAsGuest, session: s)
        await f.scanned(pass)
        #expect(f.step == .pass(code: "guest-code-for-tests-0001", peek: GuestPeek(invitedBy: "ada", durationMs: 86_400_000)))
        // No sign-in yet: the code is the secret.
        #expect(stub.requests("POST", "/guests/peek").first?.bearer == nil)

        await f.join()
        #expect(f.step == .joined)
        let redeem = try #require(stub.requests("POST", "/guests/redeem").first?.json)
        #expect(redeem["code"] as? String == "guest-code-for-tests-0001")
        #expect(redeem["name"] as? String == "ECHO for iPhone")
        #expect(s.phase == .signedIn)
        #expect(try tokens.load() == "echo_dt_test_token_not_a_secret")
        #expect(s.client.token == "echo_dt_test_token_not_a_secret")
        #expect(s.isGuest)
        #expect(s.guest?.invitedBy == "ada")
        #expect(s.guest?.ends == Date(timeIntervalSince1970: 1_800_087_695))
        #expect(s.account?.username.hasPrefix("guest-") == true)
        #expect(stub.requests("GET", "/guests/me").first?.bearer == "echo_dt_test_token_not_a_secret")
    }

    @Test("A pass used already or run out: a note, still signed out")
    func used() async {
        stub.on("POST", "/guests/peek", .fixture("guest-peek"))
        stub.on("POST", "/guests/redeem", .fixture("guest-redeem-used", status: 404))
        let s = session()
        let f = ScanFlow(purpose: .joinAsGuest, session: s)
        await f.scanned(pass)
        await f.join()
        #expect(f.step == .scanning)
        #expect(f.note == "That guest pass ran out or was used already. Ask for a new one.")
        #expect(s.phase == .signedOut)
        #expect(!s.isGuest)
    }

    @Test("Peeking too often from one address (429, no Retry-After): wait a minute")
    func peekLimited() async {
        stub.on("POST", "/guests/peek", .fixture("guest-peek-rate-limited", status: 429))
        let f = ScanFlow(purpose: .joinAsGuest, session: session())
        await f.scanned(pass)
        #expect(f.note == "Too many tries. Try again in a minute.")
        #expect(f.waitUntil != nil)
    }

    @Test("Signed out, a computer's sign-in code says to sign in first")
    func signInCodeWhenSignedOut() async {
        let f = ScanFlow(purpose: .joinAsGuest, session: session())
        await f.scanned("\(stub.base.absoluteString)/link#qr-request-for-tests-0001")
        #expect(f.note == "That's ECHO's sign-in code for a computer. Sign in on this phone first, then scan it from Settings.")
        await f.scanned("https://example.org/menu")
        #expect(f.note == "That isn't a guest pass from \(stub.host).")
        #expect(stub.requests.isEmpty)
    }

    @Test("A guest link opened while signed in says to sign out first, and redeems nothing")
    func linkWhileSignedIn() async {
        let f = ScanFlow(purpose: .signInComputer, session: session("echo_dt_test"))
        await f.scanned(AppLink.guest(code: "guest-code-for-tests-0001").url.absoluteString)
        #expect(f.note?.hasPrefix("That's a guest pass.") == true)
        #expect(stub.requests.isEmpty)
    }

    @Test("At start, the guest pass is read: a guest, or a normal account (none)")
    func refreshReadsPass() async {
        stub.on("GET", "/me", .fixture("me-guest"))
        stub.on("GET", "/me/settings", .fixture("settings"))
        stub.on("GET", "/guests/me", .fixture("guests-me-guest"), .fixture("guests-me-none"))
        let s = session("echo_dt_test")
        await s.refresh()
        #expect(s.guest == GuestPass(expiresAt: 1_800_087_695_000, invitedBy: "ada", keep: nil))
        // Kept as a normal account (its request to stay approved): no longer a guest.
        await s.refresh()
        #expect(s.guest == nil)
    }

    @Test("A server that does not answer for the pass leaves what was known")
    func passUnknown() async {
        stub.on("GET", "/me", .fixture("me"))
        stub.on("GET", "/me/settings", .fixture("settings"))
        let s = session("echo_dt_test")
        await s.refresh()
        #expect(s.account?.username == "ada")
        #expect(!s.isGuest)
    }

    @Test("A guest's pass kept for the next start, and its end brings the sign-in back, saying so")
    func passEnds() async throws {
        let defaults = try #require(UserDefaults(suiteName: "guest-tests-\(UUID().uuidString)"))
        stub.on("GET", "/me", .fixture("me-guest"), .fixture("unauthenticated", status: 401))
        stub.on("GET", "/me/settings", .fixture("settings"), .fixture("unauthenticated", status: 401))
        stub.on("GET", "/guests/me", .fixture("guests-me-guest"))
        let s = session("echo_dt_test", cache: defaults)
        await s.refresh()
        #expect(s.isGuest)
        // The next start knows it is a guest before the server answers.
        let again = session("echo_dt_test", cache: defaults)
        #expect(again.guest?.invitedBy == "ada")
        // The time is up: the server deleted the account, and the token with it.
        await s.refresh()
        #expect(s.phase == .signedOut)
        #expect(s.notice == Session.passEnded)
        #expect(!s.isGuest)
        let afterwards = session("echo_dt_test", cache: defaults)
        #expect(afterwards.guest == nil)
    }

    @Test("A guest's library listens only: hearts and the Wanted list are refused here, the server never asked")
    func listensOnly() async {
        let client = EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session)
        let lib = Library(source: client, images: ImageLoader(fetch: { try await client.fetch($0) }), defaults: nil)
        lib.listensOnly = true
        let track = Track(
            id: "al-1-t1", title: "Harbour Lights 1", artists: [ArtistRef(id: "ar-1", name: "Lowfield")],
            album: AlbumRef(id: "al-1", title: "Harbour Lights", key: "navidrome:al-1"), durationMs: 20000)
        await lib.setLiked(track, true)
        await lib.setSaved(Album(id: "al-1", title: "Harbour Lights", artist: "Lowfield"), true)
        await lib.setFollowing(Artist(id: "ar-1", name: "Lowfield"), true)
        await lib.addWanted("Lowfield Harbour Lights")
        #expect(!lib.isLiked(track))
        #expect(!lib.isSaved("al-1"))
        #expect(!lib.isFollowing("ar-1"))
        #expect(lib.toast?.message == ApiError.guestNotAllowed.userMessage)
        #expect(stub.requests.isEmpty)
    }

    @Test("What the server refuses a guest is read as such (403 guest)")
    func guestDenied() async {
        stub.on("POST", "/guests/codes", .fixture("guest-denied-codes", status: 403))
        let client = EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session)
        await #expect(throws: PassError.guest) { try await client.createGuestCode(.hour) }
    }
}

@Suite("Inviting guests")
@MainActor
struct InviteTests {
    let stub = Stub()

    func invites() -> GuestInvites {
        GuestInvites(client: EchoClient(base: stub.base, token: "echo_dt_test", http: stub.session), sleep: { _ in })
    }

    @Test("An invite for a day: its code, the QR's link, ten minutes to scan it")
    func invite() async throws {
        stub.on("POST", "/guests/codes", .fixture("guest-code", status: 201))
        let i = invites()
        await i.invite(.day)
        let code = try #require(i.code)
        #expect(code.code == "guest-code-for-tests-0001")
        #expect(code.url == "http://localhost/guest#guest-code-for-tests-0001")
        #expect(code.durationMs == 86_400_000)
        #expect(code.expires == Date(timeIntervalSince1970: 1_800_001_895))
        #expect(stub.requests("POST", "/guests/codes").first?.json?["durationMs"] as? Int == 86_400_000)
        #expect(i.length == .day)
        #expect(i.inviteError == nil)
        #expect(!i.making)
    }

    @Test("Five codes waiting: the sixth is refused, saying why")
    func tooMany() async {
        stub.on("POST", "/guests/codes", .fixture("guest-code-too-many", status: 429))
        let i = invites()
        await i.invite(.hour)
        #expect(i.code == nil)
        #expect(i.inviteError == "You have five codes waiting. Let them run out first.")
    }

    @Test("While the code shows, a guest joining is noticed")
    func joined() async throws {
        stub.on("POST", "/guests/codes", .fixture("guest-code", status: 201))
        stub.on("GET", "/guests", .fixture("guests-empty"), .fixture("guests-empty"), .fixture("guests"))
        let i = invites()
        await i.invite(.day)
        await i.watchForJoin(now: { Date(timeIntervalSince1970: 1_800_001_300) })
        #expect(i.joined?.hasPrefix("guest-") == true)
        #expect(i.guests.count == 1)
        #expect(stub.requests("GET", "/guests").count == 3)
    }

    @Test("A code run out stops the watch")
    func watchEnds() async {
        stub.on("POST", "/guests/codes", .fixture("guest-code", status: 201))
        stub.on("GET", "/guests", .fixture("guests-empty"))
        let i = invites()
        await i.invite(.day)
        await i.watchForJoin(now: { Date(timeIntervalSince1970: 1_800_002_000) })
        #expect(i.joined == nil)
        #expect(stub.requests("GET", "/guests").isEmpty)
    }

    @Test("The guests listed with their time; End now takes one off, as does one gone already")
    func listAndEnd() async throws {
        stub.on("GET", "/guests", .fixture("guests"))
        stub.on("POST", "/guests/2/end", .fixture("guest-end"), .fixture("guest-end-not-found", status: 404))
        let i = invites()
        await i.load()
        #expect(i.state == .ready)
        let guest = try #require(i.guests.first)
        #expect(guest.id == 2)
        #expect(guest.invitedBy == "ada")
        #expect(guest.ends == Date(timeIntervalSince1970: 1_800_087_695))
        #expect(guest.keep == nil)
        await i.end(guest)
        #expect(i.guests.isEmpty)
        #expect(stub.requests("POST", "/guests/2/end").count == 1)
        await i.load()
        await i.end(guest)
        #expect(i.guests.isEmpty)
        #expect(i.note == nil)
    }

    @Test("A guest asking to stay is approved, and the list reloads")
    func keep() async throws {
        stub.on("GET", "/guests", .body(#"[{"id":3,"username":"guest-0a0b0c","invitedBy":"ada","createdAt":1,"expiresAt":1800087695000,"keep":{"username":"sam","requestedAt":2}}]"#), .fixture("guests-empty"))
        stub.on("POST", "/guests/3/approve", .body(#"{"ok":true,"username":"sam"}"#))
        let i = invites()
        await i.load()
        let guest = try #require(i.guests.first)
        #expect(guest.keep?.username == "sam")
        await i.keep(guest)
        #expect(stub.requests("POST", "/guests/3/approve").count == 1)
        #expect(i.guests.isEmpty)
    }

    @Test("The list that cannot load says why")
    func listFails() async {
        stub.on("GET", "/guests", .failure(.timedOut))
        let i = invites()
        await i.load()
        #expect(i.state == .failed(.unreachable))
    }
}
