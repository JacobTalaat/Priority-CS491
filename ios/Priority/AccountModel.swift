import Foundation

enum AccountFormat {
    // The same wording as the website's formatLastSynced.
    static func lastSynced(_ value: String?, now: Date = Date()) -> String {
        guard let then = TodayFormat.parseDate(value) else { return "Never synced" }
        let elapsed = now.timeIntervalSince(then)
        if elapsed < 60 { return "Just now" }
        if elapsed < 3_600 { return "\(plural(Int(elapsed / 60), "minute")) ago" }
        if elapsed < 24 * 3_600 { return "\(plural(Int(elapsed / 3_600), "hour")) ago" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: then)
    }

    private static func plural(_ count: Int, _ unit: String) -> String {
        "\(count) \(unit)\(count == 1 ? "" : "s")"
    }
}

@MainActor
final class AccountModel: ObservableObject {
    enum Value: Equatable {
        case loading
        case loaded(String)
        case unavailable
    }

    @Published private(set) var email: Value = .loading
    @Published private(set) var lastSynced: Value = .loading

    private let api: any APIRequesting
    private var generation = 0

    init(api: any APIRequesting) {
        self.api = api
    }

    func load(now: Date? = nil) async {
        generation += 1
        let current = generation
        async let me = api.get(["api", "auth", "me"])
        async let sync = api.get(["api", "canvas", "sync"])
        let (meResponse, syncResponse) = await (me, sync)
        guard current == generation, !Task.isCancelled else { return }

        if case .ok(let data) = meResponse, let parsed = APIClient.parseMe(data) {
            email = .loaded(parsed.email)
        } else if case .loaded = email {
            // A failed refresh keeps the value already on screen.
        } else {
            email = .unavailable
        }

        if case .ok(let data) = syncResponse, let parsed = try? JSONDecoder().decode(SyncStatus.self, from: data) {
            lastSynced = .loaded(AccountFormat.lastSynced(parsed.lastSyncedAt, now: now ?? Date()))
        } else if case .loaded = lastSynced {
        } else {
            lastSynced = .unavailable
        }
    }

    private struct SyncStatus: Decodable {
        let lastSyncedAt: String?
    }
}
