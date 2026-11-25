import Foundation

// The calls the Today screen makes. LiveTodayAPI sends them through AuthModel;
// tests answer them directly.
@MainActor
protocol TodayAPI {
    func today() async -> APIResponse
    func markDone(_ assignmentId: String, rank: Int, listGeneratedAt: String, requestId: String) async -> APIResponse
    func undo(_ assignmentId: String, requestId: String) async -> APIResponse
    func syncNow() async -> APIResponse
}

@MainActor
struct LiveTodayAPI: TodayAPI {
    let auth: AuthModel

    // The event log tells app taps from website taps by this header, and a
    // retried request with the same id is never logged twice.
    private func actionHeaders(_ requestId: String) -> [String: String] {
        ["X-Priority-Client": "app", "X-Priority-Request-Id": requestId]
    }

    func today() async -> APIResponse {
        await auth.request("GET", ["api", "today"])
    }

    func markDone(_ assignmentId: String, rank: Int, listGeneratedAt: String, requestId: String) async -> APIResponse {
        let body = try? JSONSerialization.data(withJSONObject: ["rank": rank, "listGeneratedAt": listGeneratedAt])
        return await auth.request(
            "POST", ["api", "today", "items", assignmentId, "done"],
            json: body, headers: actionHeaders(requestId)
        )
    }

    func undo(_ assignmentId: String, requestId: String) async -> APIResponse {
        await auth.request("DELETE", ["api", "today", "items", assignmentId], headers: actionHeaders(requestId))
    }

    func syncNow() async -> APIResponse {
        await auth.request("POST", ["api", "canvas", "sync"])
    }
}

enum TodayMessages {
    static let offlineTitle = "You're offline"
    static let offline = "Priority can't reach the internet. Check your connection and try again."
    static let loadFailedTitle = "Couldn't load your list"
    static let loadFailed = "Something went wrong on our side. Try again in a minute."
    static let emptyTitle = "You're all caught up!"
    static let empty = "There are no open items right now. Your Today list is ready when new work arrives."
    static let canvasNotConnected = "Connect Canvas on the Priority website first, then pull to refresh."
    static let syncOffline = "Couldn't sync with Canvas because you're offline. Showing your last list."

    static func syncFailed(_ message: String?) -> String {
        if message == "Canvas not connected" { return canvasNotConnected }
        return "Couldn't sync with Canvas. \(message ?? "Try again in a minute.")"
    }

    static func doneFailed(_ title: String, _ response: APIResponse) -> String {
        "Couldn't mark “\(title)” done. \(detail(response))"
    }

    static func undoFailed(_ title: String, _ response: APIResponse) -> String {
        "Couldn't undo “\(title)”. \(detail(response))"
    }

    private static func detail(_ response: APIResponse) -> String {
        switch response {
        case .offline: return "Check your connection and try again."
        case .failed(_, let message?): return message
        default: return "Try again."
        }
    }
}

// What fills the screen when there is no list to show.
enum TodayProblem: Equatable {
    case offline
    case failed(String)

    var title: String {
        self == .offline ? TodayMessages.offlineTitle : TodayMessages.loadFailedTitle
    }

    var message: String {
        switch self {
        case .offline: return TodayMessages.offline
        case .failed(let message): return message
        }
    }
}

