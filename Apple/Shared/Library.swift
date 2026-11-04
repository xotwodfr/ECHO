import AVFoundation
import Foundation
import Observation
#if os(iOS)
import UIKit
#endif

/// The app's state: signed in or not, the albums, and the player, which goes on through the album
/// (the baseline every native client has: README.md).
@MainActor @Observable
final class Library {
    var api: Api
    var signedIn: Bool
    /// The sign-in page's message, and the other pages' status line.
    var message = ""
    var status = ""
    var albums: [Album] = []
    var queue: [Song] = []
    var current: Int?
    var playing = false
    var position: Double = 0

    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var observers: [Any] = []

    init() {
        // The owner's server (as the Android app's); ECHO_URL (the Xcode scheme) points elsewhere.
        var server = ProcessInfo.processInfo.environment["ECHO_URL"] ?? "https://echo.folk3s.com"
        while server.hasSuffix("/") { server.removeLast() }
        api = Api(base: server, token: TokenStore.load(server: server))
        signedIn = api.token != nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback) // plays on with the screen off
        #endif
        observers.append(NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.next() }
        })
        observers.append(player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 1), queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated { self?.position = time.seconds.isFinite ? time.seconds : 0 }
        })
    }

    static var deviceName: String {
        #if os(iOS)
        "ECHO for \(UIDevice.current.model)"
        #else
        "ECHO for Mac (\(Host.current().localizedName ?? "this Mac"))"
        #endif
    }

    func signIn(user: String, password: String, code: String) async {
        message = "Signing in…"
        do {
            let token = try await api.signIn(
                user: user, password: password, code: code, name: String(Self.deviceName.prefix(64)))
            api.token = token
            TokenStore.save(token, server: api.base)
            message = ""
            signedIn = true
            await loadAlbums()
        } catch let e as ApiError {
            switch e.code {
            case "totp_required": message = "Enter the code from your authenticator app too."
            case "bad_code": message = "That code did not work. Try the next one."
            case "rate_limited": message = "Too many attempts. Wait a minute and try again."
            default: message = e.signedOut ? "Username or password is incorrect." : "ECHO did not answer: \(e.localizedDescription)"
            }
        } catch {
            message = "ECHO could not be reached: \(error.localizedDescription)"
        }
    }

    func loadAlbums() async {
        status = "Loading your albums…"
        do {
            albums = try await api.albums()
            status = albums.isEmpty ? "No albums yet: connect Navidrome in ECHO's Settings." : ""
        } catch {
            failed(error)
        }
    }

    func songs(of album: Album) async -> [Song] {
        do {
            return try await api.songs(album: album.id)
        } catch {
            failed(error)
            return []
        }
    }

    func play(_ songs: [Song], at index: Int) async {
        queue = songs
        await play(at: index)
    }

    private func play(at index: Int) async {
        guard queue.indices.contains(index) else { return }
        current = index
        position = 0
        status = ""
        do {
            let url = try await api.streamURL(song: queue[index])
            guard current == index else { return } // a newer tap won meanwhile
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
            player.play()
            playing = true
        } catch {
            failed(error)
        }
    }

    func toggle() {
        if playing { player.pause() } else { player.play() }
        playing.toggle()
    }

    /// The album goes on; after its last song the player stops.
    func next() {
        if let c = current, c + 1 < queue.count {
            Task { await play(at: c + 1) }
        } else {
            playing = false
        }
    }

    func signOut() async {
        try? await api.signOut() // this device leaves Sessions & devices on the server
        signedOutHere("")
    }

    private func failed(_ error: Error) {
        if let e = error as? ApiError, e.signedOut {
            signedOutHere("Signed out. Sign in again.")
        } else {
            status = "ECHO did not answer: \(error.localizedDescription)"
        }
    }

    /// Signed out here, or the server refused the token (revoked in Sessions & devices, or idle 60 days).
    private func signedOutHere(_ why: String) {
        TokenStore.forget(server: api.base)
        api.token = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        playing = false
        current = nil
        queue = []
        albums = []
        message = why
        signedIn = false
    }
}
