"use client";

/**
 * /dashboard — 내 기록 + 데이터 내보내기
 *
 * 파일럿 단계에서는 데이터가 참여자 기기(localStorage)에만 저장되므로,
 * 참여 종료 시(또는 주기적으로) 이 화면에서 JSON을 내보내 연구자에게 전달한다.
 * 아이폰에서는 '공유하기'(Web Share)로 카톡/메일/에어드랍 전송 가능.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { loadData, exportJSON, exportCSV, resetAll } from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";

export default function DashboardPage() {
  const mounted = useMounted();
  if (!mounted) return <div className="mobile-frame" />;
  return <DashboardInner />;
}

function DashboardInner() {
  const router = useRouter();
  const [data] = useState(() => loadData());
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  const download = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const code = data.settings.participantCode || "UNKNOWN";

  const handleShare = async () => {
    const json = exportJSON();
    const file = new File([json], `runlab-${code}.json`, { type: "application/json" });
    const nav = navigator as Navigator & {
      canShare?: (d: { files: File[] }) => boolean;
    };
    try {
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `RunLab 데이터 (${code})` });
        return;
      }
    } catch {
      return; // 사용자가 공유 취소
    }
    // 공유 미지원 → 클립보드 복사
    try {
      await navigator.clipboard.writeText(json);
      showToast("클립보드에 복사되었습니다");
    } catch {
      download(json, `runlab-${code}.json`, "application/json");
    }
  };

  const handleReset = () => {
    if (confirm("모든 기록이 삭제됩니다. 정말 초기화할까요?\n(테스트용 기능입니다)")) {
      resetAll();
      router.replace("/");
    }
  };

  const stats = [
    { label: "기상 설문", value: `${data.wakeEMAs.length}회`, emoji: "☀️" },
    { label: "러닝 세션", value: `${data.sessionRPEs.length}회`, emoji: "🏃" },
    { label: "주간 설문", value: `${data.ostrcResponses.length}주`, emoji: "📋" },
    { label: "수면 기록", value: `${data.sleepLogs.length}회`, emoji: "🌙" },
  ];

  const recentRPE = [...data.sessionRPEs].reverse().slice(0, 5);
  const recentOSTRC = [...data.ostrcResponses].reverse().slice(0, 4);

  return (
    <div className="mobile-frame flex flex-col bg-slate-50 px-5 pt-8 pb-10 safe-top safe-bottom">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/home")} className="text-slate-400 text-xl px-1">
          ←
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800">내 기록</h1>
          <p className="text-xs text-slate-400">{code}</p>
        </div>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-2 gap-2.5 mb-6">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white rounded-2xl p-4 shadow-sm"
          >
            <div className="text-2xl mb-1">{s.emoji}</div>
            <div className="text-lg font-bold text-slate-800">{s.value}</div>
            <div className="text-xs text-slate-400">{s.label}</div>
          </motion.div>
        ))}
      </div>

      {/* 최근 러닝 세션 */}
      {recentRPE.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
          <div className="text-sm font-bold text-slate-600 mb-3">최근 러닝 세션</div>
          <div className="flex flex-col gap-2">
            {recentRPE.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{s.date}</span>
                <span className="text-slate-400 text-xs flex-1 text-center">{s.note}</span>
                <span className="font-bold text-orange-500">RPE {s.rpe}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 최근 주간 설문 */}
      {recentOSTRC.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-6">
          <div className="text-sm font-bold text-slate-600 mb-3">주간 건강 설문 (OSTRC)</div>
          <div className="flex flex-col gap-2">
            {recentOSTRC.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{r.weekKey} 주</span>
                {r.noProblem ? (
                  <span className="text-emerald-500 font-semibold text-xs">문제 없음</span>
                ) : (
                  <span className="text-slate-600 text-xs">
                    문제 {r.problems.length}건 · 최고 심각도{" "}
                    <strong className="text-red-400">
                      {Math.max(...r.problems.map((p) => p.severityScore), 0)}
                    </strong>
                    /100
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* 내보내기 */}
      <div className="text-sm font-bold text-slate-600 mb-2.5">데이터 내보내기</div>
      <div className="flex flex-col gap-2 mb-6">
        <button
          onClick={handleShare}
          className="w-full py-3.5 rounded-2xl font-semibold text-white
            bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-200"
        >
          📤 연구자에게 데이터 보내기 (JSON)
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => download(exportJSON(), `runlab-${code}.json`, "application/json")}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold text-slate-600 bg-white border-2 border-slate-200"
          >
            JSON 저장
          </button>
          <button
            onClick={() => download(exportCSV(), `runlab-${code}.csv`, "text/csv")}
            className="flex-1 py-3 rounded-2xl text-sm font-semibold text-slate-600 bg-white border-2 border-slate-200"
          >
            CSV 저장
          </button>
        </div>
      </div>

      {/* 초기화 (테스트용) */}
      <button onClick={handleReset} className="text-center text-xs text-red-300 py-2">
        전체 초기화 (테스트용)
      </button>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-full z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
