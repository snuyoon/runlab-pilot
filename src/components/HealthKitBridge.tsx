"use client";

/**
 * HealthKitBridge — 네이티브 셸이 전달하는 운동 세션(HealthKit)을 수신해 저장.
 *
 * 루트 레이아웃에 항상 마운트 → 어느 화면에 있든 네이티브가 window.__runlabWorkout(w)로
 * 밀어주는 워크아웃을 받아 studyStore에 멱등 저장(UUID)하고 서버로 전송한다.
 * 앱 진입 시 healthKitSync()로 밀린 워크아웃 재동기화를 요청한다. (비네이티브에선 no-op)
 */

import { useEffect } from "react";
import { isNativeApp, onNativeWorkout, healthKitSync } from "@/lib/native";
import { addWorkoutSession } from "@/store/studyStore";

export function HealthKitBridge() {
  useEffect(() => {
    onNativeWorkout((w) => {
      addWorkoutSession({
        id: w.id,
        date: w.date,
        source: w.source || "healthkit",
        activityType: w.activityType || "running",
        startAt: w.startAt,
        endAt: w.endAt,
        durationSec: w.durationSec,
        distanceM: w.distanceM,
        avgPaceSecPerKm: w.avgPaceSecPerKm ?? null,
        avgHeartRate: w.avgHeartRate ?? null,
      });
    });
    if (isNativeApp()) healthKitSync(); // 앱 열릴 때 밀린 워크아웃 catch-up
  }, []);
  return null;
}
