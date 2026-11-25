import SwiftUI

struct AccountView: View {
    @ObservedObject var auth: AuthModel
    @StateObject private var model: AccountModel
    @State private var confirmingLogOut = false
    @State private var loggingOut = false

    init(auth: AuthModel) {
        self.auth = auth
        _model = StateObject(wrappedValue: AccountModel(api: auth))
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        let marketing = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(marketing) (\(build))"
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row("Email", value: model.email)
                    row("Last synced", value: model.lastSynced)
                }
                .listRowBackground(TodayView.surface)

                Section {
                    NavigationLink {
                        NotificationSettingsView(auth: auth)
                    } label: {
                        Label("Notifications", systemImage: "bell")
                    }
                    LabeledContent("Version", value: version)
                }
                .listRowBackground(TodayView.surface)

                Section {
                    Button("Log out", role: .destructive) { confirmingLogOut = true }
                        .disabled(loggingOut)
                }
                .listRowBackground(TodayView.surface)
            }
            .scrollContentBackground(.hidden)
            .background(TodayView.background)
            .navigationTitle("Account")
            .toolbar { BrandToolbarItem() }
            .refreshable { await Task { await model.load() }.value }
            .confirmationDialog("Log out of Priority?", isPresented: $confirmingLogOut, titleVisibility: .visible) {
                Button("Log out", role: .destructive) {
                    loggingOut = true
                    Task { await auth.signOut() }
                }
            }
        }
        .task { await model.load() }
    }

    private func row(_ label: String, value: AccountModel.Value) -> some View {
        LabeledContent(label) {
            switch value {
            case .loading: ProgressView()
            case .loaded(let text): Text(text).textSelection(.enabled)
            case .unavailable: Text("Couldn't load")
            }
        }
    }
}
