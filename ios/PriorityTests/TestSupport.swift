import Foundation
import XCTest
@testable import Priority

// Captures every request and lets tests answer with canned responses. A gate
// keeps a response pending so tests can interleave sign-out with a refresh.
final class PolicyURLProtocol: URLProtocol {
    struct Response {
        var status: Int
        var body: Data
    }

    nonisolated(unsafe) private static let lock = NSLock()
    // handler keyed by request path (incl. query); nil handler = network error.
    nonisolated(unsafe) static var handlers: [String: (URLRequest) -> Response] = [:]
    // Or a consume-in-order sequence for requests whose answers differ per call.
    nonisolated(unsafe) static var sequences: [String: [Response]] = [:]
    nonisolated(unsafe) static var sequenceIndex: [String: Int] = [:]
    nonisolated(unsafe) static var requests: [String] = []
    nonisolated(unsafe) static var bearers: [String?] = []
    // When set, progress on this path blocks until releaseGate() is called.
    nonisolated(unsafe) static var gatedPath: String?

    private static var blocker: DispatchSemaphore?

    static func reset() {
        lock.lock()
        handlers = [:]
        sequences = [:]
        sequenceIndex = [:]
        requests = []
        bearers = []
        gatedPath = nil
        blocker = nil
        lock.unlock()
    }

    static func set(_ status: Int, forPath path: String, json: String) {
        lock.lock()
        defer { lock.unlock() }
        handlers[path] = { _ in Response(status: status, body: Data(json.utf8)) }
    }

    static func setSequence(forPath path: String, _ statuses: [(Int, String)]) {
        lock.lock()
        defer { lock.unlock() }
        sequences[path] = statuses.map { Response(status: $0.0, body: Data($0.1.utf8)) }
        sequenceIndex[path] = 0
    }

    private static func nextSequenceResponse(for path: String) -> Response? {
        lock.lock()
        defer { lock.unlock() }
        guard let list = sequences[path], !list.isEmpty else { return nil }
        let index = min(sequenceIndex[path] ?? 0, list.count - 1)
        sequenceIndex[path] = index + 1
        return list[index]
    }

    static func setNetworkFailure(forPath path: String) {
        lock.lock()
        defer { lock.unlock() }
        // A missing handler makes the protocol throw, i.e. a transport error.
        handlers[path] = nil
    }

    static func gateRequest(toPath path: String) {
        lock.lock()
        defer { lock.unlock() }
        gatedPath = path
        blocker = DispatchSemaphore(value: 0)
    }

    static func releaseGate() {
        lock.lock()
        defer { lock.unlock() }
        gatedPath = nil
        blocker?.signal()
    }

    private static func waitOnGate() {
        lock.lock()
        let semaphore = blocker
        lock.unlock()
        _ = semaphore?.wait(timeout: .distantFuture)
    }

    static func calls(toPath path: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return requests.filter { $0.hasPrefix(path) }.count
    }

    // Authorization header per recorded call, same index as requests, so a
    // test can assert which token actually went out.
    static func bearerOfCall(index: Int) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard index < bearers.count else { return nil }
        return bearers[index]
    }

    static func bearersOfCalls(toPath path: String) -> [String?] {
        lock.lock()
        defer { lock.unlock() }
        return requests.indices.filter { requests[$0].hasPrefix(path) }.map { bearers[$0] }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url
        let path = url.map { $0.path + (URLComponents(url: $0, resolvingAgainstBaseURL: false)?.query.map { "?\($0)" } ?? "") } ?? ""
        Self.lock.lock()
        let handler = Self.handlers[path]
        Self.requests.append(path)
        Self.bearers.append(request.value(forHTTPHeaderField: "Authorization"))
        let gate = Self.gatedPath == path
        Self.lock.unlock()

        if gate { Self.waitOnGate() }
        let canned = handler.map { $0(request) } ?? Self.nextSequenceResponse(for: path)
        guard let response = canned else {
            // No handler and no sequence: simulate a transport failure.
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let http = HTTPURLResponse(url: url!, statusCode: response.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: response.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

enum TestTransport {
    static func urlSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PolicyURLProtocol.self]
        return URLSession(configuration: config)
    }
}

// TokenStoring fake with injectable failures for every round-trip.
final class StoreFake: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    var stored: AuthSession?
    var failSave = false
    var failDelete = false

    func seed(_ session: AuthSession?) {
        lock.lock()
        defer { lock.unlock() }
        stored = session
    }

    func readSession() -> AuthSession? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func saveSession(_ session: AuthSession) throws {
        lock.lock()
        defer { lock.unlock() }
        if failSave { throw KeychainError.saveFailed(-25300) }
        stored = session
    }

    func deleteSession() throws {
        lock.lock()
        defer { lock.unlock() }
        if failDelete { throw KeychainError.deleteFailed(-25299) }
        stored = nil
    }
}

