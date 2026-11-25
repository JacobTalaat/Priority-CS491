import Foundation

// The grade shown on one row of the class list.
enum CardGrade: Equatable {
    case calculated(percentage: Double, letter: String?, weightsConfirmed: Bool)
    case noGrade
    case unsupported
    case unavailable

    static func from(_ response: ClassGradeResponse) -> CardGrade {
        switch response.grade {
        case .calculated(let percentage):
            return .calculated(percentage: percentage, letter: response.letter, weightsConfirmed: response.setupConfirmed)
        case .insufficientData:
            return .noGrade
        case .unsupported:
            return .unsupported
        }
    }
}

@MainActor
final class ClassesModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case problem(ScreenProblem)
        case notConnected
        case ready([ClassListResponse.Course])
    }

    static let loadFailedTitle = "Couldn't load your classes"

    @Published private(set) var phase: Phase = .loading
    // Missing means still loading.
    @Published private(set) var grades: [String: CardGrade] = [:]
    @Published private(set) var notice: String?

    private let api: any APIRequesting
    private var generation = 0

    init(api: any APIRequesting) {
        self.api = api
    }

    func load() async {
        generation += 1
        let current = generation
        let response = await api.get(["api", "canvas", "courses"])
        // A cancelled request comes back as "offline" but says nothing about
        // the network; the next appearance loads again.
        guard current == generation, !Task.isCancelled else { return }

        guard case .ok(let data) = response, let list = ClassListResponse.parse(data) else {
            if let problem = ScreenProblem.from(response, title: Self.loadFailedTitle) { show(problem) }
            return
        }
        notice = nil
        guard list.connected else {
            grades = [:]
            phase = .notConnected
            return
        }
        // Grades already on screen stay there until the new ones arrive.
        let ids = Set(list.courses.map(\.id))
        grades = grades.filter { ids.contains($0.key) }
        phase = .ready(list.courses)
        await loadGrades(list.courses, generation: current)
    }

    // One request per class: a failing one only marks its own row.
    private func loadGrades(_ courses: [ClassListResponse.Course], generation current: Int) async {
        let api = self.api
        await withTaskGroup(of: (String, CardGrade?).self) { group in
            for course in courses {
                group.addTask { @MainActor in
                    let response = await api.get(["api", "courses", course.id, "grade"])
                    switch response {
                    case .ok(let data):
                        return (course.id, ClassGradeResponse.parse(data).map(CardGrade.from) ?? .unavailable)
                    case .signedOut:
                        return (course.id, nil)
                    case .offline, .failed:
                        return (course.id, .unavailable)
                    }
                }
            }
            for await (id, grade) in group {
                guard current == generation, !Task.isCancelled else { continue }
                if let grade { grades[id] = grade }
            }
        }
    }

    private func show(_ problem: ScreenProblem) {
        if case .ready = phase {
            notice = problem.message
        } else {
            phase = .problem(problem)
        }
    }
}
