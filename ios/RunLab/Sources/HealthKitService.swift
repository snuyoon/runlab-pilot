import Foundation
import HealthKit
import os

/// 가민 FR265 러닝 세션을 Apple 건강(HealthKit) 경유로 읽어 웹으로 전달.
///
/// 흐름: FR265 → Garmin Connect(Apple 건강 공유 ON) → HealthKit → 이 서비스가 읽어
/// WebShellView의 onWorkout 훅(→ webView.evaluateJavaScript(window.__runlabWorkout))으로 전달.
/// 웹은 워크아웃 UUID로 멱등 저장하므로 재전송/중복 조회는 안전.
enum HealthKitService {
    private static let store = HKHealthStore()
    private static let enabledKey = "runlab.healthkit.enabled"
    private static let log = Logger(subsystem: "com.snuyoon.runlab", category: "healthkit")

    /// 워크아웃 요약(JSON 문자열)을 웹으로 보내는 훅 — WebShellView가 설정. 메인스레드에서 호출.
    @MainActor static var onWorkout: ((String) -> Void)?

    private static var readTypes: Set<HKObjectType> {
        var s: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let d = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) { s.insert(d) }
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { s.insert(hr) }
        return s
    }

    /// 사용자 '연동' 버튼 → 권한 요청 후 시작.
    static func requestAndStart() {
        guard HKHealthStore.isHealthDataAvailable() else {
            log.error("이 기기는 HealthKit 미지원"); return
        }
        store.requestAuthorization(toShare: [], read: readTypes) { granted, err in
            if let err { log.error("HealthKit 권한 요청 오류: \(err.localizedDescription, privacy: .public)") }
            guard granted else { log.info("HealthKit 권한 미승인"); return }
            UserDefaults.standard.set(true, forKey: enabledKey)
            start()
        }
    }

    /// 앱 실행/화면 진입 시 — 이전에 연동했으면 자동 시작(권한 재프롬프트 없음).
    static func startIfEnabled() {
        guard HKHealthStore.isHealthDataAvailable(),
              UserDefaults.standard.bool(forKey: enabledKey) else { return }
        start()
    }

    private static var observerStarted = false

    private static func start() {
        fetchRecentAndPush() // 즉시 catch-up
        guard !observerStarted else { return }
        observerStarted = true

        // 새 워크아웃 도착 시 백그라운드로 깨어나 재조회
        let observer = HKObserverQuery(sampleType: HKObjectType.workoutType(), predicate: nil) { _, completion, err in
            if let err { log.error("옵저버 오류: \(err.localizedDescription, privacy: .public)") }
            fetchRecentAndPush()
            completion() // 반드시 호출 (미호출 시 이후 전달 중단됨)
        }
        store.execute(observer)
        store.enableBackgroundDelivery(for: HKObjectType.workoutType(), frequency: .immediate) { ok, err in
            if let err { log.error("백그라운드 전달 등록 오류: \(err.localizedDescription, privacy: .public)") }
            else { log.info("HealthKit 백그라운드 전달 등록: \(ok)") }
        }
    }

    /// 최근 30일 러닝 워크아웃을 조회해 각 세션 요약을 웹으로 push (웹이 UUID로 중복 제거).
    private static func fetchRecentAndPush() {
        let since = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
        let pred = HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let q = HKSampleQuery(
            sampleType: HKObjectType.workoutType(), predicate: pred, limit: 50, sortDescriptors: [sort]
        ) { _, samples, err in
            if let err { log.error("워크아웃 조회 오류: \(err.localizedDescription, privacy: .public)"); return }
            guard let workouts = samples as? [HKWorkout] else { return }
            for w in workouts where w.workoutActivityType == .running {
                buildSummaryAndPush(w)
            }
        }
        store.execute(q)
    }

    private static func buildSummaryAndPush(_ w: HKWorkout) {
        let distM = distanceMeters(w)
        let dur = w.duration
        let pace: Double? = distM > 0 ? dur / (distM / 1000.0) : nil
        averageHeartRate(w) { hr in
            let iso = ISO8601DateFormatter()
            let dateFmt = DateFormatter()
            dateFmt.dateFormat = "yyyy-MM-dd"
            dateFmt.locale = Locale(identifier: "en_US_POSIX")
            var obj: [String: Any] = [
                "id": w.uuid.uuidString,
                "date": dateFmt.string(from: w.startDate),
                "source": "healthkit",
                "activityType": "running",
                "startAt": iso.string(from: w.startDate),
                "endAt": iso.string(from: w.endDate),
                "durationSec": Int(dur.rounded()),
                "distanceM": Int(distM.rounded()),
            ]
            obj["avgPaceSecPerKm"] = pace.map { Int($0.rounded()) } ?? NSNull()
            obj["avgHeartRate"] = hr.map { Int($0.rounded()) } ?? NSNull()
            guard let data = try? JSONSerialization.data(withJSONObject: obj),
                  let json = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in onWorkout?(json) }
        }
    }

    private static func distanceMeters(_ w: HKWorkout) -> Double {
        if let dt = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning),
           let sum = w.statistics(for: dt)?.sumQuantity() {
            return sum.doubleValue(for: .meter())
        }
        return 0
    }

    private static func averageHeartRate(_ w: HKWorkout, _ done: @escaping (Double?) -> Void) {
        guard let hrType = HKObjectType.quantityType(forIdentifier: .heartRate) else { done(nil); return }
        let pred = HKQuery.predicateForSamples(withStart: w.startDate, end: w.endDate, options: [])
        let q = HKStatisticsQuery(quantityType: hrType, quantitySamplePredicate: pred, options: .discreteAverage) { _, stats, _ in
            let bpm = stats?.averageQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            done(bpm)
        }
        store.execute(q)
    }
}
