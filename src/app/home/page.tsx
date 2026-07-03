"use client";

/**
 * /home — 메인 허브 v2
 *
 * "One Big Thing": 지금 할 일 1개를 히어로로 크게, 나머지는 콤팩트하게.
 *  ├ HeroTaskCard  — 우선순위(주간OSTRC > 기상설문 > 세션기록 > 완료) 1개, 4변형
 *  ├ TodayStrip    — 오늘 3할일 현황 + 이번주 기상설문 7도트
 *  ├ WeekLoadCard  — 이번 주 훈련부하(실제AU vs 계획AU) + 7일 미니차트 → /runs
 *  └ QuickGrid     — 알람/취침/러닝기록/내기록 2×2
 * v1 보존: /home-v1 (git tag v1-ui). 모션은 entrance만 — AnimatePresence 미사용(절대규칙 6).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  loadData,
  flushOutbox,
  applyRemoteReset,
  getAlarms,
  isWakeEMADue,
  isOSTRCDue,
  isMonday,
  emaStreak,
  todayStr,
  weekLoad,
  workoutForDate,
} from "@/store/studyStore";
import { isNativeApp, nativeSyncAlarms } from "@/lib/native";
import { useMounted } from "@/hooks/useMounted";

export default function HomePage() {
  const mounted = useMounted();
  // 하이드레이션 전에는 빈 프레임 (localStorage는 클라이언트 전용)
  if (!mounted) return <div className="mobile-frame" />;
  return <HomeInner />;
}

function HomeInner() {
  const router = useRouter();
  const [data] = useState(() => loadData());

  const loggedIn = data.settings.participantCode !== "";
  useEffect(() => {
    if (!loggedIn) router.replace("/");
  }, [loggedIn, router]);

  // 미전송 응답을 서버로 전송 (앱 진입 시 + 네트워크 복구 시)
  useEffect(() => {
    void flushOutbox();
    const onOnline = () => void flushOutbox();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // 네이티브 알람 재동기화 — 웹 저장소의 알람 목록이 항상 시스템 알람과 일치하도록
  useEffect(() => {
    if (isNativeApp() && loadData().settings.participantCode) {
      nativeSyncAlarms(getAlarms());
    }
  }, []);

  // 관리자 원격 초기화 확인: 서버 reset_at이 갱신됐으면 로컬 기록을 비우고 새로 시작
  useEffect(() => {
    const check = async () => {
      try {
        const s = loadData().settings;
        if (!s.participantCode) return;
        const res = await fetch("/api/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: s.participantCode }),
        });
        const json = await res.json();
        if (json.valid && typeof json.resetAt === "string" && json.resetAt !== s.lastResetAck) {
          applyRemoteReset(json.resetAt);
          window.location.reload();
        }
      } catch {
        // 오프라인 등 — 다음 진입 때 다시 확인
      }
    };
    void check();
  }, []);

  if (!loggedIn) {
    return <div className="mobile-frame" />;
  }

  const today = todayStr();
  const emaDone = !isWakeEMADue(data);
  const ostrcDone = !isOSTRCDue(data);
  const sessionDone = data.sessionRPEs.some((s) => s.date === today);
  const streak = emaStreak(data);
  const alarmTime = `${String(data.settings.alarmHour).padStart(2, "0")}:${String(
    data.settings.alarmMinute
  ).padStart(2, "0")}`;
  const todayWorkout = workoutForDate(today, data);
  const load = weekLoad(data);
  const runsThisWeek = load.days.filter((d) => d.au > 0).length;

  // 우선순위: 주간 OSTRC > 기상설문 > 세션기록 > 완료
  const hero: "ostrc" | "ema" | "session" | "done" = !ostrcDone
    ? "ostrc"
    : !emaDone
      ? "ema"
      : !sessionDone
        ? "session"
        : "done";

  return (
    <div className="mobile-frame flex flex-col bg-slate-50 px-5 pt-8 pb-10 safe-top safe-bottom">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            RunLab <span className="text-indigo-500 text-xs align-top">PILOT</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {data.settings.participantCode}
            {data.settings.participantLabel && ` (${data.settings.participantLabel})`} ·{" "}
            {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}
          </p>
        </div>
        {streak > 0 && (
          <div className="bg-orange-100 text-orange-600 rounded-full px-2.5 py-1 text-xs font-bold">
            🔥 {streak}일
          </div>
        )}
      </div>

      {/* ── 히어로: 지금 할 일 ── */}
      <HeroTaskCard
        hero={hero}
        streak={streak}
        alarmTime={data.settings.alarmEnabled ? alarmTime : null}
        workoutMin={todayWorkout ? Math.round(todayWorkout.durationSec / 60) : null}
        onGo={(path) => router.push(path)}
      />

      {/* ── 오늘 현황 3칸 + 기상설문 7도트 ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="mb-4"
      >
        <div className="grid grid-cols-3 gap-2">
          {[
            { emoji: "☀️", label: "기상", done: emaDone, path: "/ema" },
            { emoji: "🏃", label: "세션", done: sessionDone, path: "/rpe" },
            { emoji: "📋", label: "주간", done: ostrcDone, path: "/ostrc" },
          ].map((t) => (
            <motion.button
              key={t.label}
              whileTap={{ scale: 0.97 }}
              onClick={() => router.push(t.path)}
              className={`rounded-2xl py-2.5 flex flex-col items-center gap-0.5 border-2
                ${t.done ? "bg-emerald-50 border-emerald-100" : "bg-white border-slate-100 shadow-sm"}`}
            >
              <span className="text-lg leading-none">{t.emoji}</span>
              <span className={`text-[11px] font-bold ${t.done ? "text-emerald-600" : "text-slate-500"}`}>
                {t.label}
              </span>
              <span className={`text-[10px] ${t.done ? "text-emerald-500" : "text-slate-300"}`}>
                {t.done ? "완료" : "대기 ›"}
              </span>
            </motion.button>
          ))}
        </div>
        {/* 이번 주 기상설문 7도트 */}
        <div className="flex justify-center gap-1.5 mt-2.5 mb-1">
          {load.days.map((d) => (
            <span
              key={d.date}
              className={`w-1.5 h-1.5 rounded-full ${
                d.emaDone
                  ? "bg-emerald-400"
                  : d.isToday
                    ? "bg-indigo-300 animate-pulse"
                    : d.isFuture
                      ? "bg-slate-100"
                      : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      </motion.div>

      {/* ── 이번 주 훈련부하 ── */}
      <WeekLoadCard load={load} onGo={() => router.push("/runs")} />

      {/* ── 퀵 그리드 2×2 ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14 }}
        className="grid grid-cols-2 gap-2.5 mb-6"
      >
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => router.push("/alarm")}
          className="rounded-2xl p-4 text-left bg-gradient-to-br from-indigo-600 to-purple-700 text-white"
        >
          <div className="text-[11px] text-indigo-200 font-semibold mb-1">⏰ 기상 알람</div>
          <div className="text-[22px] font-extrabold tabular-nums leading-none">
            {data.settings.alarmEnabled ? alarmTime : "꺼짐"}
          </div>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => router.push("/sleep")}
          className="rounded-2xl p-4 text-left bg-slate-900 text-white"
        >
          <div className="text-[11px] text-slate-400 font-semibold mb-1">🌙 취침</div>
          <div className="text-[15px] font-bold">지금 시작 →</div>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => router.push("/runs")}
          className="rounded-2xl p-4 text-left bg-white border-2 border-slate-100"
        >
          <div className="text-[11px] text-slate-400 font-semibold mb-1">⌚ 러닝 기록</div>
          <div className="text-[15px] font-bold text-slate-800">이번 주 {runsThisWeek}회 →</div>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => router.push("/dashboard")}
          className="rounded-2xl p-4 text-left bg-white border-2 border-slate-100"
        >
          <div className="text-[11px] text-slate-400 font-semibold mb-1">📊 내 기록</div>
          <div className="text-[15px] font-bold text-slate-800">데이터 · 백업 →</div>
        </motion.button>
      </motion.div>
    </div>
  );
}

// ─── 히어로: 지금 할 일 (우선순위 1개, 4변형) ────────────────

function HeroTaskCard({ hero, streak, alarmTime, workoutMin, onGo }: {
  hero: "ostrc" | "ema" | "session" | "done";
  streak: number;
  alarmTime: string | null;
  workoutMin: number | null;
  onGo: (path: string) => void;
}) {
  const shell =
    "relative w-full overflow-hidden rounded-[28px] p-6 text-left mb-4 shadow-xl";
  const entrance = {
    initial: { opacity: 0, y: 16, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { type: "spring" as const, stiffness: 260, damping: 24 },
  };

  if (hero === "done") {
    return (
      <motion.div {...entrance} className={`${shell} bg-white border-2 border-emerald-100 shadow-sm`}>
        <span className="absolute -right-3 -bottom-5 text-[100px] opacity-10 rotate-12 pointer-events-none select-none">🎉</span>
        <motion.span
          animate={{ scale: [0.5, 1.1, 1] }}
          transition={{ type: "spring", stiffness: 260 }}
          className="inline-block bg-emerald-100 text-emerald-600 text-[11px] font-bold px-2.5 py-1 rounded-full"
        >
          ✅ ALL DONE
        </motion.span>
        <div className="text-2xl font-extrabold leading-tight mt-2 text-slate-900">오늘 할 일 끝! 🎉</div>
        <div className="text-sm text-slate-400 mt-1.5">
          {streak > 0 && `🔥 ${streak}일 연속 — `}
          {alarmTime ? `내일 알람 ${alarmTime}에 만나요` : "내일도 화이팅!"}
        </div>
      </motion.div>
    );
  }

  const variants = {
    ostrc: {
      bg: "bg-gradient-to-br from-violet-600 to-indigo-700 shadow-indigo-200",
      badge: isMonday() ? "오늘" : "밀림",
      title: "주간 건강 설문",
      sub: "지난 7일 건강 문제 기록 · 약 1~3분",
      cta: "지금 설문하기 →",
      ctaCls: "bg-white text-violet-700",
      emoji: "📋",
      path: "/ostrc",
    },
    ema: {
      bg: "bg-gradient-to-br from-amber-400 to-orange-500 shadow-orange-200",
      badge: null as string | null,
      title: "좋은 아침이에요 ☀️",
      sub: "일어난 직후 컨디션, 1분이면 끝나요",
      cta: "컨디션 기록하기 →",
      ctaCls: "bg-white text-orange-600",
      emoji: "☀️",
      path: "/ema",
    },
    session: {
      bg: "bg-gradient-to-br from-orange-500 to-rose-500 shadow-rose-200",
      badge: null as string | null,
      title: "오늘 러닝은 어땠나요?",
      sub: workoutMin
        ? `⌚ ${workoutMin}분 러닝이 들어왔어요 — RPE만 알려주세요`
        : "러닝을 마치면 기록해주세요",
      cta: "세션 기록하기 →",
      ctaCls: workoutMin ? "bg-white text-rose-600" : "bg-white/25 text-white",
      emoji: "🏃",
      path: "/rpe",
    },
  }[hero];

  return (
    <motion.button
      {...entrance}
      whileTap={{ scale: 0.98 }}
      onClick={() => onGo(variants.path)}
      className={`${shell} ${variants.bg}`}
    >
      <span className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-white/15 blur-2xl pointer-events-none" />
      <span className="absolute -right-3 -bottom-5 text-[100px] opacity-15 rotate-12 pointer-events-none select-none">
        {variants.emoji}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/70">지금 할 일</span>
        {variants.badge && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {variants.badge}
          </span>
        )}
      </div>
      <div className="text-2xl font-extrabold leading-tight mt-1 text-white">{variants.title}</div>
      <div className="text-sm text-white/80 mt-1.5">{variants.sub}</div>
      <div className={`mt-5 w-full py-3.5 rounded-2xl font-bold text-[15px] text-center ${variants.ctaCls}`}>
        {variants.cta}
      </div>
    </motion.button>
  );
}

// ─── 이번 주 훈련부하 카드 ──────────────────────────────────

function WeekLoadCard({ load, onGo }: {
  load: ReturnType<typeof weekLoad>;
  onGo: () => void;
}) {
  const { actualAU, plannedAU, days } = load;
  const empty = actualAU === 0 && plannedAU === 0;
  const maxAU = Math.max(1, ...days.map((d) => d.au));

  // 판정 배지 — /rpe AUCard와 동일 임계값(1.1/0.9) 공유
  let badge: { label: string; cls: string; bar: string } | null = null;
  if (plannedAU > 0) {
    const ratio = actualAU / plannedAU;
    const pct = Math.round((ratio - 1) * 100);
    if (ratio > 1.1) badge = { label: `목표 초과 +${pct}%`, cls: "text-rose-600 bg-rose-50", bar: "bg-rose-400" };
    else if (ratio < 0.9) badge = { label: `목표의 ${Math.round(ratio * 100)}%`, cls: "text-amber-600 bg-amber-50", bar: "bg-amber-400" };
    else badge = { label: "순항 중", cls: "text-emerald-600 bg-emerald-50", bar: "bg-emerald-400" };
  }

  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.11 }}
      whileTap={{ scale: 0.98 }}
      onClick={onGo}
      className="w-full text-left bg-white rounded-3xl p-5 shadow-sm mb-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-slate-600">이번 주 훈련부하</span>
        {badge && (
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
        )}
      </div>

      {empty ? (
        <p className="text-sm text-slate-400 text-center py-3">아직 이번 주 러닝 기록이 없어요</p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-[32px] font-extrabold tabular-nums text-indigo-600 leading-none">
              {actualAU}
            </span>
            <span className="text-sm font-semibold text-slate-400">
              {plannedAU > 0 ? `/ ${plannedAU} AU` : "AU"}
            </span>
          </div>

          {plannedAU > 0 ? (
            <div className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (actualAU / plannedAU) * 100)}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                className={`h-full rounded-full ${badge?.bar ?? "bg-indigo-400"}`}
              />
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">
              이번 주 세션에서 프로그램을 선택하면 목표 대비가 표시돼요
            </p>
          )}

          {/* 7일 미니차트 */}
          <div className="mt-4 flex items-end gap-1.5 h-14">
            {days.map((d, i) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                {d.au > 0 ? (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: Math.max(4, (d.au / maxAU) * 40) }}
                    transition={{ delay: 0.1 + i * 0.04 }}
                    className={`w-full rounded-md ${d.isToday ? "bg-indigo-500" : "bg-indigo-400"}`}
                  />
                ) : (
                  <div className="w-full h-1 rounded-md bg-slate-100" />
                )}
                <span className={`text-[10px] ${d.isToday ? "text-indigo-500 font-bold" : "text-slate-300"}`}>
                  {d.label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </motion.button>
  );
}
