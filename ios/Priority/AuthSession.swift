import Foundation

// Parsed shape of Supabase's auth error body. GoTrue returns a numeric "code",
// a stable "error_code" and a "msg", depending on version, so the fields are
// all optional here.
struct SupabaseErrorBody {
    let errorCode: String?

    init?(data: Data) {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        if let code = object["error_code"] as? String {
            errorCode = code
        } else if let legacyCode = object["error"] as? String {
            // Older GoTrue versions put a code-ish string in "error".
            errorCode = legacyCode
        } else if let code = object["error_code"] as? Int {
            errorCode = String(code)
        } else {
            errorCode = nil
        }
    }
}

// The part of Supabase's token response the app needs to keep a session alive.
struct TokenResponse {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
}

extension TokenResponse {
    static func parse(_ data: Data) -> TokenResponse? {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let accessToken = object["access_token"] as? String, !accessToken.isEmpty,
              let refreshToken = object["refresh_token"] as? String, !refreshToken.isEmpty,
              let expiresIn = object["expires_in"] as? Int, expiresIn > 0 else { return nil }
        return TokenResponse(accessToken: accessToken, refreshToken: refreshToken, expiresIn: expiresIn)
    }
}

struct AuthSession: Equatable, Codable {
    let accessToken: String
    let refreshToken: String
    let accessTokenExpiresAt: Date

    init(accessToken: String, refreshToken: String, accessTokenExpiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
    }

    static func encode(_ session: AuthSession) -> Data {
        let encoder = JSONEncoder()
        // .secondsSince1970 keeps the full precision so a saved-then-read
        // session compares equal to the one in memory (ISO8601 truncates).
        encoder.dateEncodingStrategy = .secondsSince1970
        return (try? encoder.encode(session)) ?? Data()
    }

    static func decode(_ data: Data) -> AuthSession? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(AuthSession.self, from: data)
    }
}

extension AuthSession {
    // expiresIn counts seconds from the moment the response arrives.
    static func from(_ tokenResponse: TokenResponse, receivedAt: Date) -> AuthSession {
        AuthSession(
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken,
            accessTokenExpiresAt: receivedAt.addingTimeInterval(TimeInterval(tokenResponse.expiresIn))
        )
    }
}

// An access token is refreshed when it is within REFRESH_WINDOW of expiring.
enum TokenExpiry {
    static let refreshWindow: TimeInterval = 60

    static func isNearExpiry(expiresAt: Date, at now: Date) -> Bool {
        expiresAt.timeIntervalSince(now) < refreshWindow
    }
}
