import Foundation

enum AuthState: Equatable {
    case restoring
    case signedOut
    case signedIn
}

// A session whose refresh was refused by Supabase is finished; an outage is
// not, so the old token is kept and the request may just fail.
enum SessionOutcome {
    case ready(AuthSession)
    case signedOut
}

// What the account check decides, which drives the signed-in/signed-out split.
enum AccountCheck: Equatable {
    case confirmed
    case signedOut
    case unreachable
}

// What the model needs from Supabase Auth; AuthClient is the real one, tests
// inject a controllable fake.
protocol AuthFetching {
    func signIn(email: String, password: String) async -> Result<AuthSession, AuthFailure>
    func withRefreshToken(_ refreshToken: String) async -> Result<AuthSession, AuthFailure>
    func revoke(_ session: AuthSession) async
}

// The single place the app tracks whether a student is signed in. It owns the
// clients, the Keychain round-trip and which screen to show.
@MainActor
final class AuthModel: ObservableObject {
    @Published private(set) var state: AuthState = .restoring
    @Published private(set) var errorText: String?
    @Published private(set) var configProblem: String?
    @Published private(set) var isSigningIn = false
    @Published var email = ""
    @Published var password = ""

    private let config: AppConfig?
    private let tokenStore: TokenStoring
    private let authClient: (any AuthFetching)?
    private let apiClient: APIClient?
    private let defaults: UserDefaults

    // One in-flight refresh shared by every caller; never two racing writes.
    private var refreshTask: Task<Result<AuthSession, AuthFailure>, Never>?
    // A delete that failed during sign-out; retried on the next launch.
    private static let pendingDeleteKey = "priority.pendingSignOutDelete"
    private var pendingDelete: Bool

    init() {
        let problem = ConfigLoader.problem(Bundle.main.infoDictionary ?? [:])
        configProblem = problem?.message
        if problem == nil, let config = ConfigLoader.load() {
            self.config = config
            tokenStore = KeychainStore()
            let urlSession = URLSession(configuration: .ephemeral)
            authClient = AuthClient(config: config, urlSession: urlSession) as (any AuthFetching)
            apiClient = APIClient(config: config, urlSession: urlSession)
        } else {
            self.config = nil
            tokenStore = KeychainStore()
            authClient = nil
            apiClient = nil
        }
        defaults = .standard
        pendingDelete = defaults.bool(forKey: Self.pendingDeleteKey)
    }

    // The test seam: config, store, transport and defaults are all injectable.
    init(config: AppConfig?, tokenStore: TokenStoring, urlSession: URLSession?, defaults: UserDefaults, authFetcher: (any AuthFetching)? = nil) {
        configProblem = config == nil
            ? "Priority isn't set up on this device. Missing keys. See ios/Config.xcconfig in the repo."
            : nil
        self.config = config
        self.tokenStore = tokenStore
        if let config, let urlSession {
            apiClient = APIClient(config: config, urlSession: urlSession)
            authClient = authFetcher ?? { AuthClient(config: config, urlSession: urlSession) }()
        } else {
            authClient = nil
            apiClient = nil
        }
        self.defaults = defaults
        pendingDelete = defaults.bool(forKey: Self.pendingDeleteKey)
    }

    // Called once at launch. The Keychain is the source of truth; a network
    // check can't be fully trusted because being offline shouldn't log out.
    func restoreSession() {
        guard state == .restoring else { return }
        errorText = nil
        if pendingDelete {
            // Finish the sign-out delete that failed last time. Until it
            // succeeds, never surface the leftover session as signed in.
            do {
                try tokenStore.deleteSession()
                pendingDelete = false
                defaults.set(false, forKey: Self.pendingDeleteKey)
                state = .signedOut
            } catch {
                errorText = AuthErrors.signOutStorageMessage
                state = .signedOut
            }
            return
        }
        guard let session = tokenStore.readSession() else {
            state = .signedOut
            return
        }
        state = .signedIn
        if TokenExpiry.isNearExpiry(expiresAt: session.accessTokenExpiresAt, at: Date()) {
            Task { await refreshPostRestore() }
        }
    }

    // An old access token gets refreshed transparently; a refresh Supabase
    // refuses here means the stored session is unusable, so sign out instead
    // of leaving the student on a broken signed-in UI.
    private func refreshPostRestore() async {
        guard case .signedOut = await sessionOutcomeForRequest() else { return }
        await signOut()
    }

