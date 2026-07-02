"use client";

/**
 * native.ts — iOS 네이티브 셸(WKWebView) 브리지
 *
 * 네이티브 앱은 WKWebView에 window.webkit.messageHandlers.runlab 핸들러를 주입한다.
 * 웹앱은 이 핸들러 존재 여부로 네이티브 여부를 판단하고,
 * 알람 예약/취소를 네이티브(AlarmKit — 앱이 꺼져도 울리는 시스템 알람)에 위임한다.
 * 일반 브라우저(Safari)에서는 기존 웹 알람(화면 켜둔 채 대기)으로 동작한다.
 */

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

/** 매일 반복 기상 알람 예약 (네이티브 AlarmKit) */
export function nativeScheduleAlarm(hour: number, minute: number) {
  handler()?.postMessage({ type: "scheduleAlarm", hour, minute });
}

/** 네이티브 알람 취소 */
export function nativeCancelAlarm() {
  handler()?.postMessage({ type: "cancelAlarm" });
}

/** 네이티브 셸에 현재 참여 코드 전달 (진단/로그용) */
export function nativeSetParticipant(code: string) {
  handler()?.postMessage({ type: "setParticipant", code });
}
