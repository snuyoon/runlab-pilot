"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * 하이드레이션 완료 후 true.
 * localStorage를 읽는 화면을 클라이언트 전용으로 게이트할 때 사용:
 * mounted 전에는 빈 프레임을 렌더해 서버 HTML과 항상 일치시키고,
 * mounted 후 마운트되는 내부 컴포넌트에서 lazy useState로 저장소를 읽는다.
 * (effect 안 setState 없이 hydration mismatch를 피하는 패턴)
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
