import Foundation

// Sends requests to the Priority API. Deliberately thin: it returns what the
// API actually said (status included) and leaves the refresh-or-sign-out
// decision to AuthModel, which owns the session.
final class APIClient {
    enum MeAttempt: Equatable {
        case ok(email: String)
        case unauthorized
        case unreachable
    }

    private let config: AppConfig
    private let urlSession: URLSession

    init(config: AppConfig, urlSession: URLSession = URLSession(configuration: .ephemeral)) {
        self.config = config
        self.urlSession = urlSession
    }

    static func meURL(apiBase: URL) -> URL? {
        var components = URLComponents(url: apiBase, resolvingAgainstBaseURL: false)!
        components.path = "/api/auth/me"
        return components.url
    }

    static func parseMe(_ data: Data) -> (id: String, email: String)? {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = object["id"] as? String,
              let email = object["email"] as? String else { return nil }
        return (id, email)
    }

    func me(_ session: AuthSession) async -> MeAttempt {
        guard let url = Self.meURL(apiBase: config.apiBaseURL) else { return .unreachable }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await urlSession.data(for: request)
            switch (response as? HTTPURLResponse)?.statusCode {
            case 200:
                if let me = Self.parseMe(data) { return .ok(email: me.email) }
                // 200 with a body we can't read is an API problem, not proof the
                // token is dead.
                return .unreachable
            case 401:
                return .unauthorized
            default:
                // 404, 500, 503: an outage keeps the session (same rule as the
                // website's offline handling).
                return .unreachable
            }
        } catch {
            return .unreachable
        }
    }
}
