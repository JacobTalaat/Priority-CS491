import XCTest
@testable import Priority

// Answers by "METHOD path"; a list is used in order and its last answer repeats.
@MainActor
final class APIFake: APIRequesting {
    var answers: [String: [APIResponse]] = [:]
    private(set) var calls: [String] = []
    private(set) var bodies: [[String: Any]] = []
    var holdPatch = false
    private var gate: CheckedContinuation<Void, Never>?

    func request(_ method: String, _ segments: [String], json: Data?, headers: [String: String]) async -> APIResponse {
        let key = "\(method) \(segments.joined(separator: "/"))"
        calls.append(key)
        if let json, let body = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any] { bodies.append(body) }
        if method == "PATCH", holdPatch { await withCheckedContinuation { gate = $0 } }
        guard var list = answers[key], let next = list.first else { return .offline }
        if list.count > 1 {
            list.removeFirst()
            answers[key] = list
        }
        return next
    }

    func release() {
        holdPatch = false
        gate?.resume()
        gate = nil
    }

    func set(_ key: String, _ json: String...) {
        answers[key] = json.map { .ok(Data($0.utf8)) }
    }
}

func gradeJSON(
    id: String = "c1", grade: String, letter: String = "null", confirmed: Bool = true,
    engine: String = "weighted", breakdown: String = "[]"
) -> String {
    """
    {"course":{"id":"\(id)","name":"Algorithms","courseCode":"CS 341","term":"Fall 2026"},
     "setupConfirmed":\(confirmed),"engine":"\(engine)","letter":\(letter),"grade":\(grade),
     "breakdown":\(breakdown),"finalExam":{"status":"no-final"},"shares":[]}
    """
}

private let listKey = "GET api/canvas/courses"
private let twoClasses = """
    {"connected":true,"courses":[
     {"id":"c1","name":"Algorithms","courseCode":"CS 341","term":"Fall 2026","termEndsAt":null},
     {"id":"c2","name":"Seminar","courseCode":null,"term":null,"termEndsAt":null}]}
    """

