import XCTest
@testable import Priority

// A TodayAPI whose answers the test sets, with optional gates so a test can
// hold a Done request open while it taps Undo.
@MainActor
final class TodayAPIFake: TodayAPI {
    var todayResponses: [APIResponse] = []
    var syncResponse: APIResponse = .ok(Data("{}".utf8))
    var doneResponse: APIResponse = .ok(Data("{}".utf8))
    var undoResponse: APIResponse = .ok(Data("{}".utf8))
    var doneGate: CheckedContinuation<Void, Never>?
    var holdDone = false

    private(set) var calls: [String] = []
    private(set) var doneRanks: [Int] = []
    private(set) var doneListIds: [String] = []

    func today() async -> APIResponse {
        calls.append("today")
        return todayResponses.isEmpty ? .offline : todayResponses.removeFirst()
    }

    func markDone(_ assignmentId: String, rank: Int, listGeneratedAt: String, requestId: String) async -> APIResponse {
        calls.append("done \(assignmentId)")
        doneRanks.append(rank)
        doneListIds.append(listGeneratedAt)
        if holdDone {
            await withCheckedContinuation { doneGate = $0 }
        }
        return doneResponse
    }

    func releaseDone() {
        doneGate?.resume()
        doneGate = nil
    }

    func undo(_ assignmentId: String, requestId: String) async -> APIResponse {
        calls.append("undo \(assignmentId)")
        return undoResponse
    }

    func syncNow() async -> APIResponse {
        calls.append("sync")
        return syncResponse
    }
}

