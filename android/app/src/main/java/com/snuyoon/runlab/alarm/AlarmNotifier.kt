package com.snuyoon.runlab.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.snuyoon.runlab.R

/**
 * 알람 발화 시 전체화면 알림을 게시한다.
 * - 잠금/화면꺼짐 상태: 시스템이 full-screen intent 로 AlarmActivity 를 바로 띄운다.
 * - 잠금해제·사용중 상태: 헤드업 알림으로 뜨고 탭하면 AlarmActivity.
 * 소리·진동은 AlarmActivity 가 담당(반복 재생). 채널 자체는 무음(중복 재생 방지).
 */
object AlarmNotifier {
    const val CHANNEL_ID = "runlab.alarm"
    const val NOTIF_ID = 42

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(
            CHANNEL_ID, "기상 알람", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "설정한 시각에 울리는 기상 알람"
            setSound(null, null)             // 소리는 AlarmActivity가 반복 재생
            enableVibration(false)           // 진동도 AlarmActivity가 담당
            setBypassDnd(true)               // 방해 금지 모드 관통 시도
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }
        mgr.createNotificationChannel(ch)
    }

    fun showAlarm(ctx: Context, spec: AlarmSpec) {
        ensureChannel(ctx)

        val fullIntent = Intent(ctx, AlarmActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra(AlarmScheduler.EXTRA_SPEC, spec.toJson().toString())
        }
        val fullPI = PendingIntent.getActivity(
            ctx, NOTIF_ID, fullIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (spec.isWake) "기상 알람 — RunLab" else spec.label
        val body = if (spec.isWake) "탭하여 알람을 끄고 기상 설문을 시작하세요" else "알람"

        val n = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(fullPI, true)
            .setContentIntent(fullPI)
            .setAutoCancel(false)
            .setOngoing(true)
            .build()

        try {
            NotificationManagerCompat.from(ctx).notify(NOTIF_ID, n)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS 미승인 — 아래 직접 실행으로 폴백
        }

        // 폴백: 일부 상황(잠금해제·기기별)에서 full-screen 자동 실행이 안 될 때 직접 시도
        try {
            ctx.startActivity(fullIntent)
        } catch (_: Exception) {
            // 백그라운드 액티비티 시작 제한 — 알림 경로에 의존
        }
    }

    fun cancel(ctx: Context) {
        NotificationManagerCompat.from(ctx).cancel(NOTIF_ID)
    }

    /** Android 14+ 전체화면 인텐트 사용 가능 여부 */
    fun canUseFullScreenIntent(ctx: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
        } else true
    }
}
