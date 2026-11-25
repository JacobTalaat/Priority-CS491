import SwiftUI

// Every current class with its grade. Tapping one opens its breakdown.
struct ClassesView: View {
    @ObservedObject var auth: AuthModel
    @ObservedObject var router: AppRouter
    @StateObject private var model: ClassesModel

    init(auth: AuthModel, router: AppRouter) {
        self.auth = auth
        self.router = router
        _model = StateObject(wrappedValue: ClassesModel(api: auth))
    }

    var body: some View {
        NavigationStack(path: $router.classPath) {
            list
                .navigationTitle("Classes")
                .toolbar { BrandToolbarItem() }
                .navigationDestination(for: ClassLink.self) { link in
                    ClassDetailView(link: link, auth: auth)
                        .id(link.visit)
                }
        }
        .task { await model.load() }
    }

    private var list: some View {
        List {
            if let notice = model.notice {
                NoticeText(text: notice)
                    .listRowBackground(TodayView.surface)
            }
            if case .ready(let courses) = model.phase {
                ForEach(courses) { course in
                    NavigationLink(value: ClassLink(courseId: course.id, name: course.name)) {
                        ClassRow(course: course, grade: model.grades[course.id])
                    }
                    .listRowBackground(TodayView.background)
                    .listRowSeparatorTint(TodayView.surface)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(TodayView.background)
        // SwiftUI can cancel the refresh task when the list redraws; the
        // unstructured task keeps the request going.
        .refreshable { await Task { await model.load() }.value }
        .overlay { overlay }
    }

    @ViewBuilder
    private var overlay: some View {
        switch model.phase {
        case .loading:
            ProgressView("Loading your classes…")
                .foregroundStyle(TodayView.secondary)
        case .problem(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .notConnected:
            ContentUnavailableView {
                Label("Canvas isn't connected", systemImage: "link")
            } description: {
                Text("Connect Canvas on the Priority website to see your classes here.")
            }
        case .ready(let courses) where courses.isEmpty:
            ContentUnavailableView {
                Label("No current classes yet", systemImage: "book.closed")
            } description: {
                Text("Pull down on Today to sync the classes in your current term.")
            }
        case .ready:
            EmptyView()
        }
    }
}

private struct ClassRow: View {
    let course: ClassListResponse.Course
    let grade: CardGrade?

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(course.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                Text(ClassFormat.subtitle(code: course.courseCode, term: course.term))
                    .font(.subheadline)
                    .foregroundStyle(TodayView.secondary)
                if case .calculated(_, _, false) = grade {
                    // The number is a points total until weights exist.
                    Text("Points only · weights not set up")
                        .font(.footnote)
                        .foregroundStyle(TodayView.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            gradeText
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var gradeText: some View {
        switch grade {
        case nil:
            ProgressView()
                .accessibilityLabel("Loading grade")
        case .calculated(let percentage, let letter, _):
            VStack(alignment: .trailing, spacing: 0) {
                if let letter {
                    Text(letter)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                }
                Text(ClassFormat.percent(percentage))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.white)
            }
        case .noGrade:
            muted("No grade yet")
        case .unsupported:
            muted("Unsupported")
        case .unavailable:
            muted("Grade unavailable")
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(TodayView.secondary)
            .multilineTextAlignment(.trailing)
    }
}