func todayJSON(_ ids: [String], generatedAt: String = "2026-11-16T15:00:00.000Z") -> APIResponse {
    let items = ids.map { id in
        """
        {"rank":1,"assignmentId":"\(id)","courseId":"c1","courseName":"CS 490","title":"Task \(id)",
         "htmlUrl":"https://njit.instructure.com/courses/1/assignments/\(id)","dueAt":"2026-11-17T04:59:00.000Z",
         "dueDay":"2026-11-16","overdue":false,"share":12.4,"hours":2,"estimated":true,"score":0.8,
         "reason":"Due tonight and worth 12% of your grade.","boundary":null}
        """
    }
    return .ok(Data(#"{"generatedAt":"\#(generatedAt)","items":[\#(items.joined(separator: ","))],"hoursFilter":null}"#.utf8))
}

// Lets queued main-actor tasks (the Done follow-up) run.
func settle() async {
    for _ in 0..<20 { await Task.yield() }
}

@MainActor
final class TodayModelTests: XCTestCase {
    private func loaded(_ fake: TodayAPIFake, _ ids: [String]) async -> TodayModel {
        fake.todayResponses = [todayJSON(ids)]
        let model = TodayModel(api: fake, undoSeconds: 60)
        await model.load()
        return model
    }

    // The list keeps the server's order and reasons.
    func testLoadShowsItemsInServerOrder() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["b", "a", "c"])
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.items.map(\.assignmentId), ["b", "a", "c"])
        XCTAssertEqual(model.items.first?.reason, "Due tonight and worth 12% of your grade.")
    }

    func testEmptyListIsReadyWithNoItems() async {
        let model = await loaded(TodayAPIFake(), [])
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testNoInternetShowsOfflineProblemAndRetryLoads() async {
        let fake = TodayAPIFake()
        fake.todayResponses = [.offline, todayJSON(["a"])]
        let model = TodayModel(api: fake)
        await model.load()
        XCTAssertEqual(model.phase, .problem(.offline))
        XCTAssertEqual(TodayProblem.offline.title, "You're offline")

        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.items.count, 1)
    }

    func testServerErrorShowsItsMessage() async {
        let fake = TodayAPIFake()
        fake.todayResponses = [.failed(status: 500, message: "Database unavailable")]
        let model = TodayModel(api: fake)
        await model.load()
        XCTAssertEqual(model.phase, .problem(.failed("Database unavailable")))
    }

    func testFailedReloadKeepsTheListAndShowsANotice() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a"])
        fake.todayResponses = [.offline]
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.items.count, 1)
        XCTAssertEqual(model.notice, TodayMessages.offline)
    }

    // Swipe: the row leaves at once, the API gets the rank it was shown at,
    // and the list reloads after the Done saves.
    func testMarkDoneRemovesRowAndCallsAPI() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a", "b", "c"])
        fake.todayResponses = [todayJSON(["a", "c"])]
        model.markDone(model.items[1])
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "c"])
        XCTAssertEqual(model.undoOffer?.item.assignmentId, "b")
        await settle()
        XCTAssertEqual(fake.calls, ["today", "done b", "today"])
        XCTAssertEqual(fake.doneRanks, [2])
        XCTAssertEqual(fake.doneListIds, ["2026-11-16T15:00:00.000Z"])
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "c"])
    }

    func testFailedDonePutsTheRowBackWithAMessage() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a", "b"])
        fake.doneResponse = .failed(status: 404, message: "Assignment not found.")
        model.markDone(model.items[0])
        await settle()
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "b"])
        XCTAssertNil(model.undoOffer)
        XCTAssertEqual(model.notice, "Couldn't mark “Task a” done. Assignment not found.")
    }

    // A reload that answers before the Done saved must not bring the row back.
    func testReloadDuringPendingDoneKeepsRowHidden() async {
        let fake = TodayAPIFake()
        fake.holdDone = true
        let model = await loaded(fake, ["a", "b"])
        model.markDone(model.items[0])
        await settle()
        fake.todayResponses = [todayJSON(["a", "b"])]
        await model.load()
        XCTAssertEqual(model.items.map(\.assignmentId), ["b"])
        fake.todayResponses = [todayJSON(["b"])]
        fake.releaseDone()
        await settle()
        XCTAssertEqual(model.items.map(\.assignmentId), ["b"])
    }

    // Undo waits for the Done to land, then undoes it on the server.
    func testUndoPutsRowBackInPlaceAfterDoneSaves() async {
        let fake = TodayAPIFake()
        fake.holdDone = true
        let model = await loaded(fake, ["a", "b", "c"])
        model.markDone(model.items[1])
        await settle()
        fake.todayResponses = [todayJSON(["a", "b", "c"])]
        let undo = Task { await model.undo() }
        await settle()
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "b", "c"])
        XCTAssertFalse(fake.calls.contains("undo b"))
        fake.releaseDone()
        await undo.value
        XCTAssertEqual(fake.calls.filter { $0.hasPrefix("undo") }, ["undo b"])
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "b", "c"])
        XCTAssertNil(model.undoOffer)
    }

    // The usual case: the Done saved seconds ago, so nothing is pending.
    func testUndoAfterTheDoneSavedIsSentToTheServer() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a", "b"])
        fake.todayResponses = [todayJSON(["b"]), todayJSON(["a", "b"])]
        model.markDone(model.items[0])
        await settle()
        XCTAssertEqual(model.items.map(\.assignmentId), ["b"])
        await model.undo()
        XCTAssertEqual(fake.calls.filter { $0.hasPrefix("undo") }, ["undo a"])
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "b"])
        XCTAssertNil(model.notice)
    }

    // Un-doing an item on the website brings it back here too.
    func testAnItemUnDoneOnTheWebsiteShowsAgain() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a", "b"])
        fake.todayResponses = [todayJSON(["b"]), todayJSON(["a", "b"])]
        model.markDone(model.items[0])
        await settle()
        XCTAssertEqual(model.items.map(\.assignmentId), ["b"])
        await model.load()
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "b"])
    }

    func testUndoOfADoneThatFailedSkipsTheServerUndo() async {
        let fake = TodayAPIFake()
        fake.holdDone = true
        fake.doneResponse = .offline
        let model = await loaded(fake, ["a"])
        model.markDone(model.items[0])
        await settle()
        fake.todayResponses = [todayJSON(["a"])]
        let undo = Task { await model.undo() }
        await settle()
        fake.releaseDone()
        await undo.value
        XCTAssertFalse(fake.calls.contains("undo a"))
        XCTAssertEqual(model.items.map(\.assignmentId), ["a"])
        XCTAssertNil(model.notice)
    }

    func testUndoOfferExpires() async throws {
        let fake = TodayAPIFake()
        fake.todayResponses = [todayJSON(["a"])]
        let model = TodayModel(api: fake, undoSeconds: 0.05)
        await model.load()
        fake.todayResponses = [todayJSON([])]
        model.markDone(model.items[0])
        XCTAssertNotNil(model.undoOffer)
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertNil(model.undoOffer)
    }

    // Pull to refresh runs Sync now, then reloads.
    func testRefreshSyncsThenReloads() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a"])
        fake.todayResponses = [todayJSON(["a", "new"])]
        await model.refresh()
        XCTAssertEqual(fake.calls, ["today", "sync", "today"])
        XCTAssertEqual(model.items.map(\.assignmentId), ["a", "new"])
        XCTAssertNil(model.notice)
    }

    func testRefreshWithoutCanvasExplainsAndStillReloads() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a"])
        fake.syncResponse = .failed(status: 409, message: "Canvas not connected")
        fake.todayResponses = [todayJSON(["a"])]
        await model.refresh()
        XCTAssertEqual(fake.calls, ["today", "sync", "today"])
        XCTAssertEqual(model.notice, TodayMessages.canvasNotConnected)
    }

    func testRefreshOfflineKeepsListWithNotice() async {
        let fake = TodayAPIFake()
        let model = await loaded(fake, ["a"])
        fake.syncResponse = .offline
        await model.refresh()
        XCTAssertEqual(fake.calls, ["today", "sync"])
        XCTAssertEqual(model.items.count, 1)
        XCTAssertEqual(model.notice, TodayMessages.syncOffline)
    }

    func testRefreshOfflineWithNoListShowsOfflineState() async {
        let fake = TodayAPIFake()
        fake.todayResponses = [.offline]
        let model = TodayModel(api: fake)
        await model.load()
        fake.syncResponse = .offline
        await model.refresh()
        XCTAssertEqual(model.phase, .problem(.offline))
    }
}

