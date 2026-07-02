"use client";

/**
 * /rpe — 러닝 세션 강도(RPE) 설문
 * 러닝 종료 후 "이번 세션이 얼마나 힘들었는지"를 1~10점으로 기록한다.
 * (세션 RPE, Borg CR-10 기반)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { addSessionRPE, todayStr } from "@/store/studyStore";

/** 1~10 강도 라벨 및 색상 */
const RPE_LEVELS: { value: number; label: string; color: string }[] = [
  { value: 1, label: "매우 매우 가벼움", color: "#34d399" },
  { value: 2, label: "매우 가벼움", color: "#4ade80" },
  { value: 3, label: "가벼움", color: "#a3e635" },
  { value: 4, label: "다소 힘듦", color: "#facc15" },
  { value: 5, label: "힘듦", color: "#fbbf24" },
  { value: 6, label: "꽤 힘듦", color: "#fb923c" },
  { value: 7, label: "매우 힘듦", color: "#f97316" },
  { value: 8, label: "매우 많이 힘듦", color: "#ef4444" },
  { value: 9, label: "거의 한계", color: "#dc2626" },
  { value: 10, label: "최대 강도", color: "#b91c1c" },
];

export default function RPEPage() {
  const router = useRouter();
  const [rpe, setRpe] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const selected = RPE_LEVELS.find((l) => l.value === rpe);

  const handleSubmit = () => {
    if (rpe === null) return;
    addSessionRPE({
      date: todayStr(),
      rpe,
      note: note.trim(),
    });
    setSubmitted(true);
    setTimeout(() => router.push("/home"), 1800);
  };

  return (
    <div className="mobile-frame flex flex-col bg-gradient-to-b from-orange-50 to-amber-50">
        {!submitted ? (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col flex-1 px-5 pt-8 pb-6 safe-top safe-bottom"
          >
            {/* 헤더 */}
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => router.push("/home")} className="text-slate-400 text-xl px-1">
                ←
              </button>
              <div>
                <h1 className="text-xl font-bold text-slate-800">러닝 세션 기록</h1>
                <p className="text-xs text-slate-500">방금 마친 러닝에 대해 알려주세요</p>
              </div>
            </div>

            {/* RPE 선택 */}
            <div className="text-sm font-semibold text-slate-700 mb-1">
              이번 세션은 얼마나 힘드셨나요?
            </div>
            <p className="text-xs text-slate-400 mb-4">
              1 = 매우 매우 가벼움 · 10 = 최대 강도
            </p>

            <div className="grid grid-cols-5 gap-2 mb-3">
              {RPE_LEVELS.map((level) => {
                const isSelected = rpe === level.value;
                return (
                  <motion.button
                    key={level.value}
                    onClick={() => setRpe(level.value)}
                    whileTap={{ scale: 0.9 }}
                    animate={isSelected ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                    className="py-4 rounded-2xl text-xl font-bold border-2 transition-all"
                    style={{
                      borderColor: isSelected ? level.color : "#e2e8f0",
                      background: isSelected ? level.color : "#ffffff",
                      color: isSelected ? "#ffffff" : level.color,
                    }}
                  >
                    {level.value}
                  </motion.button>
                );
              })}
            </div>

            {/* 선택된 강도 라벨 */}
            <div className="h-10 mb-4 flex items-center justify-center">
              <AnimatePresence mode="wait">
                {selected && (
                  <motion.div
                    key={selected.value}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="px-4 py-1.5 rounded-full text-sm font-semibold text-white"
                    style={{ background: selected.color }}
                  >
                    {selected.value}점 — {selected.label}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 선택 입력 */}
            <div className="bg-white rounded-2xl p-4">
              <label className="text-xs font-semibold text-slate-500 block mb-2">
                메모 <span className="font-normal text-slate-400">— 선택</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 인터벌 훈련, 컨디션 좋았음"
                className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 text-base
                  focus:border-orange-400 focus:outline-none"
              />
            </div>

            <div className="flex-1" />

            <button
              onClick={handleSubmit}
              disabled={rpe === null}
              className={`w-full py-4 rounded-2xl text-lg font-semibold text-white mt-4
                ${
                  rpe !== null
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-200"
                    : "bg-slate-300"
                }`}
            >
              {rpe !== null ? "기록하기" : "강도를 선택해주세요"}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center flex-1 px-8"
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260 }}
              className="text-8xl mb-6"
            >
              🏃
            </motion.div>
            <div className="text-2xl font-bold text-slate-800 mb-1">세션 기록 완료!</div>
            <div className="text-slate-500 text-sm">
              오늘 세션 강도: <strong>{rpe}점</strong> {selected && `(${selected.label})`}
            </div>
          </motion.div>
        )}
    </div>
  );
}
