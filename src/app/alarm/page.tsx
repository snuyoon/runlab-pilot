"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { loadData, saveSettings } from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";
import { isNativeApp, nativeScheduleAlarm } from "@/lib/native";

function TimeWheel({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex flex-col items-center">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => onChange((value + 1) % (max + 1))}
          className="text-slate-400 text-2xl py-1"
        >
          ▲
        </motion.button>
        <motion.div
          key={value}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-5xl font-bold text-slate-800 tabular-nums w-20 text-center"
        >
          {String(value).padStart(2, "0")}
        </motion.div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => onChange(value === 0 ? max : value - 1)}
          className="text-slate-400 text-2xl py-1"
        >
          ▼
        </motion.button>
      </div>
    </div>
  );
}

export default function AlarmPage() {
  const mounted = useMounted();
  if (!mounted) return <div className="mobile-frame" />;
  return <AlarmInner />;
}

function AlarmInner() {
  const router = useRouter();
  const [settings] = useState(() => loadData().settings);
  const [alarmH, setAlarmH] = useState(settings.alarmHour);
  const [alarmM, setAlarmM] = useState(settings.alarmMinute);
  const [bedH, setBedH] = useState(settings.bedtimeHour);
  const [bedM, setBedM] = useState(settings.bedtimeMinute);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveSettings({
      alarmHour: alarmH,
      alarmMinute: alarmM,
      bedtimeHour: bedH,
      bedtimeMinute: bedM,
    });
    // 네이티브 앱이면 시스템 알람(AlarmKit)에 즉시 등록 — 앱이 꺼져도 울림
    if (isNativeApp()) {
      nativeScheduleAlarm(alarmH, alarmM);
    }
    setSaved(true);
    setTimeout(() => router.push("/home"), 800);
  };

  return (
    <div className="mobile-frame flex flex-col bg-gradient-to-b from-indigo-50 to-purple-50 px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => router.back()}
          className="text-slate-400 text-xl"
        >
          ←
        </button>
        <h1 className="text-xl font-bold text-slate-800">알람 설정</h1>
      </div>

      {/* Wake Alarm */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl p-6 shadow-sm mb-4"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">⏰</span>
          <div>
            <div className="font-semibold text-slate-800">기상 알람</div>
            <div className="text-xs text-slate-500">
              알람이 울리면 EMA 설문이 자동으로 열려요
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4">
          <TimeWheel label="시" value={alarmH} onChange={setAlarmH} max={23} />
          <span className="text-4xl font-bold text-slate-300 mt-4">:</span>
          <TimeWheel label="분" value={alarmM} onChange={setAlarmM} max={59} />
        </div>
      </motion.div>

      {/* Bedtime Reminder */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-3xl p-6 shadow-sm mb-4"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🌙</span>
          <div>
            <div className="font-semibold text-slate-800">취침 리마인더</div>
            <div className="text-xs text-slate-500">
              이 시간에 워치 착용 알림을 보내드려요
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4">
          <TimeWheel label="시" value={bedH} onChange={setBedH} max={23} />
          <span className="text-4xl font-bold text-slate-300 mt-4">:</span>
          <TimeWheel label="분" value={bedM} onChange={setBedM} max={59} />
        </div>
      </motion.div>

      {/* Sleep Duration Info */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-indigo-50 rounded-2xl p-4 mb-6 text-center"
      >
        <span className="text-sm text-indigo-600">
          예상 수면 시간:{" "}
          <strong>
            {(() => {
              let h = alarmH - bedH;
              let m = alarmM - bedM;
              if (m < 0) { h--; m += 60; }
              if (h < 0) h += 24;
              return `${h}시간 ${m > 0 ? `${m}분` : ""}`;
            })()}
          </strong>
        </span>
      </motion.div>

      {/* Save */}
      <motion.button
        onClick={handleSave}
        className="w-full py-4 rounded-2xl text-lg font-semibold text-white
          bg-gradient-to-r from-indigo-500 to-purple-500"
        whileTap={{ scale: 0.97 }}
      >
        {saved ? "✅ 저장 완료!" : "저장하기"}
      </motion.button>
    </div>
  );
}
