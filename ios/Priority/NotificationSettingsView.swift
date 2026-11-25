import SwiftUI

// The same choices as the website's Notification preferences.
struct NotificationSettingsView: View {
    @StateObject private var model: NotificationSettingsModel

    init(auth: AuthModel) {
        _model = StateObject(wrappedValue: NotificationSettingsModel(api: auth))
    }

    var body: some View {
        List {
            if let notice = model.notice {
                NoticeText(text: notice)
                    .listRowBackground(TodayView.surface)
            }
            if model.phase == .ready {
                Section {
                    toggle("Tonight", "Your top work for the evening, at your reminder time.", \.notifyTonight)
                    toggle("Due tomorrow", "Work due tomorrow, at your reminder time.", \.notifyDueTomorrow)
                    toggle("Grade posted", "A notification when a new grade is available.", \.notifyGradePosted)
                }
                .listRowBackground(TodayView.surface)

                Section {
                    DatePicker("Reminder time", selection: time, displayedComponents: .hourAndMinute)
                        .environment(\.timeZone, TodayFormat.timeZone)
                        .environment(\.calendar, ReminderTime.calendar)
                        .disabled(!model.canEditTime)
                } footer: {
                    Text("When Tonight and Due tomorrow arrive, in New York time.")
                }
                .listRowBackground(TodayView.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .background(TodayView.background)
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await Task { await model.load() }.value }
        .overlay { overlay }
        .task { await model.load() }
    }

    @ViewBuilder
    private var overlay: some View {
        switch model.phase {
        case .loading:
            ProgressView("Loading notification settings…")
                .foregroundStyle(TodayView.secondary)
        case .problem(let problem):
            ProblemView(problem: problem) { await model.load() }
        case .ready:
            EmptyView()
        }
    }

    private func toggle(
        _ title: String, _ detail: String, _ field: WritableKeyPath<NotificationPreferences, Bool>
    ) -> some View {
        Toggle(isOn: Binding(
            get: { model.values[keyPath: field] },
            set: { on in model.update { $0[keyPath: field] = on } }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(TodayView.secondary)
            }
        }
        .tint(.accentColor)
    }

    private var time: Binding<Date> {
        Binding(
            get: { ReminderTime.date(from: model.values.nightlyReminderTime) ?? Date() },
            set: { date in model.update { $0.nightlyReminderTime = ReminderTime.string(from: date) } }
        )
    }
}
