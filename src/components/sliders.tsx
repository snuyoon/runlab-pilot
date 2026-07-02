"use client";

/**
 * 드래그 점수 입력 컴포넌트
 *
 * - ScaleSlider: 1~N 정수 척도 (기상 설문 1~10점)
 * - SnapSlider: 고정 선택지에 스냅되는 드래그 (OSTRC 핵심 4문항 — 검증된
 *   4개 선택지·점수 체계를 그대로 유지하면서 입력 방식만 드래그로)
 *
 * framer-motion drag 대신 포인터 이벤트로 직접 구현 — 백그라운드 탭에서도
 * 동작하고, iOS 터치에서 스크롤 간섭 없이(touch-none) 안정적으로 작동한다.
 */

import { useCallback, useRef, useState } from "react";

function useTrackPointer(onRatio: (ratio: number) => void) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const emit = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onRatio(ratio);
    },
    [onRatio]
  );

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      emit(e.clientX);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current) emit(e.clientX);
    },
    onPointerUp: () => {
      draggingRef.current = false;
    },
    onPointerCancel: () => {
      draggingRef.current = false;
    },
  };

  return { trackRef, handlers };
}

// ─── 1~N 정수 척도 슬라이더 ─────────────────────────────────

export function ScaleSlider({
  min = 1,
  max = 10,
  value,
  onChange,
  leftLabel,
  rightLabel,
}: {
  min?: number;
  max?: number;
  value: number | null;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
}) {
  const { trackRef, handlers } = useTrackPointer((ratio) => {
    onChange(Math.round(min + ratio * (max - min)));
  });

  const pct = value === null ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <div>
      {/* 현재 값 */}
      <div className="text-center mb-2 h-9">
        {value === null ? (
          <span className="text-sm text-slate-300">드래그해서 선택</span>
        ) : (
          <span className="text-3xl font-bold text-indigo-600 tabular-nums">{value}</span>
        )}
      </div>

      {/* 트랙 */}
      <div
        ref={trackRef}
        {...handlers}
        className="relative h-12 touch-none select-none cursor-pointer flex items-center"
      >
        <div className="w-full h-3 rounded-full bg-gradient-to-r from-red-200 via-amber-200 to-emerald-300" />
        {value !== null && (
          <>
            <div
              className="absolute h-3 rounded-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-500 opacity-0"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute w-8 h-8 rounded-full bg-white border-[3px] border-indigo-500 shadow-lg
                -translate-x-1/2 flex items-center justify-center text-[11px] font-bold text-indigo-600"
              style={{ left: `${pct}%` }}
            >
              {value}
            </div>
          </>
        )}
      </div>

      {/* 양끝 라벨 */}
      <div className="flex justify-between text-[11px] text-slate-400 mt-0.5">
        <span>{min} · {leftLabel}</span>
        <span>{max} · {rightLabel}</span>
      </div>
    </div>
  );
}

// ─── 고정 선택지 스냅 슬라이더 (OSTRC용) ────────────────────

export function SnapSlider({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: number | null;
  onChange: (index: number) => void;
}) {
  const n = options.length;
  const { trackRef, handlers } = useTrackPointer((ratio) => {
    onChange(Math.round(ratio * (n - 1)));
  });
  const [touched, setTouched] = useState(false);

  const pct = value === null ? 0 : (value / (n - 1)) * 100;

  return (
    <div>
      {/* 트랙 + 스냅 지점 */}
      <div
        ref={trackRef}
        {...handlers}
        onPointerDown={(e) => {
          setTouched(true);
          handlers.onPointerDown(e);
        }}
        className="relative h-14 touch-none select-none cursor-pointer flex items-center px-1"
      >
        <div className="w-full h-3 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-red-300" />
        {options.map((_, i) => (
          <div
            key={i}
            className={`absolute w-5 h-5 rounded-full border-2 -translate-x-1/2
              ${value !== null && i <= value ? "bg-indigo-400 border-indigo-400" : "bg-white border-slate-300"}`}
            style={{ left: `${(i / (n - 1)) * 100}%` }}
          />
        ))}
        {value !== null && (
          <div
            className="absolute w-9 h-9 rounded-full bg-indigo-500 shadow-lg -translate-x-1/2
              flex items-center justify-center text-white text-sm font-bold"
            style={{ left: `${pct}%` }}
          >
            {value + 1}
          </div>
        )}
      </div>

      {/* 단계 번호 */}
      <div className="relative h-4 px-1">
        {options.map((_, i) => (
          <span
            key={i}
            className={`absolute -translate-x-1/2 text-[11px] tabular-nums
              ${value === i ? "text-indigo-600 font-bold" : "text-slate-300"}`}
            style={{ left: `${(i / (n - 1)) * 100}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>

      {/* 선택된 문항 텍스트 */}
      <div
        className={`mt-3 rounded-2xl border-2 px-4 py-3.5 min-h-[3.5rem] flex items-center
          ${value !== null ? "border-indigo-400 bg-indigo-50" : "border-dashed border-slate-200 bg-white"}`}
      >
        {value !== null ? (
          <span className="text-[15px] leading-snug text-indigo-700 font-semibold">
            {options[value]}
          </span>
        ) : (
          <span className="text-sm text-slate-300">
            {touched ? "" : "슬라이더를 드래그해서 해당되는 항목을 선택해주세요"}
          </span>
        )}
      </div>
    </div>
  );
}
