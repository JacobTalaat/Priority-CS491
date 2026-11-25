import UIKit
import UserNotifications

// Receives notification taps. The delegate is set before launch finishes, which
// is what lets a tap that cold-starts the app be delivered.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let router = AppRouter()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // Without this, a notification that arrives while the app is open is silent.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Swiping a notification away is not a request to open anything.
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let route = NotificationRoute.from(userInfo: response.notification.request.content.userInfo) {
            router.open(route)
        }
        completionHandler()
    }
}
