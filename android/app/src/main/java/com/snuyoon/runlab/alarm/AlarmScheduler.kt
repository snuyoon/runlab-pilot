package com.snuyoon.runlab.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.snuyoon.runlab.MainActivity
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * 알람 스케줄러 — iOS AlarmService 와 대응.
 *
 * setAlarmClock() 을 쓰는 이유:
 *  - Doze/앱 종료 상태에서도 정확히 발화하며, SCHEDULE_EXACT_ALARM 런타임 권한이 필요 없다
 *    (알람시계 용도는 정확 알람 권한에서 면제 — 구글 공식).
 *  - 시스템 상태바에 알람 아이콘을 표시한다.
 *
 * setAlarmClock 은 1회성이므로, 발화 시 AlarmReceiver 가 다음 회차를 재예약한다(반복 구현).
 * 전체 목록 동기화는 "기존 전부 취소 → 켜진 알람만 재등록"의 멱등 방식.
 */
object AlarmScheduler {
    const val EXTRA_SPEC = "spec_json"
    const val EXTRA_CODE = "req_code"
    private const val BASE_CODE = 20_000   // 알람 발화 브로드캐스트 요청 코드 베이스
    private const val SHOW_OFFSET = 10_000 // showIntent(앱 열기) 요청 코드 오프셋
    private const val TAG = "RunLabAlarm"

    /** 웹 알람 목록 전체 반영 → 진단 JSON 문자열 반환 */
    fun sync(ctx: Context, specs: List<AlarmSpec>): String {
        AlarmStore.saveSpecs(ctx, specs)
        cancelAllScheduled(ctx)

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val enabled = specs.filter { it.enabled }
        val newCodes = mutableListOf<Int>()
        val errors = mutableListOf<String>()

        for ((i, spec) in enabled.withIndex()) {
            val code = BASE_CODE + i
            try {
                scheduleNext(ctx, am, spec, code)
                newCodes.add(code)
            } catch (e: Exception) {
                errors.add("${spec.label}: ${e.message}")
                Log.e(TAG, "예약 실패: ${spec.label}", e)
            }
        }
        AlarmStore.saveCodes(ctx, newCodes)

        val diag = buildDiag(ctx, am, enabled.size, newCodes.size, errors)
        AlarmStore.saveDiag(ctx, diag)
        return diag
    }

    /** 모든 알람 취소 (계정 전환·초기화) */
    fun cancelAll(ctx: Context): String {
        cancelAllScheduled(ctx)
        AlarmStore.saveSpecs(ctx, emptyList())
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val diag = buildDiag(ctx, am, 0, 0, emptyList())
        AlarmStore.saveDiag(ctx, diag)
        return diag
    }

    /** 재부팅/앱 업데이트 후 저장된 목록으로 재예약 */
    fun rescheduleFromStore(ctx: Context) {
        val specs = AlarmStore.loadSpecs(ctx)
        if (specs.isNotEmpty()) sync(ctx, specs)
    }

    /**
     * 발화한 알람을 다음 회차로 재예약 — 단, 저장소에 **여전히 존재하고 활성**일 때만.
     * 발화 브로드캐스트가 인플라이트인 동안 사용자가 그 알람을 삭제/비활성화하는 레이스에서
     * 스냅샷 기반으로 무조건 재예약하면, 저장소가 추적하지 않는 "유령 알람"이 남아 영영
     * 취소되지 않는다. 항상 현재 저장소의 활성 목록에서 인덱스(=요청 코드)를 다시 계산한다.
     */
    fun rescheduleIfActive(ctx: Context, specId: String) {
        val enabled = AlarmStore.loadSpecs(ctx).filter { it.enabled }
        val idx = enabled.indexOfFirst { it.id == specId }
        if (idx < 0) return // 삭제·비활성화됨 → 부활 금지
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try {
            scheduleNext(ctx, am, enabled[idx], BASE_CODE + idx)
        } catch (e: Exception) {
            Log.e(TAG, "재예약 실패: $specId", e)
        }
    }

