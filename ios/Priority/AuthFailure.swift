import Foundation

// Every sign-in problem the UI can show. The message strings are the ones the
// website shows, so the app feels like the same product (the wording lives in
// src/lib/auth-client.ts on the web side).
enum AuthFailure: Error, Equatable {
    case wrongCredentials
    case emailNotConfirmed
    case unavailable
    // Supabase refused the request with an auth error code, but not one with
    // its own screen-worthy wording. Sign-in shows a retry message; the
    // session layer treats any .rejection as "this session is finished".
    case rejection
    case storageFailed
}

extension AuthFailure {
    // Everything except a network outage means Supabase itself said no, which
    // is the boundary for treating the session as dead.
    var isAuthRejection: Bool {
        switch self {
        case .wrongCredentials, .emailNotConfirmed, .rejection: return true
        case .unavailable, .storageFailed: return false
        }
    }
}

enum AuthErrors {
    static let wrongCredentialsMessage = "Wrong email or password. Check them and try again."
    static let emailNotConfirmedMessage = "Confirm your email first. Check your inbox for the link."
    static let networkMessage = "Couldn't reach Priority. Check your connection."
    static let genericMessage = "Something went wrong. Please try again."
    static let storageFailedMessage = "Couldn't save your sign-in on this iPhone. Try again."
    static let signOutStorageMessage = "Priority couldn't finish signing you out on this iPhone. It will be cleaned up next time you open the app."

    static func message(for failure: AuthFailure) -> String {
        switch failure {
        case .wrongCredentials: return wrongCredentialsMessage
        case .emailNotConfirmed: return emailNotConfirmedMessage
        case .unavailable: return networkMessage
        case .rejection: return genericMessage
        case .storageFailed: return storageFailedMessage
        }
    }

    // Supabase answers with a structured error_code, so branches on that code
    // instead of the human-readable message, which can change under us.
    static func rejection(fromErrorCode code: String?) -> AuthFailure {
        switch code {
        case "invalid_credentials": return .wrongCredentials
        case "email_not_confirmed": return .emailNotConfirmed
        default: return .rejection
        }
    }

    static func failure(httpStatus: Int?, body: Data?, wasNetworkError: Bool) -> AuthFailure {
        if wasNetworkError { return .unavailable }
        if httpStatus == 400 || httpStatus == 401 || httpStatus == 422 {
            return rejection(fromErrorCode: SupabaseErrorBody(data: body ?? Data())?.errorCode)
        }
        // 5xx, 404 and friends are outages, not auth answers: keep the session.
        return .unavailable
    }
}
