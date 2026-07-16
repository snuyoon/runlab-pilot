"use client";

/**
 * native.ts — 네이티브 셸 브리지 (iOS WKWebView + Android WebView 공용)
 *
 * 네이티브 앱은 웹뷰에 브리지를 주입한다.
 *  - iOS:     window.webkit.messageHandlers.runlab.postMessage(obj)
 *  - Android: window.RunLabAndroid.postMessage(jsonString)  (addJavascriptInterface)
 * 웹앱은 브리지 존재 여부로 네이티브 여부를 판단하고, 알람 예약/취소와
 * HealthKit/Health Connect 연동을 네이티브(앱이 꺼져도 울리는 시스템 알람)에 위임한다.
 * 일반 브라우저(Safari/Chrome)에서는 기존 웹 알람(화면 켜둔 채 대기)으로 동작한다.
 *
 * 네이티브 → 웹 콜백은 양 플랫폼 공통(evaluateJavaScript / evaluateJavascript):
 *  - window.__runlabAlarmResult(json) — 알람 예약 진단
 *  - window.__runlabWorkout(json)     — 러닝 워크아웃 유입
 */

import type { AlarmItem } from "@/store/studyStore";

interface IOSHandler {
  postMessage: (msg: unknown) => void;
}
interface AndroidBridge {
  postMessage: (json: string) => void;
}

function iosHandler(): IOSHandler | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    webkit?: { messageHandlers?: { runlab?: IOSHandler } };
  };
  return w.webkit?.messageHandlers?.runlab ?? null;
}

function androidBridge(): AndroidBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { RunLabAndroid?: AndroidBridge };
  const b = w.RunLabAndroid;
  return b && typeof b.postMessage === "function" ? b : null;
}

/** 네이티브 셸(iOS/Android)에 메시지 전달 — 플랫폼에 맞는 직렬화로 라우팅 */
function post(msg: Record<string, unknown>): boolean {
  const ios = iosHandler();
  if (ios) {
    ios.postMessage(msg);
    return true;
  }
  const android = androidBridge();
  if (android) {
    android.postMessage(JSON.stringify(msg));
    return true;
  }
  return false;
}

/** 네이티브 셸(iOS 또는 Android) 안에서 실행 중인가 */
export function isNativeApp(): boolean {
  return iosHandler() !== null || androidBridge() !== null;
}

/** 실행 중인 네이티브 플랫폼 ("ios" | "android" | null) */
export function nativePlatform(): "ios" | "android" | null {
  if (iosHandler()) return "ios";
  if (androidBridge()) return "android";
  return null;
}

/**
 * 알람 목록 전체를 네이티브에 동기화 (네이티브가 기존 알람 취소 후 재등록).
 * 알람 추가/수정/삭제/토글 시마다 호출한다.
 */
export function nativeSyncAlarms(alarms: AlarmItem[]) {
  post({
    type: "syncAlarms",
    alarms: alarms.map((a) => ({
      id: a.id,
      hour: a.hour,
      minute: a.minute,
      label: a.label,
      enabled: a.enabled,
      sound: a.sound,
      vibration: a.vibration,
      days: a.days,
      isWake: a.isWake,
    })),
  });
}

/** 모든 네이티브 알람 취소 (계정 전환 등) */
export function nativeCancelAlarm() {
  post({ type: "cancelAll" });
}

/** 네이티브 셸에 현재 참여 코드 전달 (진단/로그용) */
export function nativeSetParticipant(code: string) {
  post({ type: "setParticipant", code });
}

/**
 * 네이티브 알람 예약 결과 (예약 성공/실패 진단).
 * requested > scheduled 면 시스템에 실제로 안 걸린 것 → UI에서 실패로 표시.
 */
export interface AlarmSyncResult {
  path: string; // alarmkit | android | legacy:... 등 (실패 경로 식별)
  authState: string; // 알람/알림 권한 상태 (authorized / denied / notDetermined / threw ...)
  requested: number; // 켜진 알람 수
  scheduled: number; // 실제로 시스템에 등록된 수
  systemCount: number; // 시스템이 보고한 등록 알람 수
  errors: string[]; // 예약 실패 사유(있으면)
  at: string;
}

/**
 * 네이티브가 알람 예약을 끝낼 때마다 결과를 받는 콜백 등록.
 * 브리지가 window.__runlabAlarmResult(json)을 호출한다 (evaluateJavaScript).
 */
export function onNativeAlarmResult(cb: (r: AlarmSyncResult) => void) {
  if (typeof window === "undefined") return;
  (window as unknown as { __runlabAlarmResult?: (r: AlarmSyncResult) => void }).__runlabAlarmResult =
    (r) => {
      if (r) cb(r);
    };
}

/** 마지막 예약 진단을 요청 (화면 진입 시). 네이티브가 __runlabAlarmResult로 회신. */
export function requestAlarmDiag() {
  post({ type: "getAlarmDiag" });
}

/**
 * 네이티브(HealthKit/Health Connect)에서 넘어오는 운동 세션.
 * 가민 FR265 → Garmin Connect → Apple 건강 / Health Connect → 네이티브 셸이 읽어 브리지로 전달.
 */
export interface NativeWorkout {
  id: string; // 워크아웃 UUID (HealthKit UUID / Health Connect metadata.id)
  date: string; // YYYY-MM-DD
  source: string; // "healthkit" | "healthconnect"
  activityType: string; // "running" 등
  startAt: string;
  endAt: string;
  durationSec: number;
  distanceM: number;
  avgPaceSecPerKm: number | null;
  avgHeartRate: number | null;
}

/** 네이티브가 워크아웃을 전달할 때 호출할 콜백 등록 (window.__runlabWorkout). */
export function onNativeWorkout(cb: (w: NativeWorkout) => void) {
  if (typeof window === "undefined") return;
  (window as unknown as { __runlabWorkout?: (w: NativeWorkout) => void }).__runlabWorkout = (w) => {
    if (w) cb(w);
  };
}

/** 건강 데이터 권한 요청 + 연동 시작 (사용자 '연동' 버튼). */
export function requestHealthKit() {
  post({ type: "requestHealthKit" });
}

/** 최근 워크아웃 재동기화 요청 (앱/화면 진입 시 catch-up). 네이티브가 __runlabWorkout로 재전송. */
export function healthKitSync() {
  post({ type: "healthKitSync" });
}
