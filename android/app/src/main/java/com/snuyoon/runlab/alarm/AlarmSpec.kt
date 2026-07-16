package com.snuyoon.runlab.alarm

import org.json.JSONArray
import org.json.JSONObject

/**
 * 웹에서 전달된 알람 1개 명세 (JS 브리지 payload와 1:1 대응).
 * 웹 studyStore.ts 의 AlarmItem 과 필드가 동일하다.
 */
data class AlarmSpec(
    val id: String,
    val hour: Int,
    val minute: Int,
    val label: String,
    val enabled: Boolean,
    val sound: String,     // "default" | "radar" | "chime" | "bell" | "digital"
    val vibration: String, // "off" | "normal" | "strong"
    val days: List<Int>,   // 1=월 ~ 7=일, 빈 배열 = 매일
    val isWake: Boolean,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("hour", hour)
        put("minute", minute)
        put("label", label)
        put("enabled", enabled)
        put("sound", sound)
        put("vibration", vibration)
        put("isWake", isWake)
        put("days", JSONArray(days))
    }

    companion object {
        fun from(o: JSONObject): AlarmSpec? {
            val id = o.optString("id", "")
            if (id.isEmpty()) return null
            val daysArr = o.optJSONArray("days")
            val days = mutableListOf<Int>()
            if (daysArr != null) {
                for (i in 0 until daysArr.length()) days.add(daysArr.optInt(i))
            }
            return AlarmSpec(
                id = id,
                hour = o.optInt("hour", 7),
                minute = o.optInt("minute", 0),
                label = o.optString("label", "알람"),
                enabled = o.optBoolean("enabled", true),
                sound = o.optString("sound", "default"),
                vibration = o.optString("vibration", "normal"),
                days = days,
                isWake = o.optBoolean("isWake", false),
            )
        }

        fun listToJsonString(specs: List<AlarmSpec>): String {
            val arr = JSONArray()
            specs.forEach { arr.put(it.toJson()) }
            return arr.toString()
        }

        fun listFromJsonString(s: String?): List<AlarmSpec> {
            if (s.isNullOrEmpty()) return emptyList()
            return try {
                val arr = JSONArray(s)
                (0 until arr.length()).mapNotNull { from(arr.getJSONObject(it)) }
            } catch (e: Exception) {
                emptyList()
            }
        }
    }
}
