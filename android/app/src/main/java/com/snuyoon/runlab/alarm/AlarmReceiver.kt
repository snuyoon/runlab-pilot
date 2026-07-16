package com.snuyoon.runlab.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.util.Log
import org.json.JSONObject

/**
 * 알람 발화 수신.
 *  1) 잠깐 wakelock 확보
 *  2) 전체화면 알림 게시(→ AlarmActivity)
 *  3) 반복 알람이므로 다음 회차 재예약 (setAlarmClock 은 1회성)
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val specJson = intent.getStringExtra(AlarmScheduler.EXTRA_SPEC) ?: return
        val spec = try {
            AlarmSpec.from(JSONObject(specJson))
        } catch (e: Exception) {
            Log.e("RunLabAlarm", "spec 파싱 실패", e); null
        } ?: return

        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "runlab:alarmfire")
        wl.acquire(30_000L)
        try {
            AlarmNotifier.showAlarm(context, spec)
            // 다음 회차 재예약 (기상/반복 알람은 매일·매주 지속).
            // 저장소 기준으로만 재예약해 인플라이트 삭제 레이스의 유령 알람을 막는다.
            AlarmScheduler.rescheduleIfActive(context, spec.id)
        } finally {
            if (wl.isHeld) wl.release()
        }
    }
}
