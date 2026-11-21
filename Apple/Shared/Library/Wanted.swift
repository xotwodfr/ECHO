import Foundation
import Observation

/// The Wanted list as the web keeps it (src/client/shell/wanted.ts): one list for everyone on the
/// server, loaded when its page opens (the server then looks for what is still missing) and changed
/// in place after an add or a remove. A removal leaves the list at once but reaches the server only
/// once it can no longer be undone (one tap used to remove anyone's item for everyone, with no way
/// back): Undo before then puts it back as it was, and nothing was sent.
@MainActor @Observable
final class WantedList {
    enum Removal: Equatable, Sendable {
        /// Sent, and gone for everyone.
        case removed
        /// Undone (or added again) before it was sent.
        case undone
        /// The server refused or did not answer: the item is back.
        case failed
    }

    /// The list, newest first; nil until it first loads.
    private(set) var items: [WantedItem]? = nil
    /// Why the first load failed (a list already shown stays when a later one fails).
    private(set) var failure: ApiError? = nil

    /// How long a removal can be undone: as long as its toast (and its Undo) is on screen.
    static let undoWindow: Duration = .seconds(4)

    var count: Int { items?.count ?? 0 }
    var foundCount: Int { items?.filter { $0.found != nil }.count ?? 0 }

    private let source: any LibrarySource
    private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private var pending: [Int: Pending] = [:]

    private struct Pending {
        let item: WantedItem
        let index: Int
        let task: Task<Removal, Never>
    }

    init(source: any LibrarySource, sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.source = source
        self.sleep = sleep
    }

    /// Whether a removal of this item is waiting for its Undo to go.
    func isPending(_ id: Int) -> Bool { pending[id] != nil }

    func load() async {
        do {
            let list = try await source.wanted()
            // An item removed a moment ago is still on the server until its Undo has gone.
            items = list.filter { pending[$0.id] == nil }
            failure = nil
        } catch {
            if items == nil { failure = error as? ApiError ?? .badResponse }
        }
    }

    /// Adds `text`: the item, and whether it was already on the list. Throws when the server refuses.
    @discardableResult
    func add(_ text: String) async throws -> (item: WantedItem, known: Bool) {
        let item = try await source.addWanted(text)
        // Adding again what was just removed keeps it: the server answered with the same item.
        undo(item.id)
        let list = items ?? []
        let known = list.contains { $0.id == item.id }
        items = [item] + list.filter { $0.id != item.id }
        return (item, known)
    }

    /// Takes the item off the list now and off the server once it can no longer be undone; the task
    /// says how it ended.
    @discardableResult
    func remove(_ id: Int) -> Task<Removal, Never> {
        guard var list = items, let index = list.firstIndex(where: { $0.id == id }) else {
            return Task { .removed }
        }
        let item = list.remove(at: index)
        items = list
        let task = Task { [weak self] () -> Removal in
            do {
                try await self?.sleep(WantedList.undoWindow)
            } catch {
                return .undone
            }
            guard let self, self.pending[id] != nil else { return .undone }
            return await self.send(id)
        }
        pending[id] = Pending(item: item, index: index, task: task)
        return task
    }

    /// Puts a removed item back where it was, if its removal has not been sent.
    func undo(_ id: Int) {
        guard let p = pending.removeValue(forKey: id) else { return }
        p.task.cancel()
        restore(p.item, at: p.index)
    }

    /// Sends every removal still waiting, now (the app is leaving the screen: that is not an undo).
    func flush() async {
        for id in Array(pending.keys) {
            pending[id]?.task.cancel()
            _ = await send(id)
        }
    }

    /// Forgets the list (signing out).
    func reset() {
        for p in pending.values { p.task.cancel() }
        pending = [:]
        items = nil
        failure = nil
    }

    private func send(_ id: Int) async -> Removal {
        guard let p = pending.removeValue(forKey: id) else { return .undone }
        do {
            try await source.removeWanted(id: id)
            return .removed
        } catch ApiError.notFound {
            return .removed // someone else removed it meanwhile
        } catch {
            restore(p.item, at: p.index)
            return .failed
        }
    }

    private func restore(_ item: WantedItem, at index: Int) {
        guard var list = items, !list.contains(where: { $0.id == item.id }) else { return }
        list.insert(item, at: min(index, list.count))
        items = list
    }
}