    func signIn() async {
        guard let authClient, let apiClient else { return }
        // Only reachable from the log-in screen; never from the restoring beat.
        if state == .restoring { state = .signedOut }
        isSigningIn = true
        errorText = nil
        defer { isSigningIn = false }

        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedEmail.isEmpty || password.isEmpty {
            errorText = "Enter your email and password."
            return
        }

        switch await authClient.signIn(email: trimmedEmail, password: password) {
        case .success(let session):
            do {
                try tokenStore.saveSession(session)
                storageFallback = nil
            } catch {
                // Nothing was persisted, so stay on the log-in screen.
                errorText = AuthErrors.storageFailedMessage
                return
            }
            // Confirm the token really belongs to this API account.
            let check = await confirmAccount()
            if check == .signedOut {
                await signOut()
                errorText = AuthErrors.genericMessage
                return
            }
            password = ""
            state = .signedIn
        case .failure(let failure):
            errorText = AuthErrors.message(for: failure)
        }
    }

    func signOut() async {
        if let session = tokenStore.readSession() {
            await authClient?.revoke(session)
        }
        do {
            try tokenStore.deleteSession()
            pendingDelete = false
            defaults.set(false, forKey: Self.pendingDeleteKey)
        } catch {
            // Keep asking on the next launch; the token stays where it was.
            pendingDelete = true
            defaults.set(true, forKey: Self.pendingDeleteKey)
            errorText = AuthErrors.signOutStorageMessage
        }
        password = ""
        storageFallback = nil
        state = .signedOut
    }

    // Checks the 60-second window before every API request.
    func sessionOutcomeForRequest() async -> SessionOutcome {
        guard let session = reloadSession() else { return .signedOut }

        if !TokenExpiry.isNearExpiry(expiresAt: session.accessTokenExpiresAt, at: Date()) {
            return .ready(session)
        }
        switch await sharedRefresh() {
        case .success(let fresh):
            return .ready(fresh)
        case .failure(.unavailable):
            // The API may still answer with the old token; if it comes back
            // 401 the confirm step refreshes once more and decides there.
            return .ready(session)
        case .failure(let failure):
            return failure.isAuthRejection ? .signedOut : .ready(session)
        }
    }

    // Test-visible (and reused by the sign-in path): runs the one-refresh
    // check against /api/auth/me and returns the verdict.
    func confirmAccount() async -> AccountCheck {
        guard let apiClient else { return .unreachable }
        switch await sessionOutcomeForRequest() {
        case .signedOut:
            return .signedOut
        case .ready(let session):
            let attempt = await apiClient.me(session)
            switch attempt {
            case .ok:
                return .confirmed
            case .unreachable:
                return .unreachable
            case .unauthorized:
                // Exactly one refresh and one retry; only a refresh Supabase
                // refuses ends this session.
                switch await sharedRefresh() {
                case .success(let fresh):
                    switch await apiClient.me(fresh) {
                    case .ok: return .confirmed
                    case .unauthorized: return .signedOut
                    case .unreachable: return .unreachable
                    }
                case .failure(let failure):
                    return failure.isAuthRejection ? .signedOut : .unreachable
                }
            }
        }
    }

    // The in-memory session used when the Keychain could not be updated after
    // a refresh (unknown until relaunch, Supabase rotates tokens so the stored
    // refresh token is dead — flagged for the student but not signed out now).
    private var storageFallback: AuthSession?

    // Single source of a session lookup: newest in-memory first.
    private func reloadSession() -> AuthSession? {
        storageFallback ?? tokenStore.readSession()
    }

    // Shared in-flight refresh: all callers awaiting at the same time get one
    // network round-trip and one persist.
    private func sharedRefresh() async -> Result<AuthSession, AuthFailure> {
        guard let authClient else { return .failure(.rejection) }
        if let running = refreshTask {
            // Joiner: reuse the in-flight refresh as-is (same network call,
            // same persist).
            return await running.value
        }
        guard let current = reloadSession() else {
            // Nothing refreshable left: the student is signed out.
            return .failure(.rejection)
        }
        let created = Task { [tokenStore] () -> Result<AuthSession, AuthFailure> in
            let result = await authClient.withRefreshToken(current.refreshToken)
            // Supabase rotates both tokens per refresh, so persist only if the
            // session this refresh started from is still the live one. If the
            // student signed out in the meantime the result is thrown away.
            if case .success(let fresh) = result,
               reloadSession()?.refreshToken == current.refreshToken {
                do {
                    try tokenStore.saveSession(fresh)
                    storageFallback = nil
                } catch {
                    // A failed save must not silently strand a dead session at
                    // relaunch; surface it like a sign-in storage failure.
                    storageFallback = fresh
                    errorText = AuthErrors.storageFailedMessage
                }
            }
            return result
        }
        refreshTask = created
        let result = await created.value
        // Once done the task must not be handed to later callers as if it
        // were a fresh refresh.
        refreshTask = nil
        return result
    }
}
