import AppIntents
import Foundation

/// 알람 화면의 '설문 시작' 버튼 인텐트.
/// openAppWhenRun = true → 버튼을 누르면 앱이 포그라운드로 열리고,
/// perform()이 본 앱 프로세스에서 실행되어 기상 설문(/ema)으로 딥링크한다.
struct OpenSurveyIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "설문 시작"
    static var openAppWhenRun: Bool = true

    init() {}

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            // 콜드 런치 대비 저장 + 이미 실행 중이면 즉시 라우팅
            UserDefaults.standard.set("/ema", forKey: WebRouter.pendingPathKey)
            WebRouter.shared.open("/ema")
        }
        return .result()
    }
}
