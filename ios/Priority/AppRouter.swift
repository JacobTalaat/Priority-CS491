import Foundation

enum AppTab: Hashable {
    case today
    case classes
    case account
}

// A class page in the Classes stack. `visit` makes every notification tap a
// fresh page, so a class that is already open reloads and shows the new grade.
struct ClassLink: Hashable {
    let courseId: String
    var name: String?
    var visit = UUID()
}

// Where a tapped notification leads. The server sends the same `kind` and
// `url` it sends the website: "/today" for Tonight and Due tomorrow, and
// "/classes/{id}" for Grade posted.
enum NotificationRoute: Equatable {
    case today
    case classes
    case course(String)

    static func from(userInfo: [AnyHashable: Any]) -> NotificationRoute? {
        if let url = userInfo["url"] as? String, let route = from(path: url) { return route }
        switch userInfo["kind"] as? String {
        case "tonight", "due-tomorrow": return .today
        case "grade-posted": return .classes
        default: return nil
        }
    }

    // Only the app's own paths count; a full URL or an unknown path is ignored.
    static func from(path: String) -> NotificationRoute? {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              let components = URLComponents(string: path),
              components.host == nil else { return nil }
        // Split before decoding, so an encoded slash can't add a segment.
        let segments = components.percentEncodedPath
            .split(separator: "/")
            .map { String($0).removingPercentEncoding ?? "" }
        switch segments.count {
        case 1 where segments[0] == "today": return .today
        case 1 where segments[0] == "classes": return .classes
        case 2 where segments[0] == "classes" && !segments[1].isEmpty: return .course(segments[1])
        default: return nil
        }
    }
}

// Which tab and class page are showing. It lives above the signed-in screens
// so a tap that launches the app is kept until the session is restored.
@MainActor
final class AppRouter: ObservableObject {
    @Published var tab: AppTab = .today
    @Published var classPath: [ClassLink] = []
    // Changes when a notification opens Today, so the list reloads.
    @Published private(set) var todayVisit = 0

    func open(_ route: NotificationRoute) {
        switch route {
        case .today:
            tab = .today
            todayVisit += 1
        case .classes:
            tab = .classes
            classPath = []
        case .course(let id):
            tab = .classes
            classPath = [ClassLink(courseId: id)]
        }
    }

    // The next student to sign in starts on Today, not on someone else's page.
    func reset() {
        tab = .today
        classPath = []
    }
}
