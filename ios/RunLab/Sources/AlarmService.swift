import Foundation
import UserNotifications
import SwiftUI
import os
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
    static let diagKey = "runlab.alarm.diag"           // 마지막 동기화 진단(JSON) — 실기기 가시화용

    /// Swift print()는 실기기 log stream에 안 잡히므로(CLAUDE.md) Logger로 남긴다.
    private static let log = Logger(subsystem: "com.snuyoon.runlab", category: "alarm")

    /// 동기화 결과를 웹으로 되돌리는 훅 — WebShellView가 설정. emit()이 MainActor에서 호출.
    @MainActor static var onSyncResult: ((String) -> Void)?

    /// 예약 결과를 UserDefaults(진단) + Logger + 웹(evaluateJavaScript)으로 노출.
    /// "저장은 됐는데 예약 0건"이 완전히 비가시였던 게 무발화 디버깅의 근본 걸림돌 → 반드시 가시화.
    @MainActor private static func emit(
        path: String, authState: String, requested: Int, scheduled: Int,
        systemCount: Int, errors: [String]
    ) {
        let diag: [String: Any] = [
            "path": path, "authState": authState,
            "requested": requested, "scheduled": scheduled,
            "systemCount": systemCount, "errors": errors,
            "at": ISO8601DateFormatter().string(from: Date()),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: diag),
              let json = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(json, forKey: diagKey)
        log.info("alarm sync 결과: \(json, privacy: .public)")
        onSyncResult?(json)
    }

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
        var authState = "n/a"
        if !enabled.isEmpty {
            do {
                let state = try await manager.requestAuthorization()
                authState = String(describing: state)
                guard state == .authorized else {
                    log.error("AlarmKit 권한 비승인(\(authState, privacy: .public)) — 레거시 폴백")
                    await cancelAllAlarmKit() // 남은 AlarmKit 알람 정리 (이중 알람 방지)
                    await syncLegacy(specs, reason: "authNotAuthorized:\(authState)", authState: authState)
                    return
                }
            } catch {
                // 이전엔 여기서 폴백 없이 return → 무발화. iOS 27 권한 API가 throw해도 로컬 알림이라도 울리게.
                log.error("AlarmKit 권한 요청 throw: \(error.localizedDescription, privacy: .public) — 레거시 폴백")
                await syncLegacy(specs, reason: "authThrew:\(error.localizedDescription)", authState: "threw")
                return
            }
        }

        await cancelAllAlarmKit()
        await cancelAllLegacy() // 과거 폴백 알림 잔존분도 정리 (이중 알람 방지)

        var newIDs: [String] = []
        var errors: [String] = []
        for spec in enabled {
            let id = UUID()
            do {
                let config = try makeConfiguration(for: spec, id: id)
                _ = try await manager.schedule(id: id, configuration: config)
                newIDs.append(id.uuidString)
                log.info("AlarmKit 예약 성공: \(spec.label, privacy: .public) \(spec.hour):\(spec.minute)")
            } catch {
                let msg = "\(spec.label): \(error.localizedDescription)"
                errors.append(msg)
                log.error("AlarmKit 예약 실패 — \(msg, privacy: .public)")
            }
        }
        UserDefaults.standard.set(newIDs, forKey: scheduledIDsKey)

        // 요청은 있었는데 단 하나도 예약 못 했으면(전멸) 로컬 알림으로라도 폴백 — 무발화 방지.
        // 부분 성공(일부만 실패)은 손대지 않아 이중 알람 위험 없음.
        if newIDs.isEmpty && !enabled.isEmpty {
            log.error("AlarmKit 예약 전멸(요청 \(enabled.count)건) — 레거시 폴백")
            await syncLegacy(specs, reason: "allScheduleFailed", carryErrors: errors, authState: authState)
            return
        }

        let systemCount = (try? manager.alarms.count) ?? -1
        await emit(path: "alarmkit", authState: authState, requested: enabled.count,
                   scheduled: newIDs.count, systemCount: systemCount, errors: errors)
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
            // 기상 알람: 버튼은 '끄기' 하나만. 끄면 StopSurveyIntent가 알람을 멈추고
            // 곧바로 기상 설문(/ema)으로 연결한다 (별도 '설문 시작' 버튼 제거 — 요청).
            alert = AlarmPresentation.Alert(title: "기상 알람 — RunLab")
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
            // '끄기'(StopSurveyIntent) 단일 버튼 → 알람 정지 후 /ema 이동. secondaryIntent 제거.
            return AlarmManager.AlarmConfiguration<RunLabAlarmMetadata>.alarm(
                schedule: schedule,
                attributes: attributes,
                stopIntent: StopSurveyIntent(alarmID: id.uuidString),
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

    private static func syncLegacy(
        _ specs: [AlarmSpec], reason: String = "belowIOS26_1",
        carryErrors: [String] = [], authState: String = "n/a"
    ) async {
        let center = UNUserNotificationCenter.current()
        let enabled = specs.filter { $0.enabled }
        if !enabled.isEmpty {
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            guard granted else {
                log.error("알림 권한 거부 — 폴백도 무발화(\(reason, privacy: .public))")
                await emit(path: "legacyDenied:\(reason)", authState: authState,
                           requested: enabled.count, scheduled: 0, systemCount: 0, errors: carryErrors)
                return
            }
        }
        await cancelAllLegacy() // 등록 전에 정리 완료를 보장 (콜백 레이스로 새 알림이 지워지는 것 방지)

        var added = 0
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
                    do { try await center.add(request); added += 1 }
                    catch { log.error("레거시 알림 등록 실패: \(error.localizedDescription, privacy: .public)") }
                }
            }
        }
        // 로컬 알림은 spec당 여러 요청으로 등록됨 → 하나라도 등록됐으면 요청 전체가 반영된 것으로 본다.
        await emit(path: "legacy:\(reason)", authState: authState,
                   requested: enabled.count, scheduled: added > 0 ? enabled.count : 0,
                   systemCount: added, errors: carryErrors)
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
