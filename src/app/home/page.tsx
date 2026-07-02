"use client";

/**
 * /home — 메인 허브
 *
 * - 오늘의 할 일: 기상 설문 / 러닝 세션 기록 / 주간 OSTRC
 * - 앱 진입 시 이번 주 OSTRC 미완료면 팝업(알람형 모달) 표시
 *   (매주 월요일부터 완료 전까지 계속 뜸, '나중에'는 이번 실행 동안만 스누즈)
 * - 알람/취침 카드, 이번 주 기상 설문 현황
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  loadData,
  flushOutbox,
  isWakeEMADue,
  isOSTRCDue,
  isMonday,
  emaStreak,
  todayStr,
  mondayOf,
} from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const OSTRC_SNOOZE_KEY = "runlab-ostrc-snooze";

export default function HomePage() {
  const mounted = useMounted();
  // 하이드레이션 전에는 빈 프레임 (localStorage는 클라이언트 전용)
  if (!mounted) return <div className="mobile-frame" />;
  return <HomeInner />;
}

function HomeInner() {
  const router = useRouter();
  const [data] = useState(() => loadData());
  const [showOSTRCPopup, setShowOSTRCPopup] = useState(
    () =>
      data.settings.participantCode !== "" &&
      isOSTRCDue(data) &&
      sessionStorage.getItem(OSTRC_SNOOZE_KEY) !== mondayOf()
  );

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

  if (!loggedIn) {
    return <div className="mobile-frame" />;
  }

  const emaDone = !isWakeEMADue(data);
  const ostrcDone = !isOSTRCDue(data);
  const streak = emaStreak(data);
  const today = todayStr();
  const todaySessions = data.sessionRPEs.filter((s) => s.date === today);
  const alarmTime = `${String(data.settings.alarmHour).padStart(2, "0")}:${String(
    data.settings.alarmMinute
  ).padStart(2, "0")}`;

  // 이번 주(월~일) 기상 설문 완료 현황
  const monday = new Date(mondayOf());
  const weekStatus = DAY_LABELS.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ds = todayStr(d);
    return {
      label,
      date: ds,
      isToday: ds === today,
      isFuture: ds > today,
      done: data.wakeEMAs.some((e) => e.date === ds),
    };
  });

  const snoozeOSTRC = () => {
    sessionStorage.setItem(OSTRC_SNOOZE_KEY, mondayOf());
    setShowOSTRCPopup(false);
  };

  return (
    <div className="mobile-frame flex flex-col bg-slate-50 px-5 pt-8 pb-10 safe-top safe-bottom">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            RunLab <span className="text-indigo-500 text-sm align-top">PILOT</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {data.settings.participantCode}
            {data.settings.participantLabel && ` (${data.settings.participantLabel})`} ·{" "}
            {new Date().toLocaleDateString("ko-KR", {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </p>
        </div>
        {streak > 0 && (
          <div className="bg-orange-100 text-orange-600 rounded-full px-3 py-1.5 text-sm font-bold">
            🔥 {streak}일 연속
          </div>
        )}
      </div>

      {/* ── 오늘의 할 일 ── */}
      <div className="text-sm font-bold text-slate-600 mb-2.5">오늘의 할 일</div>
      <div className="flex flex-col gap-2.5 mb-6">
        {/* 기상 설문 */}
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => !emaDone && router.push("/ema")}
          className={`w-full flex items-center gap-3.5 rounded-2xl p-4 text-left border-2
            ${emaDone ? "bg-emerald-50 border-emerald-100" : "bg-white border-slate-100 shadow-sm"}`}
        >
          <span className="text-3xl">☀️</span>
          <div className="flex-1">
            <div className="font-semibold text-slate-800 text-[15px]">기상 설문</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {emaDone ? "오늘 완료!" : "일어나서 오늘의 컨디션 기록하기"}
            </div>
          </div>
          <span className={`text-xl ${emaDone ? "" : "text-slate-300"}`}>
            {emaDone ? "✅" : "›"}
          </span>
        </motion.button>

        {/* 러닝 세션 RPE — 하루 1회 */}
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => todaySessions.length === 0 && router.push("/rpe")}
          className={`w-full flex items-center gap-3.5 rounded-2xl p-4 text-left border-2
            ${todaySessions.length > 0 ? "bg-emerald-50 border-emerald-100" : "bg-white border-slate-100 shadow-sm"}`}
        >
          <span className="text-3xl">🏃</span>
          <div className="flex-1">
            <div className="font-semibold text-slate-800 text-[15px]">러닝 세션 기록</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {todaySessions.length > 0
                ? `오늘 완료! (RPE ${todaySessions[0].rpe}점)`
                : "러닝을 마쳤다면 세션 강도를 기록해주세요"}
            </div>
          </div>
          <span className={`text-xl ${todaySessions.length > 0 ? "" : "text-slate-300"}`}>
            {todaySessions.length > 0 ? "✅" : "＋"}
          </span>
        </motion.button>

        {/* 주간 OSTRC */}
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => !ostrcDone && router.push("/ostrc")}
          className={`w-full flex items-center gap-3.5 rounded-2xl p-4 text-left border-2
            ${
              ostrcDone
                ? "bg-emerald-50 border-emerald-100"
                : "bg-white border-indigo-200 shadow-sm"
            }`}
        >
          <span className="text-3xl">📋</span>
          <div className="flex-1">
            <div className="font-semibold text-slate-800 text-[15px] flex items-center gap-2">
              주간 건강 설문 (OSTRC)
              {!ostrcDone && (
                <span className="bg-red-100 text-red-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {isMonday() ? "오늘" : "미완료"}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {ostrcDone ? "이번 주 완료!" : "매주 월요일 · 지난 7일 건강 문제 기록"}
            </div>
          </div>
          <span className={`text-xl ${ostrcDone ? "" : "text-slate-300"}`}>
            {ostrcDone ? "✅" : "›"}
          </span>
        </motion.button>
      </div>

      {/* ── 알람 / 취침 카드 ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-3xl p-5 text-white mb-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-indigo-200 text-xs mb-1">기상 알람</div>
            <div className="text-3xl font-bold tabular-nums">{alarmTime}</div>
          </div>
          <button
            onClick={() => router.push("/alarm")}
            className="bg-white/15 rounded-xl px-3.5 py-2 text-sm backdrop-blur"
          >
            ⚙️ 변경
          </button>
        </div>
        <button
          onClick={() => router.push("/sleep")}
          className="w-full py-3.5 rounded-2xl bg-white/20 backdrop-blur font-semibold text-[15px]"
        >
          🌙 취침 시작하기
        </button>
      </motion.div>

      {/* ── 이번 주 기상 설문 현황 ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
        className="bg-white rounded-3xl p-5 shadow-sm mb-6"
      >
        <div className="text-sm font-bold text-slate-600 mb-3">이번 주 기상 설문</div>
        <div className="flex justify-between">
          {weekStatus.map((day) => (
            <div key={day.date} className="flex flex-col items-center gap-1.5">
              <span
                className={`text-[11px] ${day.isToday ? "text-indigo-500 font-bold" : "text-slate-400"}`}
              >
                {day.label}
              </span>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm
                  ${
                    day.done
                      ? "bg-emerald-100"
                      : day.isFuture
                        ? "bg-slate-50"
                        : day.isToday
                          ? "bg-indigo-50 border-2 border-dashed border-indigo-200"
                          : "bg-slate-100"
                  }`}
              >
                {day.done ? "✅" : day.isFuture ? "" : day.isToday ? "·" : "—"}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── 하단 링크 ── */}
      <button
        onClick={() => router.push("/dashboard")}
        className="text-center text-sm text-slate-400 py-2"
      >
        내 기록 · 데이터 내보내기 →
      </button>

      {/* ── OSTRC 팝업 (알람형 모달) ── */}
      <AnimatePresence>
        {showOSTRCPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center px-6"
            onClick={snoozeOSTRC}
          >
            <motion.div
              initial={{ scale: 0.85, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                className="text-6xl mb-3"
                animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1.4 }}
              >
                🔔
              </motion.div>
              <h2 className="text-xl font-bold text-slate-800 mb-1.5">주간 건강 설문 시간!</h2>
              <p className="text-sm text-slate-500 leading-relaxed mb-6">
                {isMonday()
                  ? "오늘은 월요일이에요. 지난 7일간의 건강 상태를 기록해주세요. (약 1~3분)"
                  : "이번 주 건강 설문이 아직 완료되지 않았어요. 지금 완료해주세요. (약 1~3분)"}
              </p>
              <button
                onClick={() => router.push("/ostrc")}
                className="w-full py-3.5 rounded-2xl text-white font-semibold
                  bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-200 mb-2"
              >
                지금 설문하기
              </button>
              <button onClick={snoozeOSTRC} className="w-full py-3 text-sm text-slate-400">
                나중에 하기
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
