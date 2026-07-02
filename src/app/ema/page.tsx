"use client";

/**
 * /ema — 기상 직후 EMA 설문 (3문항, 1~10점 드래그)
 * 알람 해제 후 자동 진입하며, 홈의 '오늘의 할 일'에서도 열 수 있다. 하루 1회.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { addWakeEMA, todayStr, isWakeEMADue } from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";
import { ScaleSlider } from "@/components/sliders";

interface Question {
  id: "sleepQuality" | "fatigue" | "mood";
  label: string;
  emoji: string;
  leftLabel: string;
  rightLabel: string;
}

const questions: Question[] = [
  {
    id: "sleepQuality",
    label: "어젯밤 수면은 어떠셨나요?",
    emoji: "😴",
    leftLabel: "매우 나쁨",
    rightLabel: "매우 좋음",
  },
  {
    id: "fatigue",
    label: "근육통/피로감은 어떠세요?",
    emoji: "💪",
    leftLabel: "매우 심함",
    rightLabel: "전혀 없음",
  },
  {
    id: "mood",
    label: "오늘 기분은 어떠세요?",
    emoji: "🙂",
    leftLabel: "매우 나쁨",
    rightLabel: "매우 좋음",
  },
];

export default function EMAPage() {
  const mounted = useMounted();
  if (!mounted) return <div className="mobile-frame bg-blue-50" />;
  return <EMAInner />;
}

function EMAInner() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  // 오늘 이미 완료했으면 중복 제출 차단 (직접 URL 진입, 뒤로가기 등)
  const [alreadyDone] = useState(() => !isWakeEMADue());

  const allAnswered = questions.every((q) => answers[q.id] !== undefined);

  if (alreadyDone && !submitted) {
    return (
      <div className="mobile-frame flex flex-col items-center justify-center px-8 bg-gradient-to-b from-blue-50 to-indigo-50">
        <div className="text-7xl mb-6">✅</div>
        <div className="text-xl font-bold text-slate-800 mb-2">오늘 기상 설문은 완료했어요</div>
        <p className="text-sm text-slate-500 mb-8 text-center">
          기상 설문은 하루에 한 번만 응답합니다.
          <br />내일 아침에 다시 만나요!
        </p>
        <button
          onClick={() => router.push("/home")}
          className="w-full py-4 rounded-2xl text-lg font-semibold text-white
            bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-200"
        >
          홈으로
        </button>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!allAnswered) return;
    addWakeEMA({
      date: todayStr(),
      sleepQuality: answers.sleepQuality,
      fatigue: answers.fatigue,
      mood: answers.mood,
    });
    setSubmitted(true);
    setTimeout(() => router.push("/home"), 1800);
  };

  return (
    <div className="mobile-frame flex flex-col bg-gradient-to-b from-blue-50 to-indigo-50">
      {!submitted ? (
        <motion.div
          key="form"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col flex-1 px-5 pt-8 pb-6 safe-top safe-bottom"
        >
          {/* 헤더 */}
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => router.push("/home")} className="text-slate-400 text-xl px-1">
              ←
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">기상 설문</h1>
              <p className="text-xs text-slate-500">슬라이더를 드래그해서 1~10점으로 알려주세요</p>
            </div>
          </div>

          {/* 문항 — 드래그 슬라이더 */}
          <div className="flex flex-col gap-4 flex-1">
            {questions.map((q, qi) => (
              <motion.div
                key={q.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: qi * 0.12 }}
                className="bg-white rounded-3xl p-5 shadow-sm"
              >
                <div className="text-sm font-semibold text-slate-700 mb-1">
                  {q.emoji} {q.label}
                </div>
                <ScaleSlider
                  min={1}
                  max={10}
                  value={answers[q.id] ?? null}
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                  leftLabel={q.leftLabel}
                  rightLabel={q.rightLabel}
                />
              </motion.div>
            ))}
          </div>

          {/* 제출 */}
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className={`w-full py-4 rounded-2xl text-lg font-semibold text-white mt-4 transition-all
              ${
                allAnswered
                  ? "bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-200"
                  : "bg-slate-300"
              }`}
          >
            {allAnswered ? "제출하기" : `${Object.keys(answers).length}/3 응답 완료`}
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
            ✅
          </motion.div>
          <div className="text-2xl font-bold text-slate-800 mb-1">기록 완료!</div>
          <div className="text-slate-500 text-sm">오늘도 좋은 하루 보내세요 🏃</div>
        </motion.div>
      )}
    </div>
  );
}
