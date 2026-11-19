import Foundation
import Network
import Observation

/// Whether ECHO can be used online, as Android's offline/Network.kt decides it: this device has a
/// network, and ECHO answered the last request (any answer, errors too). While the network is up but
/// ECHO is away, its health check is asked again every 20 s, and at once when the network comes back.
@MainActor @Observable
final class Connectivity {
    enum Status: Equatable, Sendable {
        case online
        /// This device has no network.
        case offline
        /// The network is up; ECHO did not answer.
        case serverAway
    }

    private(set) var networkUp = true
    private(set) var serverReachable = true

    var status: Status { !networkUp ? .offline : serverReachable ? .online : .serverAway }
    var isOnline: Bool { status == .online }

    static let probeInterval: Duration = .seconds(20)

    private let probe: (@Sendable () async -> Void)?
    @ObservationIgnored private var monitor: NWPathMonitor?
    @ObservationIgnored private var probing: Task<Void, Never>?

    /// `probe` asks ECHO's health check (nil: never, as in the preview); `watchNetwork` follows
    /// the device's network (off in tests).
    init(watchNetwork: Bool, probe: (@Sendable () async -> Void)?) {
        self.probe = probe
        guard watchNetwork else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.networkChanged(up) }
        }
        monitor.start(queue: DispatchQueue(label: "com.folk3s.echo.network"))
        self.monitor = monitor
    }

    /// What the API client saw: ECHO answered, or the request got no answer.
    func serverAnswered(_ up: Bool) {
        guard serverReachable != up else { return }
        serverReachable = up
        followUp(now: false)
    }

    func networkChanged(_ up: Bool) {
        guard networkUp != up else { return }
        networkUp = up
        followUp(now: up)
    }

    private func followUp(now: Bool) {
        let away = networkUp && !serverReachable
        guard away, let probe else {
            probing?.cancel()
            probing = nil
            return
        }
        if now || probing == nil {
            probing?.cancel()
            probing = Task {
                if !now { try? await Task.sleep(for: Self.probeInterval) }
                while !Task.isCancelled {
                    await probe()
                    try? await Task.sleep(for: Self.probeInterval)
                }
            }
        }
    }
}
