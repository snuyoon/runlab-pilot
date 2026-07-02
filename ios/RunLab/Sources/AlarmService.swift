import Foundation
import UserNotifications
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
import ActivityKit
#endif

/// 웹에서 전달된 알람 1개 명세 (JS 브리지 payload)
struct AlarmSpec {
    let id: String
    let hour: Int
    let minute: Int
    let label: String
    let enabled: Bool
    let sound: String      // "default" | "radar" | "chime" | "bell" | "digital"
    let vibration: String  // "off" | "normal" | "strong"
    let days: [Int]        // 1=월 ~ 7=일, 빈 배열 = 매일
    let isWake: Bool

    init?(_ dict: [String: Any]) {
        guard let id = dict["id"] as? String else { return nil }
        self.id = id
        self.hour = (dict["hour"] as? NSNumber)?.intValue ?? 7
        self.minute = (dict["minute"] as? NSNumber)?.intValue ?? 0
        self.label = dict["label"] as? String ?? "알람"
        self.enabled = dict["enabled"] as? Bool ?? true
        self.sound = dict["sound"] as? String ?? "default"
        self.vibration = dict["vibration"] as? String ?? "normal"
        self.days = (dict["days"] as? [Any])?.compactMap { ($0 as? NSNumber)?.intValue } ?? []
        self.isWake = dict["isWake"] as? Bool ?? false
    }
}

/// 알람 스케줄러.
///
/// - iOS 26.1+: **AlarmKit** — 시스템이 알람을 소유하므로 앱이 종료돼도 울리고,
///   무음 모드·집중 모드를 관통한다. 기상 알람(isWake)은 끄기/설문 버튼 어느 쪽을
///   눌러도 앱이 열리며 기상 설문(/ema)으로 이동한다.
/// - iOS 26.1 미만: 로컬 알림 폴백 (제한적).
enum AlarmService {
    static let scheduledIDsKey = "runlab.alarmkit.ids" // 현재 등록된 AlarmKit id 목록
    static let legacyIDPrefix = "runlab-alarm-"

    /// 작업 직렬화 체인 — sync/cancel이 겹쳐 실행되면 UserDefaults id 목록과
    /// 실제 예약이 어긋나 취소 불가능한 유령 알람이 생기므로 항상 순차 실행한다
    @MainActor private static var chain: Task<Void, Never>?

    @MainActor private static func serialize(_ op: @escaping () async -> Void) {
        let prev = chain
        chain = Task {
            await prev?.value
            await op()
        }
    }

