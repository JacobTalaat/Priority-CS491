import SwiftUI

// The signed-in home screen: the ranked Today list. Swipe a row left to mark
// it done, pull down to sync with Canvas, tap a row to open it in Canvas.
// Colors match the website's theme tokens in src/app/globals.css.
struct TodayView: View {
    @ObservedObject var auth: AuthModel
    @StateObject private var model: TodayModel
    @Environment(\.openURL) private var openURL

    static let background = Color(red: 8 / 255, green: 9 / 255, blue: 10 / 255)
    static let secondary = Color(red: 155 / 255, green: 161 / 255, blue: 163 / 255)
    static let surface = Color(red: 22 / 255, green: 24 / 255, blue: 27 / 255)
    static let danger = Color(red: 242 / 255, green: 112 / 255, blue: 102 / 255)
    static let warning = Color(red: 232 / 255, green: 178 / 255, blue: 92 / 255)

    init(auth: AuthModel, model: TodayModel? = nil) {
        self.auth = auth
        _model = StateObject(wrappedValue: model ?? TodayModel(api: LiveTodayAPI(auth: auth)))
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        let marketing = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "Version \(marketing) (\(build))"
    }

    var body: some View {
        NavigationStack {
            list
                .navigationTitle("Today")
                .toolbar {
                    // The brand mark sits in the same row as the account
                    // button, filling the space above the title.
                    ToolbarItem(placement: .topBarLeading) {
                        HStack(spacing: 8) {
                            Text("P.")
                                .font(.system(size: 13, weight: .heavy))
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 26, height: 26)
                                .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.accentColor, lineWidth: 1))
                            Text("PRIORITY")
                                .font(.system(size: 12, weight: .semibold))
                                .tracking(2)
                                .foregroundStyle(.white)
                        }
                        .fixedSize()
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Priority")
                        .accessibilityAddTraits(.isHeader)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Text(
                                auth.accountEmail
                                    ?? (auth.isLoadingAccountDetails ? "Loading account…" : "Email unavailable")
                            )
                            Text(lastSyncedLabel)
                            Text(version)
                            Button("Log out", role: .destructive) {
                                Task { await auth.signOut() }
                            }
                        } label: {
                            Image(systemName: "person.crop.circle")
                                .foregroundStyle(Self.secondary)
                        }
                        .accessibilityLabel("Account")
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    if let offer = model.undoOffer {
                        undoBar(offer)
                    }
                }
                .animation(.default, value: model.undoOffer)
        }
        .tint(.accentColor)
        .preferredColorScheme(.dark)
        .task {
            async let accountDetails = auth.loadAccountDetails()
            await model.load()
            await accountDetails
        }
    }

    private var lastSyncedLabel: String {
        if auth.isLoadingAccountDetails && !auth.didLoadLastSyncedAt {
            return "Last synced: Loading…"
        }
        guard auth.didLoadLastSyncedAt else { return "Last synced: Unavailable" }
        guard let lastSyncedAt = auth.lastSyncedAt else { return "Last synced: Never" }
        return "Last synced: \(RelativeDateTimeFormatter().localizedString(for: lastSyncedAt, relativeTo: Date()))"
    }

    // The overlays sit on a List even when it's empty, so pull to refresh
    // works from every state, including "all caught up" and offline.
    private var list: some View {
        List {
            if let notice = model.notice, model.phase == .ready {
                noticeRow(notice)
            }
            if model.phase == .ready {
                ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                    row(item, rank: index + 1)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Self.background)
        .refreshable {
            await model.refresh()
            await auth.loadAccountDetails()
        }
        .overlay { overlay }
    }

    @ViewBuilder
    private var overlay: some View {
        switch model.phase {
        case .loading:
            ProgressView("Loading your list…")
                .foregroundStyle(Self.secondary)
        case .problem(let problem):
            ContentUnavailableView {
                Label(problem.title, systemImage: problem == .offline ? "wifi.slash" : "exclamationmark.triangle")
            } description: {
                Text(problem.message)
            } actions: {
                Button("Try again") { Task { await model.load() } }
                    .buttonStyle(.borderedProminent)
            }
        case .ready where model.items.isEmpty:
            ContentUnavailableView {
                Label(TodayMessages.emptyTitle, systemImage: "checkmark.circle")
            } description: {
                Text(TodayMessages.empty)
            }
        case .ready:
            EmptyView()
        }
    }

    private func noticeRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(Self.warning)
            Text(text)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                model.notice = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Self.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(12)
        .background(Self.surface, in: RoundedRectangle(cornerRadius: 8))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    private func row(_ item: TodayItem, rank: Int) -> some View {
        let canvasURL = TodayFormat.canvasURL(item.htmlUrl)
        return Button {
            if let canvasURL { openURL(canvasURL) }
        } label: {
            TodayRow(item: item, rank: rank)
        }
        // Not disabled without a link: that would also turn off the swipe.
        .buttonStyle(.plain)
        .listRowBackground(Self.background)
        .listRowSeparatorTint(Self.surface)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button {
                withAnimation { model.markDone(item) }
            } label: {
                Label("Done", systemImage: "checkmark")
            }
            .tint(.accentColor)
        }
        .accessibilityHint(canvasURL == nil ? "No Canvas link for this one." : "Opens in Canvas.")
        .accessibilityAction(named: "Mark done") { withAnimation { model.markDone(item) } }
    }

    private func undoBar(_ offer: TodayModel.UndoOffer) -> some View {
        HStack(spacing: 12) {
            Text("Marked “\(offer.item.title)” done.")
                .font(.subheadline)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Undo") {
                Task { await model.undo() }
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Self.surface, in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

// Title, course, due date and the reason stay visible, so the list reads at a
// glance the way the website's rows do.
struct TodayRow: View {
    let item: TodayItem
    let rank: Int
    var now = Date()

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(rank)")
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .foregroundStyle(TodayView.secondary)
                .frame(minWidth: 20, alignment: .trailing)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                meta
                Text(item.reason)
                    .font(.footnote)
                    .foregroundStyle(TodayView.secondary)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let share = TodayFormat.shareLabel(item.share) {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(share)
                        .font(.subheadline.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.white)
                    Text("of grade")
                        .font(.caption2)
                        .foregroundStyle(TodayView.secondary)
                }
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var meta: some View {
        let due = TodayFormat.dueLabel(item.dueAt, overdue: item.overdue, now: now)
        let tag = TodayFormat.boundaryTag(item.boundary)
        return (
            Text(item.courseName).foregroundColor(TodayView.secondary)
            + Text("  ·  ").foregroundColor(TodayView.secondary)
            + Text(due).foregroundColor(item.overdue ? TodayView.danger : TodayView.secondary)
            + (tag.map {
                Text("  ·  ").foregroundColor(TodayView.secondary)
                + Text($0).foregroundColor(item.boundary?.direction == "at-risk" ? TodayView.danger : Color.accentColor)
            } ?? Text(""))
        )
        .font(.subheadline)
    }

    private var accessibilityText: String {
        var parts = ["\(rank). \(item.title)", item.courseName, TodayFormat.dueLabel(item.dueAt, overdue: item.overdue, now: now)]
        if let tag = TodayFormat.boundaryTag(item.boundary) { parts.append(tag) }
        if let share = TodayFormat.shareLabel(item.share) { parts.append("\(share) of grade") }
        parts.append(item.reason)
        return parts.joined(separator: ", ")
    }
}

#Preview {
    TodayView(auth: AuthModel())
}
