import SwiftUI

// The signed-in app: Today, Classes and Account.
struct MainView: View {
    @ObservedObject var auth: AuthModel
    @ObservedObject var router: AppRouter

    var body: some View {
        TabView(selection: $router.tab) {
            TodayView(auth: auth, router: router)
                .tabItem { Label("Today", systemImage: "checklist") }
                .tag(AppTab.today)
            ClassesView(auth: auth, router: router)
                .tabItem { Label("Classes", systemImage: "book.closed") }
                .tag(AppTab.classes)
            AccountView(auth: auth)
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
                .tag(AppTab.account)
        }
        .tint(.accentColor)
        .preferredColorScheme(.dark)
    }
}