@MainActor
final class ClassesModelTests: XCTestCase {
    func testEachClassShowsItsGradeOrUnsupported() async {
        let api = APIFake()
        api.set(listKey, twoClasses)
        api.set("GET api/courses/c1/grade", gradeJSON(grade: #"{"status":"calculated","percentage":91.26}"#, letter: #""A-""#))
        api.set("GET api/courses/c2/grade", gradeJSON(id: "c2", grade: #"{"status":"unsupported","reason":"unsupported-rule"}"#))
        let model = ClassesModel(api: api)
        await model.load()
        guard case .ready(let courses) = model.phase else { return XCTFail("not ready") }
        XCTAssertEqual(courses.map(\.id), ["c1", "c2"])
        XCTAssertEqual(model.grades["c1"], .calculated(percentage: 91.26, letter: "A-", weightsConfirmed: true))
        XCTAssertEqual(model.grades["c2"], .unsupported)
    }

    func testOneFailedGradeOnlyMarksItsOwnRow() async {
        let api = APIFake()
        api.set(listKey, twoClasses)
        api.set("GET api/courses/c1/grade", gradeJSON(grade: #"{"status":"insufficient-data"}"#))
        api.answers["GET api/courses/c2/grade"] = [.failed(status: 500, message: nil)]
        let model = ClassesModel(api: api)
        await model.load()
        XCTAssertEqual(model.grades, ["c1": .noGrade, "c2": .unavailable])
    }

    func testCanvasNotConnected() async {
        let api = APIFake()
        api.set(listKey, #"{"connected":false,"courses":[]}"#)
        let model = ClassesModel(api: api)
        await model.load()
        XCTAssertEqual(model.phase, .notConnected)
    }

    func testOfflineFillsTheScreenFirstThenOnlyNotices() async {
        let api = APIFake()
        let model = ClassesModel(api: api)
        await model.load()
        guard case .problem(let problem) = model.phase else { return XCTFail("no problem") }
        XCTAssertTrue(problem.offline)

        api.set(listKey, #"{"connected":true,"courses":[]}"#)
        await model.load()
        XCTAssertEqual(model.phase, .ready([]))

        api.answers[listKey] = [.offline]
        await model.load()
        XCTAssertEqual(model.phase, .ready([]))
        XCTAssertEqual(model.notice, TodayMessages.offline)
    }

    func testGradesOfDroppedClassesAreForgotten() async {
        let api = APIFake()
        api.set(listKey, twoClasses, #"{"connected":true,"courses":[{"id":"c1","name":"Algorithms","courseCode":null,"term":null}]}"#)
        api.set("GET api/courses/c1/grade", gradeJSON(grade: #"{"status":"insufficient-data"}"#))
        api.set("GET api/courses/c2/grade", gradeJSON(id: "c2", grade: #"{"status":"insufficient-data"}"#))
        let model = ClassesModel(api: api)
        await model.load()
        await model.load()
        XCTAssertEqual(Set(model.grades.keys), ["c1"])
    }
}

@MainActor
final class ClassDetailModelTests: XCTestCase {
    private let key = "GET api/courses/c1/grade"

    func testLoadsTheBreakdown() async {
        let api = APIFake()
        api.set(key, gradeJSON(
            grade: #"{"status":"calculated","percentage":90}"#,
            breakdown: #"[{"category":"Homework","weight":40,"percentage":90,"pointsEarned":18,"pointsPossible":20,"gradedCount":1,"ungradedCount":0}]"#
        ))
        let model = ClassDetailModel(courseId: "c1", api: api)
        await model.load()
        guard case .ready(let data) = model.phase else { return XCTFail("not ready") }
        XCTAssertEqual(data.breakdown.map(\.category), ["Homework"])
        XCTAssertEqual(ClassFormat.categoryLine(data.breakdown[0]), "90% · 18 of 20 points · 1 graded")
    }

    func testAClassThatIsGoneSaysSoEvenAfterLoading() async {
        let api = APIFake()
        api.answers[key] = [
            .ok(Data(gradeJSON(grade: #"{"status":"insufficient-data"}"#).utf8)),
            .failed(status: 404, message: "Current course not found."),
        ]
        let model = ClassDetailModel(courseId: "c1", api: api)
        await model.load()
        await model.load()
        XCTAssertEqual(model.phase, .problem(ClassDetailModel.notFound))
    }

    func testFailedReloadKeepsTheClassOnScreen() async {
        let api = APIFake()
        api.answers[key] = [.ok(Data(gradeJSON(grade: #"{"status":"insufficient-data"}"#).utf8)), .offline]
        let model = ClassDetailModel(courseId: "c1", api: api)
        await model.load()
        await model.load()
        guard case .ready = model.phase else { return XCTFail("class was dropped") }
        XCTAssertEqual(model.notice, TodayMessages.offline)
    }

    func testUnreadableAnswerIsAProblem() async {
        let api = APIFake()
        api.set(key, gradeJSON(grade: #"{"status":"something-new"}"#))
        let model = ClassDetailModel(courseId: "c1", api: api)
        await model.load()
        XCTAssertEqual(model.phase, .problem(ScreenProblem(title: ClassDetailModel.loadFailedTitle, message: ScreenProblem.serverTrouble)))
    }
}

final class ClassFormatTests: XCTestCase {
    private func category(
        percentage: Double?, earned: Double = 0, possible: Double = 0, graded: Int = 0, ungraded: Int = 0
    ) -> ClassGradeResponse.Category {
        .init(category: "Homework", weight: 40, percentage: percentage, pointsEarned: earned,
              pointsPossible: possible, gradedCount: graded, ungradedCount: ungraded)
    }

    // The sentences in src/lib/class-page.ts.
    func testCategoryLines() {
        XCTAssertEqual(ClassFormat.categoryLine(category(percentage: 81, earned: 81, possible: 100, graded: 2, ungraded: 1)),
                       "81% · 81 of 100 points · 2 graded, 1 to go")
        XCTAssertEqual(ClassFormat.categoryLine(category(percentage: nil, ungraded: 1)), "Nothing graded yet · 1 to go")
        XCTAssertEqual(ClassFormat.categoryLine(category(percentage: nil)), "No assignments in this category")
        XCTAssertEqual(ClassFormat.categoryLine(category(percentage: nil, earned: 2.5, graded: 1)), "2.5 bonus points · 1 graded")
    }

    func testPercentKeepsAtMostOneDecimal() {
        XCTAssertEqual(ClassFormat.percent(90), "90%")
        XCTAssertEqual(ClassFormat.percent(91.26), "91.3%")
        XCTAssertEqual(ClassFormat.percent(0), "0%")
    }

    func testEditLinkOpensThatClassOnTheWebsite() {
        let site = URL(string: "http://localhost:3000")!
        XCTAssertEqual(ClassFormat.editURL(website: site, courseId: "c1")?.absoluteString, "http://localhost:3000/weights?course=c1")
        XCTAssertEqual(ClassFormat.editURL(website: site, courseId: "a&b=c+d")?.absoluteString,
                       "http://localhost:3000/weights?course=a%26b%3Dc%2Bd")
        XCTAssertNil(ClassFormat.editURL(website: nil, courseId: "c1"))
    }
}
