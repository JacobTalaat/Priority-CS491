import Foundation

// Talks to Supabase Auth over plain URL requests: no third-party SDK and no
// packages (PR rule), which keeps the token handling visible for review.
final class AuthClient: AuthFetching {
    private let config: AppConfig
    private let urlSession: URLSession

    init(config: AppConfig, urlSession: URLSession = URLSession(configuration: .ephemeral)) {
        self.config = config
        self.urlSession = urlSession
    }

    static func tokenGrantURL(supabaseBase: URL, grantType: String) -> URL? {
        var components = URLComponents(url: supabaseBase, resolvingAgainstBaseURL: false)!
        components.path = "/auth/v1/token"
        components.queryItems = [URLQueryItem(name: "grant_type", value: grantType)]
        return components.url
    }

    static func logoutURL(supabaseBase: URL) -> URL? {
        var components = URLComponents(url: supabaseBase, resolvingAgainstBaseURL: false)!
        components.path = "/auth/v1/logout"
        // scope=local only kills this device's session, so logging out of the
        // phone doesn't log the student out of the website too.
        components.queryItems = [URLQueryItem(name: "scope", value: "local")]
        return components.url
    }

    private static func makeRequest(url: URL, method: String, apiKey: String, bearer: String?, json: Data?) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(apiKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = json
        return request
    }

    private static func encodeJSON(_ object: [String: String]) -> Data? {
        try? JSONSerialization.data(withJSONObject: object)
    }

    // Shared decide-step for both grant types: 200 with tokens wins, network
    // errors are outages, and only an explicit Supabase auth answer is passed
    // on as rejection.
    private static func evaluate(_ data: Data, response: URLResponse?, wasNetworkError: Bool) -> Result<AuthSession, AuthFailure> {
        if wasNetworkError { return .failure(.unavailable) }
        let status = (response as? HTTPURLResponse)?.statusCode
        if status == 200, let tokenResponse = TokenResponse.parse(data) {
            return .success(AuthSession.from(tokenResponse, receivedAt: Date()))
        }
        return .failure(AuthErrors.failure(httpStatus: status, body: data, wasNetworkError: false))
    }

    func signIn(email: String, password: String) async -> Result<AuthSession, AuthFailure> {
        await grant(email: email, password: password)
    }

    // grant_type=refresh_token keeps the website and app sessions independent
    // from a single Supabase session; Supabase rotates both tokens on refresh.
    func withRefreshToken(_ refreshToken: String) async -> Result<AuthSession, AuthFailure> {
        guard let url = Self.tokenGrantURL(supabaseBase: config.supabaseURL, grantType: "refresh_token") else {
            return .failure(.unavailable)
        }
        let request = Self.makeRequest(
            url: url, method: "POST", apiKey: config.supabasePublishableKey,
            bearer: nil, json: Self.encodeJSON(["refresh_token": refreshToken])
        )
        do {
            let (data, response) = try await urlSession.data(for: request)
            return Self.evaluate(data, response: response, wasNetworkError: false)
        } catch {
            return .failure(.unavailable)
        }
    }

    private func grant(email: String, password: String) async -> Result<AuthSession, AuthFailure> {
        guard let url = Self.tokenGrantURL(supabaseBase: config.supabaseURL, grantType: "password") else {
            return .failure(.unavailable)
        }
        let request = Self.makeRequest(
            url: url, method: "POST", apiKey: config.supabasePublishableKey,
            bearer: nil, json: Self.encodeJSON(["email": email, "password": password])
        )
        do {
            let (data, response) = try await urlSession.data(for: request)
            return Self.evaluate(data, response: response, wasNetworkError: false)
        } catch {
            return .failure(.unavailable)
        }
    }

    // Best-effort revoke of this device's Supabase session. The caller clears
    // the Keychain regardless of the network result, so sign-out always sticks.
    func revoke(_ session: AuthSession) async {
        guard let url = Self.logoutURL(supabaseBase: config.supabaseURL) else { return }
        let request = Self.makeRequest(
            url: url, method: "POST", apiKey: config.supabasePublishableKey,
            bearer: session.accessToken, json: nil
        )
        _ = try? await urlSession.data(for: request)
    }
}