final class TodayFormatTests: XCTestCase {
    // 10:00 AM Eastern on Mon, Nov 16, 2026.
    private let now = TodayFormat.parseDate("2026-11-16T15:00:00.000Z")!

    func testDueLabels() {
        XCTAssertEqual(TodayFormat.dueLabel("2026-11-17T04:59:00.000Z", overdue: false, now: now), "Due today, 11:59 PM")
        XCTAssertEqual(TodayFormat.dueLabel("2026-11-17T14:00:00Z", overdue: false, now: now), "Due tomorrow, 9:00 AM")
        XCTAssertEqual(TodayFormat.dueLabel("2026-11-21T04:59:00.000Z", overdue: false, now: now), "Due Fri, 11:59 PM")
        XCTAssertEqual(TodayFormat.dueLabel("2026-11-28T04:59:00.000Z", overdue: false, now: now), "Due Fri, Nov 27")
        XCTAssertEqual(TodayFormat.dueLabel("2026-11-11T04:59:00.000Z", overdue: true, now: now), "Overdue, was due Tue, Nov 10")
        XCTAssertEqual(TodayFormat.dueLabel(nil, overdue: false, now: now), "No due date")
        XCTAssertEqual(TodayFormat.dueLabel("not a date", overdue: false, now: now), "No due date")
    }

    func testShareLabels() {
        XCTAssertEqual(TodayFormat.shareLabel(12.4), "12%")
        XCTAssertEqual(TodayFormat.shareLabel(0.5), "1%")
        XCTAssertEqual(TodayFormat.shareLabel(0.2), "<1%")
        XCTAssertNil(TodayFormat.shareLabel(0))
        XCTAssertNil(TodayFormat.shareLabel(nil))
    }

    func testBoundaryTags() {
        XCTAssertEqual(TodayFormat.boundaryTag(.init(letter: "A-", direction: "at-risk")), "A- at risk")
        XCTAssertEqual(TodayFormat.boundaryTag(.init(letter: "B+", direction: "within-reach")), "B+ within reach")
        XCTAssertNil(TodayFormat.boundaryTag(nil))
    }