@MainActor
final class TodayModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case problem(TodayProblem)
        case ready
    }

    struct UndoOffer: Equatable {
        let item: TodayItem
        let index: Int
    }

    // How long Undo stays on screen, the same as the website.
    static let undoSeconds: Double = 6

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var items: [TodayItem] = []
    @Published private(set) var undoOffer: UndoOffer?
    // A problem with an action or a refresh while the list stays on screen.
    @Published var notice: String?

    private let api: any TodayAPI
    private let undoSeconds: Double
    private var generatedAt = ""
    // Rows marked done whose Done hasn't saved yet. Every list response is
    // filtered through this, so a reload that started before the Done saved
    // can't bring the row back. Once it saves the server's list decides, so an
    // item un-done on the website shows up again.
    private var hidden = Set<String>()
    private var pendingDone: [String: Task<APIResponse, Never>] = [:]
    private var undoTimer: Task<Void, Never>?
    private var loadGeneration = 0

    init(api: any TodayAPI, undoSeconds: Double = TodayModel.undoSeconds) {
        self.api = api
        self.undoSeconds = undoSeconds
    }

    // Shows the spinner only when there is nothing on screen yet; with a list
    // already showing, a failed reload keeps it and says so in the notice.
    func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        if items.isEmpty, phase != .ready { phase = .loading }
        let response = await api.today()
        // A cancelled request comes back as "offline" but says nothing about the
        // network; the next appearance loads again.
        guard generation == loadGeneration, !Task.isCancelled else { return }
        apply(response)
    }

    // Pull to refresh: Sync now pulls fresh work from Canvas, then the list
    // reloads. A sync that fails still reloads, so the student sees the list
    // the server has.
    func refresh() async {
        let sync = await api.syncNow()
        switch sync {
        case .ok:
            notice = nil
        case .signedOut:
            return
        case .offline:
            if phase == .ready {
                notice = TodayMessages.syncOffline
            } else {
                phase = .problem(.offline)
            }
            return
        case .failed(_, let message):
            notice = TodayMessages.syncFailed(message)
        }
        await load()
    }

    private func apply(_ response: APIResponse) {
        switch response {
        case .ok(let data):
            guard let parsed = TodayResponse.parse(data) else {
                show(problem: .failed(TodayMessages.loadFailed))
                return
            }
            generatedAt = parsed.generatedAt
            items = parsed.items.filter { !hidden.contains($0.assignmentId) }
            phase = .ready
        case .offline:
            show(problem: .offline)
        case .failed(_, let message):
            show(problem: .failed(message ?? TodayMessages.loadFailed))
        case .signedOut:
            // AuthModel has already switched to the log-in screen.
            break
        }
    }

    private func show(problem: TodayProblem) {
        if phase == .ready {
            notice = problem == .offline ? TodayMessages.offline : problem.message
        } else {
            phase = .problem(problem)
        }
    }

    func markDone(_ item: TodayItem) {
        guard let index = items.firstIndex(of: item) else { return }
        notice = nil
        items.remove(at: index)
        hidden.insert(item.assignmentId)
        let api = self.api
        let rank = index + 1
        let listGeneratedAt = generatedAt
        let request = Task { @MainActor in
            await api.markDone(item.assignmentId, rank: rank, listGeneratedAt: listGeneratedAt, requestId: UUID().uuidString)
        }
        pendingDone[item.assignmentId] = request
        offerUndo(UndoOffer(item: item, index: index))

        Task {
            let result = await request.value
            // An Undo tapped meanwhile owns what happens next.
            guard pendingDone[item.assignmentId] == request else { return }
            pendingDone[item.assignmentId] = nil
            if case .ok = result {
                // load() drops any reload still in flight, so every list applied
                // from here on was read after the Done saved.
                hidden.remove(item.assignmentId)
                await load()
                return
            }
            if result == .signedOut { return }
            putBack(item, at: index)
            if undoOffer?.item.assignmentId == item.assignmentId { clearUndo() }
            notice = TodayMessages.doneFailed(item.title, result)
        }
    }

    func undo() async {
        guard let offer = undoOffer else { return }
        clearUndo()
        notice = nil
        // A reload from before this undo would take the row away again.
        loadGeneration += 1
        let item = offer.item
        putBack(item, at: offer.index)
        let request = pendingDone[item.assignmentId]
        pendingDone[item.assignmentId] = nil
        // Wait for a Done still in flight: an undo that reached the server before
        // it would leave the item done. With none in flight the Done has already
        // saved, because a failed one takes the Undo offer away with it.
        var doneSaved = true
        if let request {
            if case .ok = await request.value {} else { doneSaved = false }
        }
        if doneSaved {
            let result = await api.undo(item.assignmentId, requestId: UUID().uuidString)
            if result == .signedOut { return }
            if case .ok = result {} else {
                notice = TodayMessages.undoFailed(item.title, result)
            }
        }
        await load()
    }

    private func putBack(_ item: TodayItem, at index: Int) {
        hidden.remove(item.assignmentId)
        guard !items.contains(where: { $0.assignmentId == item.assignmentId }) else { return }
        items.insert(item, at: min(index, items.count))
        phase = .ready
    }

    private func offerUndo(_ offer: UndoOffer) {
        undoTimer?.cancel()
        undoOffer = offer
        let seconds = undoSeconds
        undoTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.undoOffer = nil
        }
    }

    private func clearUndo() {
        undoTimer?.cancel()
        undoTimer = nil
        undoOffer = nil
    }
}
