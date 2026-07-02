import SwiftUI
import UserNotifications

@main
struct RunLabApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

/// 구형 iOS(26 미만) 폴백 알림 탭 처리용 델리게이트
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// 폴백 알림(로컬 알림)을 탭하면 기상 설문으로 이동
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.notification.request.identifier.hasPrefix(AlarmService.legacyIDPrefix) {
            // 콜드 런치 대비: UserDefaults에도 남겨 makeUIView가 처음부터 /ema를 로드하도록
            UserDefaults.standard.set("/ema", forKey: WebRouter.pendingPathKey)
            Task { @MainActor in
                WebRouter.shared.open("/ema")
            }
        }
        completionHandler()
    }

    /// 앱이 포그라운드일 때도 폴백 알림 표시
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}

/// 웹뷰 딥링크 라우터 — 알람 해제 후 설문 화면 열기 등
@MainActor
final class WebRouter: ObservableObject {
    static let shared = WebRouter()
    static let pendingPathKey = "runlab.pendingPath"

    /// 웹뷰가 이동해야 할 경로 (예: "/ema"). 처리 후 nil로 리셋
    @Published var pendingPath: String?

    func open(_ path: String) {
        pendingPath = path
    }

    /// 콜드 런치 대비: 인텐트가 UserDefaults에 남긴 경로 회수
    func consumeStoredPath() {
        if let path = UserDefaults.standard.string(forKey: Self.pendingPathKey) {
            UserDefaults.standard.removeObject(forKey: Self.pendingPathKey)
            pendingPath = path
        }
    }
}
