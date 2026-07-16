package com.snuyoon.runlab.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 재부팅·앱 업데이트 후 저장된 알람을 다시 예약한다.
 * (예약된 알람은 재부팅 시 시스템에서 사라지므로 필수)
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON" -> {
                AlarmScheduler.rescheduleFromStore(context)
            }
        }
    }
}
