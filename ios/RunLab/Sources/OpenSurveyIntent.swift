import AppIntents
import Foundation
#if canImport(AlarmKit)
import AlarmKit
#endif

/// 기상 알람의 '설문 시작' 보조 버튼 인텐트.
/// openAppWhenRun = true → 앱을 포그라운드로 열고 기상 설문(/ema)으로 이동.
struct OpenSurveyIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "설문 시작"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "alarmID") var alarmID: String

    init() {}
    init(alarmID: String) { self.alarmID = alarmID }

    func perform() async throws -> some IntentResult {
        // .custom 보조 버튼은 알람 상태를 바꾸지 않으므로(Apple 문서),
        // 직접 멈춰야 소리가 그친다 (반복 알람은 다음 회차로 재예약됨)
        #if canImport(AlarmKit)
        if #available(iOS 26.1, *), let id = UUID(uuidString: alarmID) {
            try? AlarmManager.shared.stop(id: id)
        }
        #endif
        await routeToSurvey()
        return .result()
    }
}

/// 기상 알람의 '끄기' 버튼 인텐트.
/// 커스텀 stopIntent이므로 알람을 직접 멈추고(반복이면 다음 회차로 재스케줄),
/// 앱을 열어 기상 설문으로 이동한다 — "알람 끄면 설문 자동 등장".
struct StopSurveyIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "끄기"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "alarmID") var alarmID: String

    init() {}
    init(alarmID: String) { self.alarmID = alarmID }

    func perform() async throws -> some IntentResult {
        #if canImport(AlarmKit)
        if #available(iOS 26.1, *), let id = UUID(uuidString: alarmID) {
            try? AlarmManager.shared.stop(id: id)
        }
        #endif
        await routeToSurvey()
        return .result()
    }
}

/// 앱을 열었을 때 기상 설문으로 라우팅.
/// perform()이 끝나기 전에 반드시 기록되도록 await — 콜드 런치 대비 UserDefaults에도 저장
@MainActor
func routeToSurvey() {
    UserDefaults.standard.set("/ema", forKey: WebRouter.pendingPathKey)
    WebRouter.shared.open("/ema")
}
