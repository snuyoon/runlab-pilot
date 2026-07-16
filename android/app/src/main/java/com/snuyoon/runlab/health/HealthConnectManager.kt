package com.snuyoon.runlab.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Health Connect 에서 러닝 세션을 읽어 웹으로 전달할 JSON 을 만든다.
 *
 * 흐름: 가민 FR265 → Garmin Connect(Health Connect 공유 ON) → Health Connect →
 * 이 매니저가 읽어 MainActivity 가 window.__runlabWorkout(json) 으로 전달.
 * 웹은 워크아웃 id 로 멱등 저장하므로 재전송/중복 조회는 안전.
 */
class HealthConnectManager(private val context: Context) {

    companion object {
        val PERMISSIONS: Set<String> = setOf(
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
        )

        // 가민 Connect(Android) 패키지 — 이 앱이 쓴 레코드만 수집(삼성헬스 등 타 writer 오염·중복 방지)
        private const val GARMIN_PKG = "com.garmin.android.apps.connectmobile"
        private val GARMIN_ORIGINS = setOf(DataOrigin(GARMIN_PKG))
    }

    /** SDK_AVAILABLE / SDK_UNAVAILABLE / SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED */
    fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context)

    fun isAvailable(): Boolean = sdkStatus() == HealthConnectClient.SDK_AVAILABLE

    private val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }

    suspend fun hasAllPermissions(): Boolean =
        client.permissionController.getGrantedPermissions().containsAll(PERMISSIONS)

    /** 최근 [sinceDays]일 러닝 세션을 각각 요약 JSON 으로 반환 (가민 writer 한정) */
    suspend fun fetchRunningSessions(sinceDays: Long = 30): List<JSONObject> {
        val end = Instant.now()
        val start = end.minus(Duration.ofDays(sinceDays))
        val response = client.readRecords(
            ReadRecordsRequest(
                recordType = ExerciseSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(start, end),
                dataOriginFilter = GARMIN_ORIGINS
            )
        )
        val out = mutableListOf<JSONObject>()
        for (s in response.records) {
            if (s.metadata.dataOrigin.packageName != GARMIN_PKG) continue // 방어적 재확인
            if (s.exerciseType != ExerciseSessionRecord.EXERCISE_TYPE_RUNNING) continue
            out.add(summarize(s))
        }
        return out
    }

    private suspend fun summarize(s: ExerciseSessionRecord): JSONObject {
        val range = TimeRangeFilter.between(s.startTime, s.endTime)
        var distanceM: Double? = null
        var avgHr: Long? = null
        try {
            val agg = client.aggregate(
                AggregateRequest(
                    metrics = setOf(DistanceRecord.DISTANCE_TOTAL, HeartRateRecord.BPM_AVG),
                    timeRangeFilter = range
                )
            )
            distanceM = agg[DistanceRecord.DISTANCE_TOTAL]?.inMeters
            avgHr = agg[HeartRateRecord.BPM_AVG]
        } catch (_: Exception) {
            // 집계 실패 시 거리/심박 없이 전달
        }

        val durSec = Duration.between(s.startTime, s.endTime).seconds
        val paceSecPerKm: Long? =
            if (distanceM != null && distanceM > 0) Math.round(durSec.toDouble() / (distanceM / 1000.0)) else null

        val id = s.metadata.id.ifEmpty { "hc-${s.startTime.toEpochMilli()}" }
        val date = LocalDate.ofInstant(s.startTime, ZoneId.systemDefault()).toString()

        return JSONObject().apply {
            put("id", id)
            put("date", date)
            put("source", "healthconnect")
            put("activityType", "running")
            put("startAt", s.startTime.toString())
            put("endAt", s.endTime.toString())
            put("durationSec", durSec.toInt())
            put("distanceM", (distanceM ?: 0.0).toInt())
            put("avgPaceSecPerKm", paceSecPerKm?.toInt() ?: JSONObject.NULL)
            put("avgHeartRate", avgHr?.toInt() ?: JSONObject.NULL)
        }
    }
}