let testAppConfig = AppConfig(
    supabaseURL: URL(string: "https://supa.test")!,
    supabasePublishableKey: "test-publishable-key",
    apiBaseURL: URL(string: "https://api.test")!
)

let tokenGrantPath = "/auth/v1/token?grant_type=password"
let tokenRefreshPath = "/auth/v1/token?grant_type=refresh_token"
let tokenLogoutPath = "/auth/v1/logout?scope=local"
let mePath = "/api/auth/me"

extension PolicyURLProtocol {
    static func setTokenResponse(_ status: Int, access: String, refresh: String, expiresIn: Int, forPath path: String) {
        set(
            status,
            forPath: path,
            json: #"{"access_token":"\#(access)","refresh_token":"\#(refresh)","expires_in":\#(expiresIn),"token_type":"bearer"}"#
        )
    }
}

@MainActor
func waitUntilMainActor(timeout: TimeInterval = 3, _ condition: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
    return condition()
}

func freshTestDefaults() -> UserDefaults {
    UserDefaults(suiteName: "test-\(UUID().uuidString)")!
}

// AuthFetching fake: sign-in answers are instant, but the next refresh waits
// on a gate so tests can interleave a sign-out mid-refresh.
final class AuthFetcherFake: AuthFetching {
    private let lock = NSLock()
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var gateArmed = false
    var refreshStartedCount = 0
    var revokeCount = 0
    var signInResult: Result<AuthSession, AuthFailure> = .success(
        AuthSession(accessToken: "at-si", refreshToken: "rt-si", accessTokenExpiresAt: Date().addingTimeInterval(3_600))
    )
    var refreshResult: Result<AuthSession, AuthFailure> = .success(
        AuthSession(accessToken: "at-fresh", refreshToken: "rt-fresh", accessTokenExpiresAt: Date().addingTimeInterval(3_600))
    )

    func signIn(email: String, password: String) async -> Result<AuthSession, AuthFailure> {
        signInResult
    }

    func withRefreshToken(_ refreshToken: String) async -> Result<AuthSession, AuthFailure> {
        lock.lock()
        refreshStartedCount += 1
        let gated = gateArmed
        lock.unlock()
        if gated {
            await withCheckedContinuation { continuation in
                lock.lock()
                waiters.append(continuation)
                lock.unlock()
            }
        }
        return refreshResult
    }

    func revoke(_ session: AuthSession) async {
        lock.lock()
        revokeCount += 1
        lock.unlock()
    }

    // Only the next refresh blocks; after releaseAllWaiters the gate is off.
    func blockNextRefresh() {
        lock.lock()
        defer { lock.unlock() }
        gateArmed = true
    }

    func releaseAllWaiters() {
        lock.lock()
        let pending = waiters
        waiters.removeAll()
        gateArmed = false
        lock.unlock()
        pending.forEach { $0.resume() }
    }

    func setNext(isRefreshResult result: Result<AuthSession, AuthFailure>) {
        lock.lock()
        defer { lock.unlock() }
        refreshResult = result
    }
}
