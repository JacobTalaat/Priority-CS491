import Foundation

// One row of GET /api/today, in the order the server ranked it. The app shows
// the list exactly as received, so the order and reasons match the website.
struct TodayItem: Decodable, Equatable, Identifiable {
    struct Boundary: Decodable, Equatable {
        let letter: String
        let direction: String
    }

    let assignmentId: String
    let courseName: String
    let title: String
    let htmlUrl: String?
    let dueAt: String?
    let overdue: Bool
    let share: Double?
    let reason: String
    let boundary: Boundary?

    var id: String { assignmentId }
}

struct TodayResponse: Decodable, Equatable {
    let generatedAt: String
    let items: [TodayItem]

    static func parse(_ data: Data) -> TodayResponse? {
        try? JSONDecoder().decode(TodayResponse.self, from: data)
    }
}

// The same labels the website builds in src/lib/today-list.ts, so a row reads
// the same on both.
enum TodayFormat {
    // The student is at NJIT, so due dates read in campus time.
    static let timeZone = TimeZone(identifier: "America/New_York")!

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = format
        return formatter
    }

    private static let time = formatter("h:mm a")
    private static let weekday = formatter("EEE")
    private static let date = formatter("EEE, MMM d")

    static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = withFraction.date(from: value) { return parsed }
        return ISO8601DateFormatter().date(from: value)
    }

    // Whole New York calendar days from `from` to `to`, so "tomorrow" flips at
    // midnight Eastern.
    static func daysBetween(_ from: Date, _ to: Date) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = calendar.startOfDay(for: from)
        let end = calendar.startOfDay(for: to)
        return calendar.dateComponents([.day], from: start, to: end).day ?? 0
    }

    // "Due today, 11:59 PM", "Due tomorrow, 9:00 AM", "Due Fri, 11:59 PM" this
    // week, then the date ("Due Fri, Nov 20") further out.
    static func dueLabel(_ dueAt: String?, overdue: Bool, now: Date = Date()) -> String {
        guard let due = parseDate(dueAt) else { return "No due date" }
        if overdue { return "Overdue, was due \(date.string(from: due))" }
        let days = daysBetween(now, due)
        let clock = time.string(from: due)
        switch days {
        case 0: return "Due today, \(clock)"
        case 1: return "Due tomorrow, \(clock)"
        case 2..<7: return "Due \(weekday.string(from: due)), \(clock)"
        default: return "Due \(date.string(from: due))"
        }
    }

    // Whole percents; a real slice under 1% still shows as one.
    static func shareLabel(_ share: Double?) -> String? {
        guard let share, share.isFinite, share > 0 else { return nil }
        let whole = share.rounded()
        return whole >= 1 ? "\(Int(whole))%" : "<1%"
    }

    static func boundaryTag(_ boundary: TodayItem.Boundary?) -> String? {
        guard let boundary else { return nil }
        return boundary.direction == "at-risk" ? "\(boundary.letter) at risk" : "\(boundary.letter) within reach"
    }

    // Only https links open, the same rule the website applies before linking
    // out to Canvas.
    static func canvasURL(_ htmlUrl: String?) -> URL? {
        guard let htmlUrl, let url = URL(string: htmlUrl), url.scheme?.lowercased() == "https", url.host != nil else {
            return nil
        }
        return url
    }
}
