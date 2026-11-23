import Foundation
import Testing

// The API client against ECHO's recorded answers: the device sign-in in one request, the bearer
// header on every request, ECHO's errors as typed values, the API budget's 429 as the web client
// answers it (src/client/api.ts), no answer at all as offline or unreachable, signed stream URLs
// and covers.

@Suite("API client")
struct ApiClientTests {
    let stub = Stub()
    let events = Events()
    let sleeps = Sleeps()

    func client(token: String? = "echo_dt_test") -> EchoClient {
        EchoClient(
            base: stub.base, token: token, http: stub.session, sleep: sleeps.sleep, jitter: { 0.5 },
            onEvent: events.record)
    }

    // MARK: Signing in

    @Test("Sign-in sends the username, password, code and device name in one request")
    func signInOneRequest() async throws {
        stub.on("POST", "/auth/device", .fixture("auth-device-created", status: 201))
        let token = try await client(token: nil).signIn(
            username: " ada ", password: "correct horse battery staple", code: "123 456", deviceName: "ECHO for iPhone")
        #expect(token.hasPrefix("echo_dt_"))
        let sent = try #require(stub.requests("POST", "/auth/device").first)
        let body = try #require(sent.json)
        #expect(body["username"] as? String == "ada")
        #expect(body["password"] as? String == "correct horse battery staple")
        #expect(body["code"] as? String == "123456")
        #expect(body["name"] as? String == "ECHO for iPhone")
        #expect(sent.headers["Content-Type"] == "application/json")
        #expect(sent.bearer == nil)
        #expect(stub.requests.count == 1)
    }