    func testOnlyHttpsCanvasLinksOpen() {
        XCTAssertNotNil(TodayFormat.canvasURL("https://njit.instructure.com/courses/1/assignments/2"))
        XCTAssertNil(TodayFormat.canvasURL("http://njit.instructure.com/x"))
        XCTAssertNil(TodayFormat.canvasURL("javascript:alert(1)"))
        XCTAssertNil(TodayFormat.canvasURL(nil))
    }

    func testParsesTheTodayResponse() {
        guard case .ok(let data) = todayJSON(["a"]) else { return XCTFail() }
        let parsed = TodayResponse.parse(data)
        XCTAssertEqual(parsed?.items.first?.courseName, "CS 490")
        XCTAssertEqual(parsed?.items.first?.share, 12.4)
    }
}

// The request path through AuthModel: bearer token, one refresh on 401, and
// ids that can't add path segments.
@MainActor
final class TodayRequestTests: XCTestCase {
    override func setUp() {
        super.setUp()
        PolicyURLProtocol.reset()
    }

    private func signedInModel() -> (AuthModel, StoreFake) {
        let store = StoreFake()
        store.seed(AuthSession(accessToken: "at-old", refreshToken: "rt-old", accessTokenExpiresAt: Date().addingTimeInterval(3_600)))
        let model = AuthModel(config: testAppConfig, tokenStore: store, urlSession: TestTransport.urlSession(), defaults: freshTestDefaults())
        model.restoreSession()
        return (model, store)
    }

    func testIdsAreEncodedAsOneSegment() {
        let url = APIRequest.url(apiBase: URL(string: "https://api.test")!, segments: ["api", "today", "items", "a/../b?x", "done"])
        XCTAssertEqual(url?.absoluteString, "https://api.test/api/today/items/a%2F..%2Fb%3Fx/done")
    }

    func testTodayRequestSendsBearer() async {
        let (model, _) = signedInModel()
        PolicyURLProtocol.set(200, forPath: "/api/today", json: #"{"generatedAt":"x","items":[]}"#)
        let response = await LiveTodayAPI(auth: model).today()
        guard case .ok = response else { return XCTFail("\(response)") }
        XCTAssertEqual(PolicyURLProtocol.bearersOfCalls(toPath: "/api/today"), ["Bearer at-old"])
    }

    func testNoConnectionIsOffline() async {
        let (model, _) = signedInModel()
        PolicyURLProtocol.setNetworkFailure(forPath: "/api/today")
        let response = await LiveTodayAPI(auth: model).today()
        XCTAssertEqual(response, .offline)
        XCTAssertEqual(model.state, .signedIn)
    }

    func testA401RefreshesOnceAndRetries() async {
        let (model, _) = signedInModel()
        PolicyURLProtocol.setSequence(forPath: "/api/today", [(401, "{}"), (200, #"{"generatedAt":"x","items":[]}"#)])
        PolicyURLProtocol.setTokenResponse(200, access: "at-new", refresh: "rt-new", expiresIn: 3_600, forPath: tokenRefreshPath)
        let response = await LiveTodayAPI(auth: model).today()
        guard case .ok = response else { return XCTFail("\(response)") }
        XCTAssertEqual(PolicyURLProtocol.bearersOfCalls(toPath: "/api/today"), ["Bearer at-old", "Bearer at-new"])
    }

    func testRefusedRefreshSignsOut() async {
        let (model, store) = signedInModel()
        PolicyURLProtocol.set(401, forPath: "/api/today", json: "{}")
        PolicyURLProtocol.set(400, forPath: tokenRefreshPath, json: #"{"error_code":"refresh_token_not_found"}"#)
        let response = await LiveTodayAPI(auth: model).today()
        XCTAssertEqual(response, .signedOut)
        XCTAssertEqual(model.state, .signedOut)
        XCTAssertNil(store.readSession())
    }

    func testServerErrorKeepsItsMessage() async {
        let (model, _) = signedInModel()
        PolicyURLProtocol.set(409, forPath: "/api/canvas/sync", json: #"{"error":"Canvas not connected"}"#)
        let response = await LiveTodayAPI(auth: model).syncNow()
        XCTAssertEqual(response, .failed(status: 409, message: "Canvas not connected"))
    }
}
