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
