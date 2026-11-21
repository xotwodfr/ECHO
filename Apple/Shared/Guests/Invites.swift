import Foundation
import Observation

/// Settings → Guests (the web's GuestsBlock, Android's Guests.kt): the guests this user invited
/// (every guest, for an admin) with any request to stay, ending one now, and the invite: a one-time
/// code shown as a QR code for 10 minutes, giving an hour, a day or a week, that notices the guest
/// joining by asking for the list every few seconds while it shows.
@MainActor @Observable
final class GuestInvites {
    private(set) var guests: [Guest] = []
    private(set) var state: LoadState = .idle
    /// What a guest's End now or Approve said, when it did not go.
    private(set) var note: String? = nil

    /// The invite being shown.
    private(set) var code: GuestCode? = nil
    private(set) var length: GuestLength = .day
    private(set) var making = false
    private(set) var inviteError: String? = nil
    /// The guest who joined with the code shown.
    private(set) var joined: String? = nil

    private let client: EchoClient?
    private let sleep: @Sendable (Duration) async throws -> Void
    static let pollEvery: Duration = .seconds(3)

    /// - Parameter client: nil for the demo screens, which never reach the network.
    init(client: EchoClient?, sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.client = client
        self.sleep = sleep
    }

    /// The demo screens' guests and invite.
    static func demo(guests: [Guest], code: GuestCode? = nil) -> GuestInvites {
        let invites = GuestInvites(client: nil)
        invites.guests = guests
        invites.state = .ready
        invites.code = code
        if let code { invites.length = GuestLength(rawValue: Int(code.durationMs)) ?? .day }
        return invites
    }

    func load() async {
        guard let client else { return }
        if guests.isEmpty { state = .loading }
        do {
            guests = try await client.guests()
            state = .ready
        } catch let error as ApiError {
            state = .failed(error)
        } catch {
            state = .failed(.badResponse)
        }
    }

    /// Ends a guest's time now: it is signed out and its account deleted.
    func end(_ guest: Guest) async {
        guard let client else { return }
        note = nil
        do {
            try await client.endGuest(guest.id)
            guests.removeAll { $0.id == guest.id }
        } catch let error as PassError {
            // Gone already (its time ran out): off the list all the same.
            if error == .expired { guests.removeAll { $0.id == guest.id } } else { note = error.userMessage }
        } catch {
            note = ApiError.unreachable.userMessage
        }
    }

    /// Lets a guest stay under the name it asked for.
    func keep(_ guest: Guest) async {
        guard let client else { return }
        note = nil
        do {
            try await client.keepGuest(guest.id)
            await load()
        } catch let error as PassError {
            note = error == .expired ? "That guest's time is up." : error.userMessage
            await load()
        } catch {
            note = ApiError.unreachable.userMessage
        }
    }

    // MARK: The invite

    /// A new code for this length (the sheet opening, a length chosen, New code).
    func invite(_ length: GuestLength) async {
        self.length = length
        guard let client else { return }
        making = true
        inviteError = nil
        joined = nil
        code = nil
        defer { making = false }
        do {
            code = try await client.createGuestCode(length)
        } catch let error as PassError {
            inviteError = error == .tooManyCodes ? error.userMessage : "Couldn't make a code. \(error.userMessage)"
        } catch {
            inviteError = "Couldn't make a code. Try again."
        }
    }

    /// While the code shows: the guests now, then every few seconds, until one joins (or the code
    /// runs out, or the sheet closes and cancels this).
    func watchForJoin(now: () -> Date = Date.init) async {
        guard let client, let shown = code else { return }
        var before: Set<Int>? = nil
        while !Task.isCancelled, code == shown, joined == nil, shown.expires > now() {
            if let list = try? await client.guests() {
                if let before, let fresh = list.first(where: { !before.contains($0.id) }) {
                    joined = fresh.username
                    guests = list
                    return
                }
                before = before ?? Set(list.map(\.id))
            }
            try? await sleep(Self.pollEvery)
        }
    }

    /// The sheet closed: the code is forgotten (it runs out by itself) and the list reloads.
    func closeInvite() async {
        code = nil
        joined = nil
        inviteError = nil
        await load()
    }
}