    /** 알람 1개의 다음 발화 시각을 예약 (sync 및 rescheduleIfActive 에서 사용) */
    fun scheduleNext(ctx: Context, am: AlarmManager, spec: AlarmSpec, code: Int) {
        val triggerAt = nextTriggerMillis(spec, System.currentTimeMillis())

        val fireIntent = Intent(ctx, AlarmReceiver::class.java).apply {
            action = "com.snuyoon.runlab.ALARM_FIRE"
            putExtra(EXTRA_SPEC, spec.toJson().toString())
            putExtra(EXTRA_CODE, code)
        }
        val firePI = PendingIntent.getBroadcast(
            ctx, code, fireIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 시스템 알람 UI 탭 시 앱 열기
        val showIntent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val showPI = PendingIntent.getActivity(
            ctx, code + SHOW_OFFSET, showIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val info = AlarmManager.AlarmClockInfo(triggerAt, showPI)
        am.setAlarmClock(info, firePI)
        Log.i(TAG, "예약: ${spec.label} @ ${SimpleDateFormat("MM-dd HH:mm", Locale.KOREA).format(triggerAt)} (code=$code)")
    }

    private fun cancelAllScheduled(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        for (code in AlarmStore.loadCodes(ctx)) {
            val intent = Intent(ctx, AlarmReceiver::class.java).apply {
                action = "com.snuyoon.runlab.ALARM_FIRE"
            }
            val pi = PendingIntent.getBroadcast(
                ctx, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            am.cancel(pi)
            pi.cancel()
        }
        AlarmStore.saveCodes(ctx, emptyList())
    }

    /**
     * 다음 발화 시각(ms) 계산.
     * days 가 비었으면 매일, 아니면 지정 요일(1=월~7=일) 중 가장 가까운 미래 시각.
     */
    fun nextTriggerMillis(spec: AlarmSpec, fromMillis: Long): Long {
        val cal = Calendar.getInstance().apply {
            timeInMillis = fromMillis
            set(Calendar.HOUR_OF_DAY, spec.hour)
            set(Calendar.MINUTE, spec.minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        if (spec.days.isEmpty()) {
            // 매일 — 오늘 시각이 이미 지났으면 내일
            if (cal.timeInMillis <= fromMillis) cal.add(Calendar.DAY_OF_YEAR, 1)
            return cal.timeInMillis
        }

        // 지정 요일 — 오늘 포함 0~7일 뒤 중 요일이 일치하고 미래인 첫 시각
        val target = spec.days.map { isoToCalendarWeekday(it) }.toSet()
        for (offset in 0..7) {
            val c = cal.clone() as Calendar
            c.add(Calendar.DAY_OF_YEAR, offset)
            if (c.get(Calendar.DAY_OF_WEEK) in target && c.timeInMillis > fromMillis) {
                return c.timeInMillis
            }
        }
        // 이론상 도달 불가 — 방어적으로 +1일
        cal.add(Calendar.DAY_OF_YEAR, 1)
        return cal.timeInMillis
    }

    /** ISO 1=월~7=일 → Calendar.DAY_OF_WEEK (일=1~토=7) */
    private fun isoToCalendarWeekday(iso: Int): Int = when (iso) {
        7 -> Calendar.SUNDAY
        else -> iso + 1 // 1(월)->2 ... 6(토)->7
    }

    private fun buildDiag(
        ctx: Context, am: AlarmManager,
        requested: Int, scheduled: Int, errors: List<String>
    ): String {
        val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.canScheduleExactAlarms() else true
        val notif = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()
        val fullScreen = AlarmNotifier.canUseFullScreenIntent(ctx)
        val authState = "exact=$canExact,notif=$notif,fullscreen=$fullScreen"
        return JSONObject().apply {
            put("path", "android")
            put("authState", authState)
            put("requested", requested)
            put("scheduled", scheduled)
            put("systemCount", scheduled) // Android 는 시스템 알람 개수 조회 API가 없어 예약 성공 수로 대체
            put("errors", JSONArray(errors))
            put("at", isoNow())
        }.toString()
    }

    private fun isoNow(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        return fmt.format(System.currentTimeMillis())
    }
}
