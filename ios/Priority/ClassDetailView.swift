import SwiftUI

// One class: its grade, the breakdown by category, and a link to the website,
// where weights are edited.
struct ClassDetailView: View {
    let link: ClassLink
    @ObservedObject var auth: AuthModel
    @StateObject private var model: ClassDetailModel

    init(link: ClassLink, auth: AuthModel) {
        self.link = link
        self.auth = auth
        _model = StateObject(wrappedValue: ClassDetailModel(courseId: link.courseId, api: auth))
    }

    var body: some View {
        List {
            if let notice = model.notice {
                NoticeText(text: notice)
                    .listRowBackground(TodayView.surface)
            }
            if case .ready(let data) = model.phase {
                summary(data)
                breakdown(data)
                if let url = ClassFormat.editURL(website: auth.websiteURL, courseId: link.courseId) {
                    Section {
                        Link(destination: url) {
                            Label("Edit on the website", systemImage: "arrow.up.right.square")
                        }
                    } footer: {
                        Text("Weights, categories and class details are edited on the Priority website.")
                    }
                    .listRowBackground(TodayView.surface)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(TodayView.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await Task { await model.load() }.value }
        .overlay { overlay }
        .task { await model.load() }
    }

    private var title: String {
        if case .ready(let data) = model.phase { return data.course.name }
        return link.name ?? "Class"
    }

    @ViewBuilder
    private var overlay: some View {
        switch model.phase {
        case .loading:
            ProgressView("Loading this class…")
                .foregroundStyle(TodayView.secondary)
        case .problem(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .ready:
            EmptyView()
        }
    }

    private func summary(_ data: ClassGradeResponse) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(ClassFormat.subtitle(code: data.course.courseCode, term: data.course.term))
                    .font(.subheadline)
                    .foregroundStyle(TodayView.secondary)
                switch data.grade {
                case .calculated(let percentage):
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(ClassFormat.percent(percentage))
                            .font(.largeTitle.weight(.bold).monospacedDigit())
                            .foregroundStyle(.white)
                        if let letter = data.letter {
                            Text(letter)
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(Color.accentColor)
                        }
                    }
                    Text(data.engine == "weighted"
                         ? "Weighted by the grade setup you confirmed."
                         : "Based on total points, not weights.")
                        .font(.footnote)
                        .foregroundStyle(TodayView.secondary)
                case .insufficientData:
                    headline("No grade yet", detail: ClassFormat.noGradeDetail)
                case .unsupported(let reason):
                    headline("Unsupported", detail: ClassFormat.unsupportedDetail(reason))
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        }
        .listRowBackground(TodayView.surface)
    }

    @ViewBuilder
    private func headline(_ text: String, detail: String) -> some View {
        Text(text)
            .font(.title2.weight(.bold))
            .foregroundStyle(.white)
        Text(detail)
            .font(.footnote)
            .foregroundStyle(TodayView.secondary)
    }

    @ViewBuilder
    private func breakdown(_ data: ClassGradeResponse) -> some View {
        Section("By category") {
            if data.breakdown.isEmpty {
                Text(emptyBreakdown(data))
                    .font(.subheadline)
                    .foregroundStyle(TodayView.secondary)
            }
            ForEach(Array(data.breakdown.enumerated()), id: \.offset) { _, category in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(category.category)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(ClassFormat.percent(category.weight)) of grade")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(TodayView.secondary)
                    }
                    Text(ClassFormat.categoryLine(category))
                        .font(.subheadline)
                        .foregroundStyle(TodayView.secondary)
                }
                .padding(.vertical, 2)
                .accessibilityElement(children: .combine)
            }
        }
        .listRowBackground(TodayView.surface)
    }

    private func emptyBreakdown(_ data: ClassGradeResponse) -> String {
        if case .unsupported = data.grade { return "There's no breakdown while this class is unsupported." }
        return data.setupConfirmed
            ? "This class is graded on total points, so there are no categories."
            : "Confirm this class's weights on the website to see a breakdown."
    }
}
