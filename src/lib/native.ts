"use client";

/**
 * native.ts — iOS 네이티브 셸(WKWebView) 브리지
 *
 * 네이티브 앱은 WKWebView에 window.webkit.messageHandlers.runlab 핸들러를 주입한다.
 * 웹앱은 이 핸들러 존재 여부로 네이티브 여부를 판단하고,
 * 알람 예약/취소를 네이티브(AlarmKit — 앱이 꺼져도 울리는 시스템 알람)에 위임한다.
 * 일반 브라우저(Safari)에서는 기존 웹 알람(화면 켜둔 채 대기)으로 동작한다.
 */

import type { AlarmItem } from "@/store/studyStore";

interface RunlabMessageHandler {
  postMessage: (msg: unknown) => void;
}

function handler(): RunlabMessageHandler | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    webkit?: { messageHandlers?: { runlab?: RunlabMessageHandler } };
  };
  return w.webkit?.messageHandlers?.runlab ?? null;
}

/** 네이티브 iOS 셸 안에서 실행 중인가 */
export function isNativeApp(): boolean {
  return handler() !== null;
}

/**
 * 알람 목록 전체를 네이티브에 동기화 (네이티브가 기존 알람 취소 후 재등록).
 * 알람 추가/수정/삭제/토글 시마다 호출한다.
 */
export function nativeSyncAlarms(alarms: AlarmItem[]) {
  handler()?.postMessage({
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
  handler()?.postMessage({ type: "cancelAll" });
}

/** 네이티브 셸에 현재 참여 코드 전달 (진단/로그용) */
export function nativeSetParticipant(code: string) {
  handler()?.postMessage({ type: "setParticipant", code });
}

/**
 * 네이티브 알람 예약 결과 (AlarmService.emit이 되돌려주는 진단).
 * requested > scheduled 면 시스템에 실제로 안 걸린 것 → UI에서 실패로 표시.
 */
export interface AlarmSyncResult {
  path: string; // alarmkit | legacy:... | legacyDenied:... 등 (실패 경로 식별)
  authState: string; // AlarmKit 권한 상태 (authorized / denied / notDetermined / threw ...)
  requested: number; // 켜진 알람 수
  scheduled: number; // 실제로 시스템에 등록된 수
  systemCount: number; // 시스템이 보고한 등록 알람 수
  errors: string[]; // 예약 실패 사유(있으면)
  at: string;
}

/**
 * 네이티브가 알람 예약을 끝낼 때마다 결과를 받는 콜백 등록.
 * 브리지가 window.__runlabAlarmResult(json)을 호출한다 (WebShellView.evaluateJavaScript).
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
  handler()?.postMessage({ type: "getAlarmDiag" });
}
