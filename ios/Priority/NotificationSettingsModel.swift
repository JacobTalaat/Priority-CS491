import Foundation

// GET and PATCH /api/notifications/preferences
struct NotificationPreferences: Codable, Equatable {
    var notifyTonight: Bool
    var notifyDueTomorrow: Bool
    var notifyGradePosted: Bool
    // "HH:MM" in New York time.
    var nightlyReminderTime: String

    static func parse(_ data: Data) -> NotificationPreferences? {
        try? JSONDecoder().decode(NotificationPreferences.self, from: data)
    }

    // Only what changed, so a setting changed on the website meanwhile survives.
    func changes(from saved: NotificationPreferences) -> [String: Any] {
        var changed: [String: Any] = [:]
        if notifyTonight != saved.notifyTonight { changed["notifyTonight"] = notifyTonight }
        if notifyDueTomorrow != saved.notifyDueTomorrow { changed["notifyDueTomorrow"] = notifyDueTomorrow }
        if notifyGradePosted != saved.notifyGradePosted { changed["notifyGradePosted"] = notifyGradePosted }
        if nightlyReminderTime != saved.nightlyReminderTime { changed["nightlyReminderTime"] = nightlyReminderTime }
        return changed
    }
}

// The server stores a clock reading in New York time; the picker wants a Date.
enum ReminderTime {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TodayFormat.timeZone
        return calendar
    }

    // A fixed winter day, so a clock change can't shift the reading.
    static func date(from value: String) -> Date? {
        let parts = value.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return calendar.date(from: DateComponents(year: 2026, month: 1, day: 15, hour: hour, minute: minute))
    }

    static func string(from date: Date) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

// Changes save as soon as they're made. One save runs at a time; anything
// changed while it runs goes out in the next one.
@MainActor
final class NotificationSettingsModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case problem(ScreenProblem)
        case ready
    }

    static let loadFailedTitle = "Couldn't load notification settings"
    static let saveOffline = "Couldn't save because you're offline. Your last change was put back."
    static func saveFailed(_ message: String?) -> String {
        "Couldn't save. \(message ?? "Your last change was put back. Try again.")"
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var values = NotificationPreferences(
        notifyTonight: false, notifyDueTomorrow: false, notifyGradePosted: false, nightlyReminderTime: "00:00"
    )
    @Published private(set) var notice: String?

    private let api: any APIRequesting
    private var saved: NotificationPreferences?
    private(set) var saving: Task<Void, Never>?

    init(api: any APIRequesting) {
        self.api = api
    }

    // Both nightly reminders fire at this time, so either one being on makes
    // it worth editing, the same rule as the website.
    var canEditTime: Bool { values.notifyTonight || values.notifyDueTomorrow }

    func load() async {
        // Reloading over an unsaved change would put the old value back.
        guard saving == nil else { return }
        let response = await api.get(["api", "notifications", "preferences"])
        guard saving == nil, !Task.isCancelled else { return }
        if case .ok(let data) = response, let parsed = NotificationPreferences.parse(data) {
            saved = parsed
            values = parsed
            notice = nil
            phase = .ready
            return
        }
        guard let problem = ScreenProblem.from(response, title: Self.loadFailedTitle) else { return }
        if phase == .ready {
            notice = problem.message
        } else {
            phase = .problem(problem)
        }
    }

    func update(_ change: (inout NotificationPreferences) -> Void) {
        guard phase == .ready else { return }
        change(&values)
        guard values != saved, saving == nil else { return }
        notice = nil
        saving = Task {
            await saveUntilSettled()
            saving = nil
        }
    }

    private func saveUntilSettled() async {
        while let before = saved, values != before {
            let sending = values
            guard let body = try? JSONSerialization.data(withJSONObject: sending.changes(from: before)) else { return }
            let response = await api.request("PATCH", ["api", "notifications", "preferences"], json: body, headers: [:])
            switch response {
            case .ok:
                saved = sending
            case .signedOut:
                return
            case .offline:
                values = before
                notice = Self.saveOffline
            case .failed(_, let message):
                values = before
                notice = Self.saveFailed(message)
            }
        }
    }
}