    /// 웹의 알람 목록 전체를 반영 (기존 전부 취소 후 재등록)
    static func sync(_ specs: [AlarmSpec]) {
        Task { @MainActor in
            serialize {
                if #available(iOS 26.1, *) {
                    await syncAlarmKit(specs)
                } else {
                    await syncLegacy(specs)
                }
            }
        }
    }

    static func cancelAll() {
        Task { @MainActor in
            serialize {
                if #available(iOS 26.1, *) { await cancelAllAlarmKit() }
                await cancelAllLegacy()
            }
        }
    }

    // MARK: - AlarmKit (iOS 26.1+)

    #if canImport(AlarmKit)
    @available(iOS 26.1, *)
    private static func syncAlarmKit(_ specs: [AlarmSpec]) async {
        let manager = AlarmManager.shared

        let enabled = specs.filter { $0.enabled }
        if !enabled.isEmpty {
            do {
                let state = try await manager.requestAuthorization()
                guard state == .authorized else {
                    print("AlarmKit 권한 거부 — 폴백")
                    await cancelAllAlarmKit() // 남은 AlarmKit 알람 정리 (이중 알람 방지)
                    await syncLegacy(specs)
                    return
                }
            } catch {
                print("AlarmKit 권한 요청 실패:", error)
                return
            }
        }

        await cancelAllAlarmKit()
        await cancelAllLegacy() // 과거 폴백 알림 잔존분도 정리 (이중 알람 방지)

        var newIDs: [String] = []
        for spec in enabled {
            let id = UUID()
            do {
                let config = try makeConfiguration(for: spec, id: id)
                _ = try await manager.schedule(id: id, configuration: config)
                newIDs.append(id.uuidString)
                print("AlarmKit 예약: \(spec.label) \(spec.hour):\(spec.minute)")
            } catch {
                print("AlarmKit 예약 실패(\(spec.label)):", error)
            }
        }
        UserDefaults.standard.set(newIDs, forKey: scheduledIDsKey)
    }

    @available(iOS 26.1, *)
    private static func makeConfiguration(
        for spec: AlarmSpec, id: UUID
    ) throws -> AlarmManager.AlarmConfiguration<RunLabAlarmMetadata> {
        // 반복 요일
        let weekdays: [Locale.Weekday] = spec.days.isEmpty
            ? [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday]
            : spec.days.compactMap { weekday(from: $0) }
        let schedule = Alarm.Schedule.relative(
            .init(
                time: .init(hour: spec.hour, minute: spec.minute),
                repeats: .weekly(weekdays)
            )
        )

        // 알람 화면 구성
        let alert: AlarmPresentation.Alert
        if spec.isWake {
            // 기상 알람: '설문 시작' 보조 버튼(끄기 버튼도 커스텀 stopIntent로 앱 오픈)
            alert = AlarmPresentation.Alert(
                title: "기상 알람 — RunLab",
                secondaryButton: AlarmButton(
                    text: "설문 시작",
                    textColor: .white,
                    systemImageName: "sun.max.fill"
                ),
                secondaryButtonBehavior: .custom
            )
        } else {
            alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: spec.label))
        }

        let attributes = AlarmAttributes<RunLabAlarmMetadata>(
            presentation: AlarmPresentation(alert: alert),
            metadata: RunLabAlarmMetadata(),
            tintColor: Color(red: 0.39, green: 0.4, blue: 0.95)
        )

        let sound = alertSound(for: spec.sound)

        if spec.isWake {
            // 끄기·설문 두 버튼 모두 앱을 열고 /ema로 이동
            return AlarmManager.AlarmConfiguration<RunLabAlarmMetadata>.alarm(
                schedule: schedule,
                attributes: attributes,
                stopIntent: StopSurveyIntent(alarmID: id.uuidString),
                secondaryIntent: OpenSurveyIntent(alarmID: id.uuidString),
                sound: sound
            )
        } else {
            return AlarmManager.AlarmConfiguration<RunLabAlarmMetadata>.alarm(
                schedule: schedule,
                attributes: attributes,
                sound: sound
            )
        }
    }

    @available(iOS 26.1, *)
    private static func weekday(from day: Int) -> Locale.Weekday? {
        switch day {
        case 1: return .monday
        case 2: return .tuesday
        case 3: return .wednesday
        case 4: return .thursday
        case 5: return .friday
        case 6: return .saturday
        case 7: return .sunday
        default: return nil
        }
    }

    @available(iOS 26.1, *)
    private static func alertSound(for id: String) -> AlertConfiguration.AlertSound {
        switch id {
        case "radar": return .named("radar.caf")
        case "chime": return .named("chime.caf")
        case "bell": return .named("bell.caf")
        case "digital": return .named("digital.caf")
        default: return .default
        }
    }

    @available(iOS 26.1, *)
    private static func cancelAllAlarmKit() async {
        // 저장된 id 목록 + 시스템에 실제 등록된 알람 양쪽 모두 취소
        // (레이스/재설치로 id 목록이 어긋나도 유령 알람이 남지 않도록)
        var ids = Set(UserDefaults.standard.stringArray(forKey: scheduledIDsKey) ?? [])
        if let systemAlarms = try? AlarmManager.shared.alarms {
            for alarm in systemAlarms { ids.insert(alarm.id.uuidString) }
        }
        for s in ids {
            if let id = UUID(uuidString: s) { try? AlarmManager.shared.cancel(id: id) }
        }
        UserDefaults.standard.removeObject(forKey: scheduledIDsKey)
    }
    #else
    private static func syncAlarmKit(_ specs: [AlarmSpec]) async { await syncLegacy(specs) }
    private static func cancelAllAlarmKit() async {}
    #endif

    // MARK: - 폴백 (iOS 26.1 미만): 반복 로컬 알림

    private static func syncLegacy(_ specs: [AlarmSpec]) async {
        let center = UNUserNotificationCenter.current()
        let enabled = specs.filter { $0.enabled }
        if !enabled.isEmpty {
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            guard granted else { print("알림 권한 거부"); return }
        }
        await cancelAllLegacy() // 등록 전에 정리 완료를 보장 (콜백 레이스로 새 알림이 지워지는 것 방지)

        for (idx, spec) in enabled.enumerated() {
            // 선택 요일마다 개별 트리거 (빈 배열 = 매일 → weekday 미지정 1개)
            let dayList: [Int?] = spec.days.isEmpty ? [nil] : spec.days.map { $0 }
            for (di, day) in dayList.enumerated() {
                // 알람 시각부터 1분 간격 5회 반복 (일반 알림 한계)
                for i in 0..<5 {
                    let total = spec.minute + i
                    let content = UNMutableNotificationContent()
                    content.title = spec.isWake ? "기상 알람 — RunLab" : spec.label
                    content.body = spec.isWake ? "알림을 눌러 기상 설문을 시작해주세요" : "알람"
                    content.sound = spec.sound == "default"
                        ? .default
                        : UNNotificationSound(named: UNNotificationSoundName("\(spec.sound).caf"))
                    var comps = DateComponents()
                    comps.hour = (spec.hour + total / 60) % 24
                    comps.minute = total % 60
                    if let day { comps.weekday = iso8601ToUN(day) }
                    let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
                    let request = UNNotificationRequest(
                        identifier: "\(legacyIDPrefix)\(idx)-\(di)-\(i)",
                        content: content, trigger: trigger
                    )
                    try? await center.add(request)
                }
            }
        }
    }

    /// 1=월~7=일 → UNCalendar weekday(1=일~7=토)
    private static func iso8601ToUN(_ day: Int) -> Int { day == 7 ? 1 : day + 1 }

    private static func cancelAllLegacy() async {
        let center = UNUserNotificationCenter.current()
        let reqs = await center.pendingNotificationRequests()
        let ids = reqs.map(\.identifier).filter { $0.hasPrefix(legacyIDPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }
}

#if canImport(AlarmKit)
/// AlarmKit 메타데이터 — 빈 구현 허용 (공식 문서 명시)
@available(iOS 26.1, *)
struct RunLabAlarmMetadata: AlarmMetadata {}
#endif
