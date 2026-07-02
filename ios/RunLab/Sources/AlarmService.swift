import Foundation
import UserNotifications
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
import ActivityKit
#endif

/// 기상 알람 스케줄러.
///
/// - iOS 26+: **AlarmKit** — 시스템이 알람을 소유하므로 앱이 종료돼도 울리고,
///   무음 모드·집중 모드를 관통한다 (Apple 공식 보장). entitlement 불필요,
///   Info.plist의 NSAlarmKitUsageDescription만 필요.
/// - iOS 26 미만: 로컬 알림 폴백 — 알람 시각부터 1분 간격 10회 반복 알림.
///   (알림 사운드는 최대 30초, 풀스크린 알람 UI 없음 — 제한적 폴백)
enum AlarmService {
    static let alarmIDKey = "runlab.alarmkit.id"
    static let legacyIDPrefix = "runlab-alarm-"

    // MARK: - 예약

    static func scheduleDaily(hour: Int, minute: Int) {
        Task {
            if #available(iOS 26.0, *) {
                await scheduleWithAlarmKit(hour: hour, minute: minute)
            } else {
                await scheduleLegacy(hour: hour, minute: minute)
            }
        }
    }

    static func cancelAll() {
        Task {
            if #available(iOS 26.0, *) {
                cancelAlarmKit()
            }
            cancelLegacy()
        }
    }

    // MARK: - AlarmKit (iOS 26+)

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private static func scheduleWithAlarmKit(hour: Int, minute: Int) async {
        let manager = AlarmManager.shared

        // 권한 (미결정이면 시스템 프롬프트)
        do {
            let state = try await manager.requestAuthorization()
            guard state == .authorized else {
                print("AlarmKit 권한 거부됨 — 폴백 알림 사용")
                await scheduleLegacy(hour: hour, minute: minute)
                return
            }
        } catch {
            print("AlarmKit 권한 요청 실패:", error)
            return
        }

        // 기존 알람 제거 후 재등록
        cancelAlarmKit()

        let id = UUID()
        UserDefaults.standard.set(id.uuidString, forKey: alarmIDKey)

        // 매일 반복 = 7개 요일 전체
        let schedule = Alarm.Schedule.relative(
            .init(
                time: .init(hour: hour, minute: minute),
                repeats: .weekly([
                    .sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday,
                ])
            )
        )

        // 알람 화면: 시스템 '끄기' 버튼 자동 제공 + '설문 시작' 커스텀 버튼(앱 오픈)
        let alert = AlarmPresentation.Alert(
            title: "기상 알람 — RunLab",
            secondaryButton: AlarmButton(
                text: "설문 시작",
                textColor: .white,
                systemImageName: "sun.max.fill"
            ),
            secondaryButtonBehavior: .custom
        )

        let attributes = AlarmAttributes<RunLabAlarmMetadata>(
            presentation: AlarmPresentation(alert: alert),
            metadata: RunLabAlarmMetadata(),
            tintColor: Color(red: 0.39, green: 0.4, blue: 0.95) // indigo-500
        )

        let configuration = AlarmManager.AlarmConfiguration<RunLabAlarmMetadata>.alarm(
            schedule: schedule,
            attributes: attributes,
            secondaryIntent: OpenSurveyIntent(),
            sound: .default
        )

        do {
            _ = try await manager.schedule(id: id, configuration: configuration)
            print("AlarmKit 알람 예약: 매일 \(hour):\(minute)")
        } catch {
            print("AlarmKit 예약 실패:", error)
        }
    }

    @available(iOS 26.0, *)
    private static func cancelAlarmKit() {
        guard let stored = UserDefaults.standard.string(forKey: alarmIDKey),
              let id = UUID(uuidString: stored) else { return }
        try? AlarmManager.shared.cancel(id: id)
        UserDefaults.standard.removeObject(forKey: alarmIDKey)
    }
    #else
    private static func scheduleWithAlarmKit(hour: Int, minute: Int) async {
        await scheduleLegacy(hour: hour, minute: minute)
    }
    private static func cancelAlarmKit() {}
    #endif

    // MARK: - 폴백 (iOS 26 미만): 1분 간격 반복 로컬 알림

    private static func scheduleLegacy(hour: Int, minute: Int) async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        guard granted else {
            print("알림 권한 거부됨")
            return
        }

        cancelLegacy()

        for i in 0..<10 {
            let total = minute + i
            let m = total % 60
            let h = (hour + total / 60) % 24

            let content = UNMutableNotificationContent()
            content.title = "기상 알람 — RunLab"
            content.body = "알림을 눌러 기상 설문을 시작해주세요"
            content.sound = .default

            var comps = DateComponents()
            comps.hour = h
            comps.minute = m
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
            let request = UNNotificationRequest(
                identifier: "\(legacyIDPrefix)\(i)",
                content: content,
                trigger: trigger
            )
            try? await center.add(request)
        }
        print("폴백 알림 예약: 매일 \(hour):\(minute)부터 10회")
    }

    private static func cancelLegacy() {
        let ids = (0..<10).map { "\(legacyIDPrefix)\($0)" }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }
}

#if canImport(AlarmKit)
/// AlarmKit 메타데이터 — 빈 구현 허용 (공식 문서 명시)
@available(iOS 26.0, *)
struct RunLabAlarmMetadata: AlarmMetadata {}
#endif