    @Test("Without a code, none is sent (the server then asks for one)")
    func signInWithoutCode() async throws {
        stub.on("POST", "/auth/device", .fixture("auth-device-totp-required", status: 401))
        await #expect(throws: ApiError.totpRequired) {
            try await client(token: nil).signIn(username: "ada", password: "pw", code: "  ", deviceName: "Phone")
        }
        let body = try #require(stub.requests.first?.json)
        #expect(body["code"] == nil)
        // A refused sign-in is not a refused token.
        #expect(!events.all.contains { if case .tokenRefused = $0 { true } else { false } })
    }

    @Test("A long device name is cut to the server's 64 characters")
    func deviceNameLimit() async throws {
        stub.on("POST", "/auth/device", .fixture("auth-device-created", status: 201))
        _ = try await client(token: nil).signIn(
            username: "ada", password: "pw", code: nil, deviceName: String(repeating: "x", count: 100))
        #expect((stub.requests.first?.json?["name"] as? String)?.count == 64)
    }

    @Test("Each refused sign-in says why", arguments: [
        ("auth-device-bad-code", 401, ApiError.badCode),
        ("auth-device-wrong-password", 401, ApiError.wrongCredentials),
        ("rate-limited", 429, ApiError.tooManyAttempts),
    ])
    func signInRefusals(fixture: String, status: Int, expected: ApiError) async throws {
        stub.on("POST", "/auth/device", .fixture(fixture, status: status))
        await #expect(throws: expected) {
            try await client(token: nil).signIn(username: "ada", password: "pw", code: "000000", deviceName: "Phone")
        }
        // The sign-in limits are never asked again (they send no Retry-After).
        #expect(stub.requests.count == 1)
    }

    @Test("Signing out revokes the token on the server")
    func signOut() async throws {
        stub.on("POST", "/auth/logout", .fixture("logout"))
        try await client().signOut()
        let sent = try #require(stub.requests("POST", "/auth/logout").first)
        #expect(sent.bearer == "echo_dt_test")
    }

    // MARK: Every request

    @Test("Every request carries the device token as a bearer header")
    func bearerOnEveryRequest() async throws {
        stub.on("GET", "/me", .fixture("me"))
        stub.on("GET", "/me/settings", .fixture("settings"))
        stub.on("GET", "/navidrome/rest/getArtists", .fixture("getArtists"))
        let c = client()
        let me = try await c.me()
        _ = try await c.settings()
        _ = try await c.artists()
        #expect(me == Account(username: "ada", role: "admin"))
        #expect(stub.requests.count == 3)
        #expect(stub.requests.allSatisfy { $0.bearer == "echo_dt_test" })
        #expect(events.all.allSatisfy { $0 == .reachable(true) })
    }

    @Test("A refused token is reported, with the token it was")
    func refusedToken() async throws {
        stub.on("GET", "/me", .fixture("unauthenticated", status: 401))
        await #expect(throws: ApiError.signedOut) { try await client().me() }
        #expect(events.all.contains(.tokenRefused("echo_dt_test")))
    }

    @Test("A setting the server does not know is refused as a bad request")
    func settingsRefused() async throws {
        stub.on("PUT", "/me/settings", .fixture("settings-refused", status: 400))
        await #expect(throws: ApiError.server(status: 400, code: "bad_settings")) {
            try await client().updateSettings(Data(#"{"appearance":{"colour":"red"}}"#.utf8))
        }
    }

    // MARK: The API budget

    @Test("A read over the API budget is asked again after Retry-After, twice at most")
    func budgetRetries() async throws {
        let limited = Reply.fixture("rate-limited", status: 429, headers: ["Retry-After": "1"])
        stub.on("GET", "/me", limited, limited, .fixture("me"))
        let me = try await client().me()
        #expect(me.username == "ada")
        #expect(stub.requests("GET", "/me").count == 3)
        // 1 s, then twice as long, each with its share of the 0.3 s jitter (0.5 here).
        #expect(sleeps.all == [.milliseconds(1150), .milliseconds(2150)])
    }

    @Test("Still over the budget after two retries: rateLimited")
    func budgetGivesUp() async throws {
        stub.on("GET", "/me", .fixture("rate-limited", status: 429, headers: ["Retry-After": "1"]))
        await #expect(throws: ApiError.rateLimited) { try await client().me() }
        #expect(stub.requests.count == 3)
    }

    @Test("Writes over the budget are not repeated")
    func budgetWritesNotRepeated() async throws {
        stub.on("PUT", "/me/settings", .fixture("rate-limited", status: 429, headers: ["Retry-After": "1"]))
        await #expect(throws: ApiError.rateLimited) {
            try await client().updateSettings(Data(#"{"lyrics":{"showUnsynced":false}}"#.utf8))
        }
        #expect(stub.requests.count == 1)
        #expect(sleeps.all.isEmpty)
    }

    @Test("A Retry-After longer than 5 s, or none, is not waited for", arguments: [["Retry-After": "30"], [:]])
    func budgetLongWait(headers: [String: String]) async throws {
        stub.on("GET", "/me", .fixture("rate-limited", status: 429, headers: headers))
        await #expect(throws: ApiError.rateLimited) { try await client().me() }
        #expect(stub.requests.count == 1)
    }

    // MARK: Offline

    @Test("No network: offline; ECHO not answering: unreachable; both reported", arguments: [
        (URLError.Code.notConnectedToInternet.rawValue, ApiError.offline),
        (URLError.Code.timedOut.rawValue, ApiError.unreachable),
        (URLError.Code.cannotConnectToHost.rawValue, ApiError.unreachable),
        (URLError.Code.cannotFindHost.rawValue, ApiError.unreachable),
    ])
    func noAnswer(code: Int, expected: ApiError) async throws {
        stub.on("GET", "/me", .failure(URLError.Code(rawValue: code)))
        await #expect(throws: expected) { try await client().me() }
        #expect(events.all == [.reachable(false)])
    }

    @Test("The proxy in front of ECHO answering 502 without ECHO's body is unreachable")
    func proxyDown() async throws {
        stub.on("GET", "/me", .body("<html>Bad Gateway</html>", status: 502, headers: ["Content-Type": "text/html"]))
        await #expect(throws: ApiError.unreachable) { try await client().me() }
        #expect(events.all == [.reachable(false)])
    }

    @Test("Navidrome away is ECHO's answer, with its message")
    func navidromeAway() async throws {
        stub.on("GET", "/navidrome/rest/getArtists", .fixture("navidrome-unreachable", status: 502))
        let error = await #expect(throws: ApiError.self) { try await client().artists() }
        #expect(error == .navidrome(code: "navidrome.unreachable", message: "The Navidrome server could not be reached."))
        #expect(error?.userMessage == "The Navidrome server could not be reached.")
        #expect(error?.retriable == true)
        #expect(events.all == [.reachable(true)])
    }

    @Test("No Navidrome connected", arguments: ["navidrome-not-connected", "stream-url-not-connected"])
    func notConnected(fixture: String) async throws {
        stub.on("GET", "/navidrome/rest/getAlbumList2", .fixture(fixture, status: 409))
        await #expect(throws: ApiError.navidromeNotConnected) { try await client().albumList(.newest) }
    }

    @Test("A method the proxy does not allow")
    func methodNotAllowed() async throws {
        stub.on("GET", "/navidrome/rest/getArtists", .fixture("method-not-allowed", status: 403))
        await #expect(throws: ApiError.server(status: 403, code: "method_not_allowed")) { try await client().artists() }
    }

    @Test("The health check reports ECHO back")
    func health() async throws {
        stub.on("GET", "/health", .fixture("health"))
        try await client(token: nil).health()
        #expect(events.all == [.reachable(true)])
    }

    // MARK: Streams and covers

    @Test("A signed stream URL plays FLAC as stored")
    func streamRaw() async throws {
        stub.on("GET", "/navidrome/stream-url/al-1-t1", .fixture("stream-url"))
        let track = Track(
            id: "al-1-t1", title: "Harbour Lights 1", artists: [], album: AlbumRef(id: "al-1", title: "", key: "navidrome:al-1"),
            durationMs: 20000, suffix: "flac")
        let stream = try await client().streamURL(for: track)
        let url = stream.url.absoluteString
        #expect(url.hasPrefix(stub.base.absoluteString + "/api/v1/navidrome/stream/al-1-t1?uid=1&exp=1800021660000&sig="))
        #expect(url.hasSuffix("&format=raw"))
        #expect(stream.expiresAt == Date(timeIntervalSince1970: 1_800_021_660))
    }

    @Test("Opus and Ogg, which AVPlayer does not play, come as MP3 320")
    func streamTranscoded() async throws {
        stub.on("GET", "/navidrome/stream-url/x y", .fixture("stream-url"))
        let track = Track(
            id: "x y", title: "", artists: [], album: AlbumRef(id: nil, title: "", key: "navidrome:"), durationMs: 0,
            contentType: "audio/ogg", suffix: "opus")
        let url = try await client().streamURL(for: track).url.absoluteString
        #expect(url.hasSuffix("&format=mp3&maxBitRate=320&estimateContentLength=true"))
        #expect(stub.requests.first?.path == "/navidrome/stream-url/x y")
    }

    @Test("What plays as stored, by suffix or content type")
    func playsAsStored() {
        func track(_ suffix: String?, _ type: String?) -> Track {
            Track(id: "1", title: "", artists: [], album: AlbumRef(id: nil, title: "", key: ""), durationMs: 0,
                  contentType: type, suffix: suffix)
        }
        #expect(EchoClient.playsAsStored(track("mp3", nil)))
        #expect(EchoClient.playsAsStored(track("FLAC", nil)))
        #expect(EchoClient.playsAsStored(track(nil, "audio/mp4; codecs=alac")))
        #expect(!EchoClient.playsAsStored(track("opus", "audio/ogg")))
        #expect(!EchoClient.playsAsStored(track(nil, "audio/ogg")))
        #expect(!EchoClient.playsAsStored(track(nil, nil)))
    }

    @Test("Covers come through ECHO with the bearer header")
    func covers() async throws {
        let c = client()
        #expect(c.coverURL(id: "al-1", size: 300)?.absoluteString == stub.base.absoluteString + "/api/v1/navidrome/cover/al-1?size=300")
        #expect(c.coverURL(id: "al-1", size: 9000)?.absoluteString.hasSuffix("size=2048") == true)
        let coverURL = try #require(c.coverURL(id: "al-1"))
        let request = c.authorized(coverURL)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer echo_dt_test")
        // Never to another host.
        let elsewhere = c.authorized(URL(string: "https://example.com/a.jpg")!)
        #expect(elsewhere.value(forHTTPHeaderField: "Authorization") == nil)

        stub.on("GET", "/navidrome/cover/al-1", .json(200, Data([0x89, 0x50, 0x4E, 0x47]), headers: ["Content-Type": "image/png"]))
        let png = try await c.coverData(id: "al-1", size: 300)
        #expect(png == Data([0x89, 0x50, 0x4E, 0x47]))
        #expect(stub.requests.last?.query["size"] == "300")
        #expect(stub.requests.last?.bearer == "echo_dt_test")
    }

    @Test("Ids and queries are percent-encoded, + and & included")
    func encoding() async throws {
        stub.on("GET", "/navidrome/rest/search3", .fixture("search3"))
        _ = try await client().search("AC+DC & Söhne")
        let sent = try #require(stub.requests.first)
        #expect(sent.query["query"] == "AC+DC & Söhne")
        #expect(EchoClient.encode("a b+c&d/é") == "a%20b%2Bc%26d%2F%C3%A9")
        #expect(client().url("/api/v1/x")?.absoluteString == stub.base.absoluteString + "/api/v1/x")
        #expect(client().url("https://other.test/y")?.absoluteString == "https://other.test/y")
    }

    @Test("Every error has a message to show")
    func messages() {
        let all: [ApiError] = [
            .offline, .unreachable, .wrongCredentials, .totpRequired, .badCode, .tooManyAttempts, .signedOut,
            .rateLimited, .totpEnrolmentRequired, .guestNotAllowed, .navidromeNotConnected,
            .navidrome(code: "navidrome.auth", message: nil), .subsonic(code: 70, message: "not found"),
            .subsonic(code: 10, message: "missing parameter"), .notFound, .server(status: 500, code: nil), .badResponse,
        ]
        for error in all {
            #expect(!error.userMessage.isEmpty)
            #expect(error.localizedDescription == error.userMessage)
        }
    }
}
