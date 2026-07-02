"use client";

/**
 * /ema — 기상 직후 EMA 설문 (3문항, 1~5점)
 * 알람 해제 후 자동 진입하며, 홈의 '오늘의 할 일'에서도 열 수 있다.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { addWakeEMA, todayStr } from "@/store/studyStore";

interface Question {
  id: "sleepQuality" | "fatigue" | "mood";
  label: string;
  emojis: string[];
  labels: string[];
}

const questions: Question[] = [
  {
    id: "sleepQuality",
    label: "어젯밤 수면은 어떠셨나요?",
    emojis: ["😫", "😕", "😐", "🙂", "😄"],
    labels: ["매우 나쁨", "나쁨", "보통", "좋음", "매우 좋음"],
  },
  {
    id: "fatigue",
    label: "근육통/피로감은 어떠세요?",
    emojis: ["😵", "😣", "😐", "💪", "🤸"],
    labels: ["매우 심함", "심함", "보통", "가벼움", "없음"],
  },
  {
    id: "mood",
    label: "오늘 기분은 어떠세요?",
    emojis: ["😞", "😔", "😐", "😊", "🤩"],
    labels: ["매우 나쁨", "나쁨", "보통", "좋음", "매우 좋음"],
  },
];

export default function EMAPage() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const allAnswered = questions.every((q) => answers[q.id] !== undefined);

  const handleSelect = (questionId: string, value: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

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
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => router.push("/home")} className="text-slate-400 text-xl px-1">
                ←
              </button>
              <div>
                <h1 className="text-xl font-bold text-slate-800">기상 설문</h1>
                <p className="text-xs text-slate-500">오늘의 컨디션을 알려주세요</p>
              </div>
            </div>

            {/* 문항 */}
            <div className="flex flex-col gap-6 flex-1">
              {questions.map((q, qi) => (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: qi * 0.15 }}
                >
                  <div className="text-sm font-semibold text-slate-700 mb-3">{q.label}</div>
                  <div className="flex gap-2 justify-between">
                    {q.emojis.map((emoji, i) => {
                      const isSelected = answers[q.id] === i + 1;
                      return (
                        <motion.button
                          key={i}
                          onClick={() => handleSelect(q.id, i + 1)}
                          className={`flex flex-col items-center gap-1 flex-1 py-3 rounded-2xl border-2 transition-all
                            ${
                              isSelected
                                ? "border-indigo-400 bg-indigo-50 shadow-lg shadow-indigo-100"
                                : "border-slate-200 bg-white"
                            }`}
                          whileTap={{ scale: 0.9 }}
                          animate={isSelected ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                        >
                          <span className={`transition-all ${isSelected ? "text-4xl" : "text-3xl"}`}>
                            {emoji}
                          </span>
                          <span
                            className={`text-[10px] ${
                              isSelected ? "text-indigo-600 font-semibold" : "text-slate-400"
                            }`}
                          >
                            {q.labels[i]}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
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
