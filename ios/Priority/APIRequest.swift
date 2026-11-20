import Foundation

// What one call to the Priority API came back with. "offline" means no HTTP
// answer at all (no internet, DNS, timeout), which gets its own message and a
// retry; any other failure carries the API's own error text when it sent one.
enum APIResponse: Equatable {
    case ok(Data)
    case signedOut
    case offline
    case failed(status: Int, message: String?)
}

enum APIRequest {
    // Builds {apiBase}{path}. Each path segment is passed separately and
    // percent-encoded on its own, so an id can never add a segment or a query.
    static func url(apiBase: URL, segments: [String]) -> URL? {
        guard var components = URLComponents(url: apiBase, resolvingAgainstBaseURL: false) else { return nil }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let encoded = segments.map { $0.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
        guard !encoded.contains("") else { return nil }
        components.percentEncodedPath = "/" + encoded.joined(separator: "/")
        components.query = nil
        components.fragment = nil
        return components.url
    }

    // The website's API answers errors as {"error": "..."}.
    static func errorMessage(from data: Data) -> String? {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let message = object["error"] as? String,
              !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return message
    }

    static func response(data: Data, status: Int?) -> APIResponse {
        guard let status else { return .offline }
        if (200..<300).contains(status) { return .ok(data) }
        if status == 401 { return .signedOut }
        return .failed(status: status, message: errorMessage(from: data))
    }
}

extension APIClient {
    // One request with the given access token. A thrown URLSession error is
    // "offline"; every HTTP answer, even a 500, is the API's own answer.
    func send(
        _ session: AuthSession,
        method: String,
        segments: [String],
        json: Data? = nil,
        headers: [String: String] = [:]
    ) async -> APIResponse {
        guard let url = APIRequest.url(apiBase: apiBaseURL, segments: segments) else {
            return .failed(status: 0, message: nil)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let json {
            request.httpBody = json
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await urlSession.data(for: request)
            return APIRequest.response(data: data, status: (response as? HTTPURLResponse)?.statusCode)
        } catch {
            return .offline
        }
    }
}
