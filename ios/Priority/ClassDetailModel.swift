import Foundation

@MainActor
final class ClassDetailModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case problem(ScreenProblem)
        case ready(ClassGradeResponse)
    }

    static let loadFailedTitle = "Couldn't load this class"
    static let notFound = ScreenProblem(
        title: "Class not found",
        message: "This class isn't one of your current classes."
    )

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var notice: String?

    let courseId: String
    private let api: any APIRequesting
    private var generation = 0

    init(courseId: String, api: any APIRequesting) {
        self.courseId = courseId
        self.api = api
    }

    func load() async {
        generation += 1
        let current = generation
        let response = await api.get(["api", "courses", courseId, "grade"])
        guard current == generation, !Task.isCancelled else { return }

        if case .ok(let data) = response, let parsed = ClassGradeResponse.parse(data) {
            notice = nil
            phase = .ready(parsed)
            return
        }
        // The class was dropped or its term ended, so what's on screen is gone too.
        if case .failed(404, _) = response {
            phase = .problem(Self.notFound)
            return
        }
        guard let problem = ScreenProblem.from(response, title: Self.loadFailedTitle) else { return }
        if case .ready = phase {
            notice = problem.message
        } else {
            phase = .problem(problem)
        }
    }
}
