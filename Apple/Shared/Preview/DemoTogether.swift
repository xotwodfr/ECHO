import Foundation

// The Listen together demo screens (`-ECHODemo <screen>`): a session in a fixed state, shown on the
// real screens with nothing reaching the network (Together.demo). `together-join` (the offer a
// scanned code makes), `together-session` (Now Playing with the sheet: who is listening and the
// queue), `together-queue` (Now Playing's Up next as the shared queue) and, on the Mac, `together`.

enum DemoTogether {
    static let screens = ["together-join", "together-session", "together-queue", "together"]

    private static let ada = TogetherPerson(id: 1, username: "ada")
    private static let sam = TogetherPerson(id: 2, username: "sam")
    private static let noor = TogetherPerson(id: 3, username: "noor")
    private static let mira = TogetherPerson(id: 4, username: "mira")

    private static func item(_ uid: String, _ track: Track, by person: TogetherPerson) -> TogetherItem {
        TogetherItem(uid: uid, track: TrackRef(track), addedBy: person)
    }

    /// The session the screens show: the song the demo player holds, three songs queued by three
    /// people, four listening (one away); `you` is sam, a member (or ada, the host).
    static func session(host: Bool = false) -> TogetherState {
        let now = Date.now.timeIntervalSince1970 * 1000
        let playing = DemoLibrary.track(Demo.harbour, 0)
        let queued = DemoLibrary.songs(["glass-2", "paper-1", "signal-0"])
        return TogetherState(
            id: "together-session-for-tests-0001", url: "/together/together-session-for-tests-0001", host: ada,
            you: TogetherYou(id: host ? ada.id : sam.id, host: host, member: true),
            members: [
                TogetherMember(id: ada.id, username: ada.username, host: true, online: true),
                TogetherMember(id: sam.id, username: sam.username, host: false, online: true),
                TogetherMember(id: noor.id, username: noor.username, host: false, online: true),
                TogetherMember(id: mira.id, username: mira.username, host: false, online: false),
            ],
            now: item("together-item-1", playing, by: ada),
            queue: [
                item("together-item-2", queued[0], by: noor), item("together-item-3", queued[1], by: sam),
                item("together-item-4", queued[2], by: ada),
            ],
            playing: false, startedAt: nil, positionMs: 84_000, serverTime: now, version: 7)
    }

    /// What `-ECHODemo <screen>` starts with.
    @MainActor
    static func together(for screen: String, player: Player, server: URL) -> Together {
        switch screen {
        case "together-join":
            return Together.demo(player: player, server: server, offer: .ready(id: "together-session-for-tests-0001", host: "ada", members: 3))
        case "together-session", "together-queue", "together":
            let together = Together.demo(player: player, server: server, session: session())
            together.sheetOpen = screen != "together-queue"
            return together
        default:
            return Together.demo(player: player, server: server)
        }
    }
}
