package com.snuyoon.runlab.alarm

import android.content.Context

/**
 * 알람 상태 영속 저장 (SharedPreferences).
 * - specs: 전체 알람 목록 (재부팅 후 재예약용 — 비활성 포함)
 * - codes: 현재 시스템에 예약된 PendingIntent 요청 코드 목록 (정확한 취소용)
 * - diag:  마지막 동기화 진단 JSON (실기기에서 예약 성패 가시화)
 */
object AlarmStore {
    private const val PREF = "runlab.alarms"
    private const val KEY_SPECS = "specs"
    private const val KEY_CODES = "codes"
    private const val KEY_DIAG = "diag"
    private const val KEY_PARTICIPANT = "participantCode"

    // 기기 암호화(Device Protected) 저장소 사용 — 잠금 해제 전(Direct Boot)에도 읽을 수 있어야
    // 재부팅 직후 알람을 복원할 수 있다. (minSdk 26 이므로 항상 사용 가능)
    private fun prefs(ctx: Context) =
        ctx.applicationContext.createDeviceProtectedStorageContext()
            .getSharedPreferences(PREF, Context.MODE_PRIVATE)

    fun saveSpecs(ctx: Context, specs: List<AlarmSpec>) {
        prefs(ctx).edit().putString(KEY_SPECS, AlarmSpec.listToJsonString(specs)).apply()
    }

    fun loadSpecs(ctx: Context): List<AlarmSpec> =
        AlarmSpec.listFromJsonString(prefs(ctx).getString(KEY_SPECS, null))

    fun saveCodes(ctx: Context, codes: List<Int>) {
        prefs(ctx).edit().putString(KEY_CODES, codes.joinToString(",")).apply()
    }

    fun loadCodes(ctx: Context): List<Int> {
        val raw = prefs(ctx).getString(KEY_CODES, "") ?: ""
        if (raw.isEmpty()) return emptyList()
        return raw.split(",").mapNotNull { it.trim().toIntOrNull() }
    }

    fun saveDiag(ctx: Context, json: String) {
        prefs(ctx).edit().putString(KEY_DIAG, json).apply()
    }

    fun loadDiag(ctx: Context): String = prefs(ctx).getString(KEY_DIAG, "null") ?: "null"

    fun saveParticipant(ctx: Context, code: String) {
        prefs(ctx).edit().putString(KEY_PARTICIPANT, code).apply()
    }
}
