"use client";

/**
 * /alarm — 알람앱 (기본 시계 앱 방식)
 *
 * - 여러 알람을 등록하고 개별 on/off
 * - 각 알람: 시각, 라벨, 반복 요일, 소리, 진동 세기, '기상 알람' 여부
 * - 기상 알람(isWake)을 끄면 기상 설문이 자동으로 열린다 (네이티브 AlarmKit)
 * - 저장하면 네이티브에 전체 목록을 동기화 → 시스템 알람으로 등록(앱 꺼져도 울림)
 * - Safari(비네이티브)에서는 취침 화면을 켜둔 채로만 동작하는 웹 알람 폴백
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  getAlarms,
  saveAlarms,
  makeId,
  AlarmItem,
  AlarmSound,
  AlarmVibration,
  ALARM_SOUNDS,
  ALARM_VIBRATIONS,
} from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";
import { isNativeApp, nativeSyncAlarms } from "@/lib/native";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]; // index+1 = day id

function daysSummary(days: number[]): string {
  if (days.length === 0 || days.length === 7) return "매일";
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join() === "1,2,3,4,5") return "주중 (월~금)";
  if (sorted.join() === "6,7") return "주말 (토·일)";
  return sorted.map((d) => DAY_LABELS[d - 1]).join(" ");
}

function TimeWheel({ label, value, onChange, max }: {
  label: string; value: number; onChange: (v: number) => void; max: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex flex-col items-center">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => onChange((value + 1) % (max + 1))} className="text-slate-400 text-2xl py-1">▲</motion.button>
        <motion.div key={value} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          className="text-5xl font-bold text-slate-800 tabular-nums w-20 text-center">
          {String(value).padStart(2, "0")}
        </motion.div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => onChange(value === 0 ? max : value - 1)} className="text-slate-400 text-2xl py-1">▼</motion.button>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative w-[52px] h-8 rounded-full shrink-0 transition-colors duration-200 ${on ? "bg-indigo-500" : "bg-slate-300"}`}
    >
      <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}

export default function AlarmPage() {
  const mounted = useMounted();
  if (!mounted) return <div className="mobile-frame bg-slate-50" />;
  return <AlarmInner />;
}

function AlarmInner() {
  const router = useRouter();
  const [alarms, setAlarms] = useState<AlarmItem[]>(() => getAlarms());
  const [editing, setEditing] = useState<AlarmItem | null>(null);
  const [toast, setToast] = useState("");

  /** 목록 저장 + 네이티브 동기화 */
  const commit = (next: AlarmItem[]) => {
    setAlarms(next);
    saveAlarms(next);
    if (isNativeApp()) nativeSyncAlarms(next);
  };

  const toggle = (id: string) => {
    commit(alarms.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
  };

  const addNew = () => {
    setEditing({
      id: makeId(),
      hour: 7,
      minute: 0,
      label: "알람",
      enabled: true,
      sound: "default",
      vibration: "normal",
      days: [],
      isWake: alarms.every((a) => !a.isWake), // 기상 알람이 없으면 새 알람을 기상 알람으로
    });
  };

  const saveEdit = (item: AlarmItem) => {
    const exists = alarms.some((a) => a.id === item.id);
    let next = exists ? alarms.map((a) => (a.id === item.id ? item : a)) : [...alarms, item];
    // 기상 알람은 하나만 — 새로 지정하면 나머지는 해제
    if (item.isWake) next = next.map((a) => (a.id === item.id ? a : { ...a, isWake: false }));
    next.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
    commit(next);
    setEditing(null);
    setToast("저장되었습니다");
    setTimeout(() => setToast(""), 1500);
  };

  const remove = (id: string) => {
    commit(alarms.filter((a) => a.id !== id));
    setEditing(null);
  };

  return (
    <div className="mobile-frame flex flex-col bg-slate-50 safe-top safe-bottom">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/home")} className="text-slate-400 text-xl px-1">←</button>
          <h1 className="text-xl font-bold text-slate-800">알람</h1>
        </div>
        <button onClick={addNew} className="text-indigo-500 text-2xl font-light px-2" aria-label="알람 추가">＋</button>
      </div>

      {/* 네이티브 안내 */}
      {!isNativeApp() && (
        <div className="mx-5 mb-3 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-700 leading-relaxed">
          지금은 웹 브라우저예요. 앱을 닫아도 울리는 진짜 알람은 <strong>RunLab 앱</strong>에서 동작합니다.
        </div>
      )}

      {/* 알람 목록 */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {alarms.length === 0 ? (
          <div className="text-center text-slate-300 mt-20 text-sm">
            등록된 알람이 없어요.<br />오른쪽 위 ＋ 로 알람을 추가하세요.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {alarms.map((a) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-3xl p-5 shadow-sm flex items-center justify-between gap-3"
              >
                {/* 정보 영역 탭 → 편집 */}
                <button
                  onClick={() => setEditing(a)}
                  className={`text-left flex-1 min-w-0 ${a.enabled ? "" : "opacity-40"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-4xl font-bold text-slate-800 tabular-nums">
                      {String(a.hour).padStart(2, "0")}:{String(a.minute).padStart(2, "0")}
                    </span>
                    {a.isWake && (
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">
                        기상·설문
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 truncate">
                    {a.label} · {daysSummary(a.days)} · {ALARM_SOUNDS.find((s) => s.id === a.sound)?.label}
                  </div>
                </button>
                <Toggle on={a.enabled} onClick={() => toggle(a.id)} label={`${a.label} 켜기/끄기`} />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 편집 시트 */}
      <AnimatePresence>
        {editing && (
          <AlarmEditor
            item={editing}
            canDelete={alarms.some((a) => a.id === editing.id)}
            onSave={saveEdit}
            onDelete={() => remove(editing.id)}
            onCancel={() => setEditing(null)}
          />
        )}
      </AnimatePresence>

      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-full z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── 알람 편집 시트 ─────────────────────────────────────────

function AlarmEditor({ item, canDelete, onSave, onDelete, onCancel }: {
  item: AlarmItem;
  canDelete: boolean;
  onSave: (a: AlarmItem) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AlarmItem>(item);
  const patch = (p: Partial<AlarmItem>) => setDraft((d) => ({ ...d, ...p }));

  const toggleDay = (day: number) => {
    const has = draft.days.includes(day);
    patch({ days: has ? draft.days.filter((d) => d !== day) : [...draft.days, day] });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end justify-center"
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-50 w-full max-w-[430px] rounded-t-3xl max-h-[92dvh] overflow-y-auto safe-bottom"
      >
        {/* 상단 액션 */}
        <div className="flex items-center justify-between px-5 py-4 sticky top-0 bg-slate-50/95 backdrop-blur z-10">
          <button onClick={onCancel} className="text-slate-400">취소</button>
          <span className="font-bold text-slate-800">알람 편집</span>
          <button onClick={() => onSave(draft)} className="text-indigo-500 font-bold">저장</button>
        </div>

        {/* 시각 */}
        <div className="bg-white rounded-3xl mx-4 mb-4 p-5 flex items-center justify-center gap-4">
          <TimeWheel label="시" value={draft.hour} onChange={(v) => patch({ hour: v })} max={23} />
          <span className="text-4xl font-bold text-slate-300 mt-4">:</span>
          <TimeWheel label="분" value={draft.minute} onChange={(v) => patch({ minute: v })} max={59} />
        </div>

        {/* 라벨 */}
        <div className="bg-white rounded-3xl mx-4 mb-4 p-5">
          <label className="text-xs font-semibold text-slate-500 block mb-2">이름</label>
          <input
            type="text" value={draft.label} onChange={(e) => patch({ label: e.target.value })}
            placeholder="예: 기상 알람"
            className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 text-base focus:border-indigo-400 focus:outline-none"
          />
        </div>

        {/* 반복 요일 */}
        <div className="bg-white rounded-3xl mx-4 mb-4 p-5">
          <div className="text-xs font-semibold text-slate-500 mb-3">반복 (선택 안 하면 매일)</div>
          <div className="flex justify-between">
            {DAY_LABELS.map((label, i) => {
              const day = i + 1;
              const on = draft.days.includes(day);
              return (
                <button
                  key={day} onClick={() => toggleDay(day)}
                  className={`w-10 h-10 rounded-full text-sm font-semibold transition-colors
                    ${on ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 소리 */}
        <div className="bg-white rounded-3xl mx-4 mb-4 p-5">
          <div className="text-xs font-semibold text-slate-500 mb-3">🔔 소리</div>
          <div className="grid grid-cols-3 gap-2">
            {ALARM_SOUNDS.map((s) => (
              <button
                key={s.id} onClick={() => patch({ sound: s.id as AlarmSound })}
                className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors
                  ${draft.sound === s.id ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-slate-200 bg-white text-slate-600"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 진동 */}
        <div className="bg-white rounded-3xl mx-4 mb-4 p-5">
          <div className="text-xs font-semibold text-slate-500 mb-3">📳 진동</div>
          <div className="grid grid-cols-3 gap-2">
            {ALARM_VIBRATIONS.map((v) => (
              <button
                key={v.id} onClick={() => patch({ vibration: v.id as AlarmVibration })}
                className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors
                  ${draft.vibration === v.id ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-slate-200 bg-white text-slate-600"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* 기상 알람 여부 */}
        <div className="bg-white rounded-3xl mx-4 mb-4 p-5 flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-800 text-[15px]">기상 알람 (설문 연동)</div>
            <div className="text-xs text-slate-400 mt-0.5">이 알람을 끄면 기상 설문이 자동으로 열려요</div>
          </div>
          <Toggle on={draft.isWake} onClick={() => patch({ isWake: !draft.isWake })} label="기상 알람 설정" />
        </div>

        {/* 삭제 */}
        {canDelete && (
          <div className="px-4 pb-8 pt-1">
            <button onClick={onDelete} className="w-full py-3.5 rounded-2xl text-red-500 font-semibold bg-white">
              알람 삭제
            </button>
          </div>
        )}
        {!canDelete && <div className="pb-8" />}
      </motion.div>
    </motion.div>
  );
}
