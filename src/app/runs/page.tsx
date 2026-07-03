"use client";

/**
 * /runs — 누적 러닝 기록 (가민 → Apple 건강 자동 유입)
 *
 * 요약 통계 + 주간 거리 그래프 + 세션 리스트. 상단 새로고침 버튼으로 즉시 재동기화.
 * addWorkoutSession이 쏘는 "runlab:workout" 이벤트를 구독해 실시간 갱신.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { loadData, getWorkouts, mondayOf, WorkoutSession } from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";
import { isNativeApp, healthKitSync, requestHealthKit } from "@/lib/native";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function fmtPace(secPerKm: number | null): string {
  if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
}
function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${String(m % 60).padStart(2, "0")}분`;
}
function fmtDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}

export default function RunsPage() {
  const mounted = useMounted();
  if (!mounted) return <div className="mobile-frame bg-slate-50" />;
  return <RunsInner />;
}

function RunsInner() {
  const router = useRouter();
  const [workouts, setWorkouts] = useState<WorkoutSession[]>(() => getWorkouts());
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(() => setWorkouts(getWorkouts(loadData())), []);

  useEffect(() => {
    // 새 워크아웃 유입 시 실시간 갱신
    window.addEventListener("runlab:workout", reload);
    if (isNativeApp()) healthKitSync(); // 진입 시 catch-up
    return () => window.removeEventListener("runlab:workout", reload);
  }, [reload]);

  const onSync = () => {
    if (!isNativeApp()) return;
    setSyncing(true);
    healthKitSync();
    // 네이티브가 비동기로 밀어주므로 잠깐 뒤 갱신 + 스피너 종료
    setTimeout(() => {
      reload();
      setSyncing(false);
    }, 2500);
  };

  // ── 통계 ──
  const totalDistM = workouts.reduce((a, w) => a + (w.distanceM || 0), 0);
  const totalSec = workouts.reduce((a, w) => a + (w.durationSec || 0), 0);
  const avgPace = totalDistM > 0 ? totalSec / (totalDistM / 1000) : null;
  const hrVals = workouts.map((w) => w.avgHeartRate).filter((h): h is number => h != null);
  const avgHR = hrVals.length ? hrVals.reduce((a, b) => a + b, 0) / hrVals.length : null;

  const thisWeekKey = mondayOf();
  const thisWeek = workouts.filter((w) => mondayOf(new Date(w.date + "T00:00:00")) === thisWeekKey);
  const thisWeekKm = thisWeek.reduce((a, w) => a + w.distanceM, 0) / 1000;

  // ── 주간 거리 (최근 6주) ──
  const weeks: { key: string; label: string; km: number }[] = [];
  {
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i * 7);
      const key = mondayOf(d);
      const km =
        workouts
          .filter((w) => mondayOf(new Date(w.date + "T00:00:00")) === key)
          .reduce((a, w) => a + w.distanceM, 0) / 1000;
      const md = new Date(key + "T00:00:00");
      weeks.push({ key, label: `${md.getMonth() + 1}/${md.getDate()}`, km });
    }
  }
  const maxWeekKm = Math.max(1, ...weeks.map((w) => w.km));

  return (
    <div className="mobile-frame flex flex-col bg-slate-50 safe-top safe-bottom">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pt-8 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/home")} className="text-slate-400 text-xl px-1">←</button>
          <h1 className="text-xl font-bold text-slate-800">러닝 기록</h1>
        </div>
        {isNativeApp() && (
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-full px-3 py-1.5 disabled:opacity-50"
          >
            <motion.span
              animate={syncing ? { rotate: 360 } : { rotate: 0 }}
              transition={syncing ? { repeat: Infinity, duration: 0.8, ease: "linear" } : { duration: 0 }}
            >
              🔄
            </motion.span>
            {syncing ? "동기화 중" : "새로고침"}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {workouts.length === 0 ? (
          <EmptyState native={isNativeApp()} />
        ) : (
          <>
            {/* 히어로 — 누적 거리 */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl p-6 mb-4 text-white bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 shadow-lg shadow-indigo-200"
            >
              <div className="text-xs font-medium text-indigo-100 mb-1">누적 거리</div>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-extrabold tabular-nums">{(totalDistM / 1000).toFixed(1)}</span>
                <span className="text-lg font-semibold text-indigo-100">km</span>
              </div>
              <div className="text-sm text-indigo-100 mt-2">
                총 {workouts.length}회 · {fmtDuration(totalSec)}
              </div>
            </motion.div>

            {/* 통계 3분할 */}
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <StatTile label="이번 주" value={`${thisWeekKm.toFixed(1)}`} unit="km" />
              <StatTile label="평균 페이스" value={fmtPace(avgPace)} unit="/km" />
              <StatTile label="평균 심박" value={avgHR ? `${Math.round(avgHR)}` : "—"} unit="bpm" />
            </div>

            {/* 주간 거리 그래프 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
              <div className="text-sm font-bold text-slate-600 mb-4">주간 거리 (최근 6주)</div>
              <div className="flex items-end justify-between gap-2 h-28">
                {weeks.map((w, i) => (
                  <div key={w.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
                      {w.km > 0 ? w.km.toFixed(1) : ""}
                    </span>
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${(w.km / maxWeekKm) * 100}%` }}
                      transition={{ delay: i * 0.05, type: "spring", stiffness: 120, damping: 18 }}
                      className={`w-full rounded-lg min-h-[3px] ${
                        i === weeks.length - 1
                          ? "bg-gradient-to-t from-indigo-500 to-violet-400"
                          : "bg-slate-200"
                      }`}
                    />
                    <span className="text-[10px] text-slate-400 tabular-nums">{w.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 세션 리스트 */}
            <div className="text-sm font-bold text-slate-600 mb-2 px-1">전체 기록</div>
            <div className="flex flex-col gap-2.5">
              {workouts.map((w, i) => (
                <motion.div
                  key={w.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="bg-white rounded-2xl p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-semibold text-slate-400">{fmtDay(w.date)}</span>
                    <span className="text-2xl">🏃</span>
                  </div>
                  <div className="flex items-end gap-1.5 mb-3">
                    <span className="text-3xl font-extrabold text-slate-800 tabular-nums">
                      {(w.distanceM / 1000).toFixed(2)}
                    </span>
                    <span className="text-sm font-semibold text-slate-400 mb-1">km</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Metric icon="⏱️" value={fmtDuration(w.durationSec)} label="시간" />
                    <Metric icon="⚡" value={fmtPace(w.avgPaceSecPerKm)} label="페이스" />
                    <Metric icon="❤️" value={w.avgHeartRate ? `${Math.round(w.avgHeartRate)}` : "—"} label="심박" />
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-white rounded-2xl p-3 shadow-sm text-center">
      <div className="text-[11px] text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-800 tabular-nums leading-none">{value}</div>
      <div className="text-[10px] text-slate-400 mt-0.5">{unit}</div>
    </div>
  );
}

function Metric({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="bg-slate-50 rounded-xl py-2 text-center">
      <div className="text-[15px] font-bold text-slate-700 tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] text-slate-400 mt-0.5">{icon} {label}</div>
    </div>
  );
}

function EmptyState({ native }: { native: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center pt-24 px-6">
      <div className="text-6xl mb-5">⌚</div>
      <div className="text-lg font-bold text-slate-700 mb-2">아직 러닝 기록이 없어요</div>
      {native ? (
        <>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            가민 Connect 앱에서 <strong>Apple 건강 공유</strong>를 켜고 아래에서 연동하면,
            러닝이 자동으로 여기에 쌓여요.
          </p>
          <button
            onClick={() => requestHealthKit()}
            className="w-full py-3.5 rounded-2xl text-base font-semibold text-white
              bg-gradient-to-r from-indigo-500 to-violet-600 shadow-lg shadow-indigo-200"
          >
            가민·건강 연동
          </button>
        </>
      ) : (
        <p className="text-sm text-slate-400 leading-relaxed">
          가민 워치 기록 자동 유입은 <strong>RunLab 앱</strong>에서 동작해요.
        </p>
      )}
    </div>
  );
}
