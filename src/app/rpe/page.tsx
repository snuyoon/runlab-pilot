"use client";

/**
 * /rpe — 러닝 세션 설문 (세션 종료 후 micro-EMA)
 *
 * 흐름 (전 문항 탭 기반, 자유서술 없음):
 *   Q1 sRPE(Foster CR-10 0~10) → Q2 계획 완수?
 *     └ 아니오일 때만: Q2a 무엇이 달랐나(복수) → Q2b 가장 큰 이유(단일 C1~C6)
 *   Q3 통증?(독립·매 세션) → 예면 부위 + NRS 0~10
 * 세션 기록은 하루 1회(그날의 대표 세션).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  addSessionRPE,
  todayStr,
  isRPEDoneToday,
  loadData,
  SRPE_ANCHORS,
  DEVIATION_OPTIONS,
  REASON_OPTIONS,
  PAIN_AREAS,
  DeviationReasonCode,
  fetchPlans,
  getPlanForDate,
  workoutForDate,
  sessionAU,
  CoachPlan,
  WorkoutSession,
} from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";
import { isNativeApp, healthKitSync } from "@/lib/native";

type Phase = "srpe" | "plan" | "deviation" | "reason" | "pain";

// 0~10 색상 (초록 → 빨강). sRPE 강도·NRS 통증 강도 공용.
const SCALE_COLORS = [
  "#34d399", "#4ade80", "#a3e635", "#bef264", "#facc15", "#fbbf24",
  "#fb923c", "#f97316", "#ef4444", "#dc2626", "#b91c1c",
];

export default function RPEPage() {
  const mounted = useMounted();
  if (!mounted) return <div className="mobile-frame bg-orange-50" />;
  return <RPEInner />;
}

function RPEInner() {
  const router = useRouter();
  const [loggedIn] = useState(() => loadData().settings.participantCode !== "");
  useEffect(() => {
    if (!loggedIn) router.replace("/");
  }, [loggedIn, router]);
  const [alreadyDone] = useState(() => isRPEDoneToday());

  const [phase, setPhase] = useState<Phase>("srpe");
  const [submitted, setSubmitted] = useState(false);

  // 응답 상태
  const [rpe, setRpe] = useState<number | null>(null);
  const [planCompleted, setPlanCompleted] = useState<boolean | null>(null);
  const [deviations, setDeviations] = useState<string[]>([]);
  const [reasonCode, setReasonCode] = useState<DeviationReasonCode | null>(null);
  const [pain, setPain] = useState<boolean | null>(null);
  const [painArea, setPainArea] = useState<string | null>(null);
  const [painNRS, setPainNRS] = useState<number | null>(null);

  // AU 비교 — 가민 세션 부하(실제) vs 코치 계획
  const today = todayStr();
  const [code] = useState(() => loadData().settings.participantCode);
  const [todayWorkout, setTodayWorkout] = useState<WorkoutSession | null>(() => workoutForDate(today));
  const [plan, setPlan] = useState<CoachPlan | null>(() => getPlanForDate(today));

  useEffect(() => {
    if (isNativeApp()) healthKitSync(); // 세션 기록 진입 시 가민 자동 동기화
    if (code) fetchPlans(code).then(() => setPlan(getPlanForDate(today)));
    const onWorkout = () => setTodayWorkout(workoutForDate(today));
    window.addEventListener("runlab:workout", onWorkout);
    return () => window.removeEventListener("runlab:workout", onWorkout);
  }, [code, today]);

  if (!loggedIn) return <div className="mobile-frame bg-orange-50" />;

  if (alreadyDone && !submitted) {
    return (
      <div className="mobile-frame flex flex-col items-center justify-center px-8 bg-gradient-to-b from-orange-50 to-amber-50">
        <div className="text-7xl mb-6">✅</div>
        <div className="text-xl font-bold text-slate-800 mb-2">오늘 세션 기록은 완료했어요</div>
        <p className="text-sm text-slate-500 mb-8 text-center">
          러닝 세션 기록은 하루에 한 번만 응답합니다.
          <br />내일 러닝 후에 다시 기록해주세요!
        </p>
        <button
          onClick={() => router.push("/home")}
          className="w-full py-4 rounded-2xl text-lg font-semibold text-white
            bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-200"
        >
          홈으로
        </button>
      </div>
    );
  }

  const submit = (finalPain: boolean, area: string | null, nrs: number | null) => {
    if (rpe === null || planCompleted === null) return;
    addSessionRPE({
      date: todayStr(),
      rpe,
      planCompleted,
      deviations: planCompleted ? [] : deviations,
      reasonCode: planCompleted ? null : reasonCode,
      pain: finalPain,
      painArea: finalPain ? area : null,
      painNRS: finalPain ? nrs : null,
    });
    setSubmitted(true);
    setTimeout(() => router.push("/home"), 1800);
  };

  const goBack = () => {
    if (phase === "srpe") return router.push("/home");
    if (phase === "plan") return setPhase("srpe");
    if (phase === "deviation") return setPhase("plan");
    if (phase === "reason") return setPhase("deviation");
    if (phase === "pain") return setPhase(planCompleted ? "plan" : "reason");
  };

  const toggleDeviation = (id: string) =>
    setDeviations((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  if (submitted) {
    return (
      <div className="mobile-frame flex flex-col items-center justify-center px-8 bg-gradient-to-b from-orange-50 to-amber-50">
        <motion.div
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260 }}
          className="text-8xl mb-6"
        >
          🏃
        </motion.div>
        <div className="text-2xl font-bold text-slate-800 mb-1">세션 기록 완료!</div>
        <div className="text-slate-500 text-sm text-center">
          세션 강도 <strong>{rpe}점</strong>
          {SRPE_ANCHORS[rpe ?? -1] ? ` (${SRPE_ANCHORS[rpe as number]})` : ""}
          {pain ? " · 통증 기록됨" : ""}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-frame flex flex-col bg-gradient-to-b from-orange-50 to-amber-50 safe-top safe-bottom">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-5 pt-8 pb-4">
        <button onClick={goBack} className="text-slate-400 text-xl px-1">←</button>
        <div>
          <h1 className="text-xl font-bold text-slate-800">러닝 세션 기록</h1>
          <p className="text-xs text-slate-500">방금 마친 러닝에 대해 알려주세요</p>
        </div>
      </div>

      {/* 페이즈별 화면 — key 변경 시 remount로 entrance 애니메이션만 (exit 대기 금지) */}
      <motion.div
        key={phase}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col flex-1 px-5 pb-6 min-h-0"
      >
        {/* ===== Q1 sRPE ===== */}
        {phase === "srpe" && (
          <>
            <Question title="이번 세션, 얼마나 힘들었나요?" sub="0 = 휴식 · 10 = 최대 (Foster CR-10)" />
            <TapScale value={rpe} onChange={setRpe} anchors={SRPE_ANCHORS} />
            <div className="flex-1" />
            <PrimaryButton disabled={rpe === null} onClick={() => setPhase("plan")}>
              {rpe === null ? "강도를 선택해주세요" : "다음"}
            </PrimaryButton>
          </>
        )}

        {/* ===== Q2 계획 완수 ===== */}
        {phase === "plan" && (
          <>
            <AUCard
              actualAU={rpe !== null && todayWorkout ? sessionAU(rpe, todayWorkout.durationSec) : null}
              workoutMin={todayWorkout ? Math.round(todayWorkout.durationSec / 60) : null}
              distanceKm={todayWorkout ? todayWorkout.distanceM / 1000 : null}
              plannedAU={plan?.plannedAU ?? null}
              native={isNativeApp()}
              onRefresh={() => healthKitSync()}
            />
            <Question title="오늘 계획대로 완수했나요?" />
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton
                selected={planCompleted === true}
                onClick={() => { setPlanCompleted(true); setDeviations([]); setReasonCode(null); setPhase("pain"); }}
              >
                ✅ 예
              </ChoiceButton>
              <ChoiceButton
                selected={planCompleted === false}
                onClick={() => { setPlanCompleted(false); setPhase("deviation"); }}
              >
                ✋ 아니오
              </ChoiceButton>
            </div>
            <p className="text-xs text-slate-400 mt-4 text-center">
              계획과 달랐다면 몇 가지만 더 여쭤볼게요
            </p>
          </>
        )}

        {/* ===== Q2a 무엇이 달랐나 (복수) ===== */}
        {phase === "deviation" && (
          <>
            <Question title="계획과 무엇이 달랐나요?" sub="해당되는 것 모두 선택" />
            <div className="flex flex-col gap-2.5">
              {DEVIATION_OPTIONS.map((o) => {
                const on = deviations.includes(o.id);
                return (
                  <motion.button
                    key={o.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => toggleDeviation(o.id)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left text-[15px] font-medium transition-colors
                      ${on ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-600"}`}
                  >
                    <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-white text-xs
                      ${on ? "bg-orange-500 border-orange-500" : "border-slate-300"}`}>
                      {on ? "✓" : ""}
                    </span>
                    {o.label}
                  </motion.button>
                );
              })}
            </div>
            <div className="flex-1" />
            <PrimaryButton disabled={deviations.length === 0} onClick={() => setPhase("reason")}>
              {deviations.length === 0 ? "하나 이상 선택해주세요" : "다음"}
            </PrimaryButton>
          </>
        )}

        {/* ===== Q2b 가장 큰 이유 (단일) ===== */}
        {phase === "reason" && (
          <>
            <Question title="가장 큰 이유는 무엇이었나요?" sub="하나만 선택" />
            <div className="flex flex-col gap-2.5">
              {REASON_OPTIONS.map((o) => {
                const on = reasonCode === o.code;
                return (
                  <motion.button
                    key={o.code}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setReasonCode(o.code)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left text-[15px] font-medium transition-colors
                      ${on ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-600"}`}
                  >
                    <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center
                      ${on ? "border-orange-500" : "border-slate-300"}`}>
                      {on && <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />}
                    </span>
                    {o.label}
                  </motion.button>
                );
              })}
            </div>
            <div className="flex-1" />
            <PrimaryButton disabled={reasonCode === null} onClick={() => setPhase("pain")}>
              {reasonCode === null ? "이유를 선택해주세요" : "다음"}
            </PrimaryButton>
          </>
        )}

        {/* ===== Q3 통증 (독립) ===== */}
        {phase === "pain" && (
          <>
            <Question title="세션 중이나 후에 통증이 있었나요?" />
            <div className="grid grid-cols-2 gap-3">
              <ChoiceButton
                selected={pain === false}
                onClick={() => { setPain(false); submit(false, null, null); }}
              >
                👍 아니오
              </ChoiceButton>
              <ChoiceButton
                selected={pain === true}
                onClick={() => setPain(true)}
              >
                ⚠️ 예
              </ChoiceButton>
            </div>

            {pain === true && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 flex flex-col gap-5"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-2">어느 부위인가요?</div>
                  <div className="flex flex-wrap gap-2">
                    {PAIN_AREAS.map((a) => {
                      const on = painArea === a.id;
                      return (
                        <button
                          key={a.id}
                          onClick={() => setPainArea(a.id)}
                          className={`px-3.5 py-2 rounded-xl border-2 text-sm font-medium transition-colors
                            ${on ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-600"}`}
                        >
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-700 mb-2">통증 강도</div>
                  <TapScale
                    value={painNRS}
                    onChange={setPainNRS}
                    anchors={{ 0: "통증 없음", 10: "극심한 통증" }}
                  />
                </div>
                <PrimaryButton
                  disabled={painArea === null || painNRS === null}
                  onClick={() => submit(true, painArea, painNRS)}
                >
                  {painArea === null || painNRS === null ? "부위와 강도를 선택해주세요" : "기록하기"}
                </PrimaryButton>
              </motion.div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

// ─── 재사용 UI ─────────────────────────────────────────────

/** 세션 부하(AU) 카드 — 실제(가민×RPE) vs 코치 계획 비교. Q2 판단 근거로 노출. */
function AUCard({ actualAU, workoutMin, distanceKm, plannedAU, native, onRefresh }: {
  actualAU: number | null;
  workoutMin: number | null;
  distanceKm: number | null;
  plannedAU: number | null;
  native: boolean;
  onRefresh: () => void;
}) {
  // 러닝 아직 미동기화 → AU 계산 불가
  if (actualAU === null) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
        <div className="text-sm font-semibold text-slate-600 mb-1">이번 세션 운동량 (AU)</div>
        <p className="text-xs text-slate-400 leading-relaxed">
          ⌚ 가민 러닝이 아직 동기화 안 됐어요. 러닝이 들어오면 <strong>세션 부하(AU)가 자동 계산</strong>돼요.
          {native ? " 가민 Connect 앱을 열면 빨라져요." : ""}
        </p>
        {native && (
          <button onClick={onRefresh} className="mt-2.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-full px-3 py-1.5">
            🔄 새로고침
          </button>
        )}
      </div>
    );
  }
  const hasPlan = plannedAU != null && plannedAU > 0;
  const ratio = hasPlan ? actualAU / (plannedAU as number) : null;
  const pct = hasPlan ? Math.round(((actualAU - (plannedAU as number)) / (plannedAU as number)) * 100) : 0;
  let verdict = { label: "", cls: "", bar: "bg-indigo-500" };
  if (ratio != null) {
    if (ratio > 1.1) verdict = { label: `계획 초과 +${pct}%`, cls: "text-rose-600 bg-rose-50", bar: "bg-rose-400" };
    else if (ratio < 0.9) verdict = { label: `계획 미달 ${pct}%`, cls: "text-amber-600 bg-amber-50", bar: "bg-amber-400" };
    else verdict = { label: "계획과 거의 일치", cls: "text-emerald-600 bg-emerald-50", bar: "bg-emerald-400" };
  }
  const max = hasPlan ? Math.max(actualAU, plannedAU as number) : actualAU;
  return (
    <div className="rounded-2xl border-2 border-indigo-100 bg-white p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-600">이번 세션 운동량 (AU)</div>
        {ratio != null && (
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${verdict.cls}`}>{verdict.label}</span>
        )}
      </div>
      {hasPlan ? (
        <div className="space-y-2.5">
          <AUBar label="계획" value={plannedAU as number} max={max} color="bg-slate-300" />
          <AUBar label="실제" value={actualAU} max={max} color={verdict.bar} />
        </div>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold text-indigo-600 tabular-nums">{actualAU}</span>
          <span className="text-sm text-slate-400">AU · 코치 계획 미등록</span>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-2.5">
        {distanceKm != null ? `${distanceKm.toFixed(2)}km · ` : ""}{workoutMin}분 × RPE = 세션 부하(AU)
      </p>
    </div>
  );
}

function AUBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-8 shrink-0">{label}</span>
      <div className="flex-1 h-6 rounded-lg bg-slate-100 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${max > 0 ? Math.max(6, (value / max) * 100) : 0}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          className={`h-full ${color} rounded-lg flex items-center justify-end pr-2`}
        >
          <span className="text-[11px] font-bold text-white tabular-nums">{value}</span>
        </motion.div>
      </div>
    </div>
  );
}

function Question({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <div className="text-[17px] font-bold text-slate-800 leading-snug">{title}</div>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function PrimaryButton({ disabled, onClick, children }: {
  disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-4 rounded-2xl text-lg font-semibold text-white mt-4
        ${disabled ? "bg-slate-300" : "bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-200"}`}
    >
      {children}
    </button>
  );
}

function ChoiceButton({ selected, onClick, children }: {
  selected: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={`py-6 rounded-2xl text-lg font-bold border-2 transition-colors
        ${selected ? "border-orange-400 bg-orange-500 text-white" : "border-slate-200 bg-white text-slate-700"}`}
    >
      {children}
    </motion.button>
  );
}

/** 0~10 탭 척도 (색상 + 선택값 앵커 표시) */
function TapScale({ value, onChange, anchors }: {
  value: number | null;
  onChange: (v: number) => void;
  anchors: Record<number, string>;
}) {
  return (
    <div>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 11 }, (_, v) => {
          const on = value === v;
          const color = SCALE_COLORS[v];
          return (
            <motion.button
              key={v}
              whileTap={{ scale: 0.9 }}
              animate={on ? { scale: [1, 1.12, 1] } : { scale: 1 }}
              onClick={() => onChange(v)}
              className="py-3.5 rounded-2xl text-lg font-bold border-2 tabular-nums transition-colors"
              style={{
                borderColor: on ? color : "#e2e8f0",
                background: on ? color : "#ffffff",
                color: on ? "#ffffff" : color,
              }}
            >
              {v}
            </motion.button>
          );
        })}
      </div>
      <div className="h-9 mt-3 flex items-center justify-center">
        {value !== null && anchors[value] && (
          <motion.span
            key={value}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 py-1.5 rounded-full text-sm font-semibold text-white"
            style={{ background: SCALE_COLORS[value] }}
          >
            {value}점 — {anchors[value]}
          </motion.span>
        )}
      </div>
    </div>
  );
}
