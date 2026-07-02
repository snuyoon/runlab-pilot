"use client";

/**
 * /ostrc — 주간 OSTRC-H2 설문 위저드
 *
 * 매주 월요일 실시. 분기 구조:
 *   인트로 → Q1~Q4 (핵심 4문항)
 *     └ 모두 '문제 없음' → 완료 (noProblem)
 *     └ 문제 있음 → Q5 유형
 *         ├ 부상 → Q6 부상 부위
 *         ├ 질병 → Q7 증상군 범주
 *         └ 정신 건강 → MH-1 ~ MH-6
 *       → "다른 건강 문제가 있으셨습니까?" → 예: 새 문제 반복 / 아니요: 제출
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { addOSTRCResponse, mondayOf, OSTRCProblem } from "@/store/studyStore";
import {
  OSTRC_INTRO,
  OSTRC_CORE,
  OSTRC_SCORES,
  OSTRC_Q5,
  OSTRC_BODY_AREAS,
  OSTRC_ILLNESS_CATEGORIES,
  OSTRC_MH1,
  OSTRC_MH2,
  OSTRC_MH3,
  OSTRC_MH4,
  OSTRC_MH5,
  OSTRC_MH6,
  OSTRC_MORE,
} from "@/data/ostrc";

type Step =
  | "intro"
  | "core0" | "core1" | "core2" | "core3"
  | "q5" | "q6" | "q7"
  | "mh1" | "mh2" | "mh3" | "mh4" | "mh5" | "mh6"
  | "more"
  | "done";

/** 작성 중인 문제 1건의 임시 상태 */
interface Draft {
  core: (number | null)[];
  type: "injury" | "illness" | "mental" | null;
  bodyArea: string | null;
  illnessCategory: string | null;
  mh1: string[];
  mh1Other: string;
  mh2: string;
  mh3: string;
  mh4: string[];
  mh4Other: string;
  mh5: string;
  mh6: number | null;
}

const emptyDraft = (): Draft => ({
  core: [null, null, null, null],
  type: null,
  bodyArea: null,
  illnessCategory: null,
  mh1: [],
  mh1Other: "",
  mh2: "",
  mh3: "",
  mh4: [],
  mh4Other: "",
  mh5: "",
  mh6: null,
});

function draftToProblem(d: Draft): OSTRCProblem {
  const [q1, q2, q3, q4] = d.core.map((v) => v ?? 0);
  return {
    q1, q2, q3, q4,
    severityScore:
      OSTRC_SCORES[q1] + OSTRC_SCORES[q2] + OSTRC_SCORES[q3] + OSTRC_SCORES[q4],
    type: d.type,
    bodyArea: d.type === "injury" ? d.bodyArea : null,
    illnessCategory: d.type === "illness" ? d.illnessCategory : null,
    mh:
      d.type === "mental"
        ? {
            mh1: d.mh1,
            mh1Other: d.mh1Other,
            mh2: d.mh2,
            mh3: d.mh3,
            mh4: d.mh4,
            mh4Other: d.mh4Other,
            mh5: d.mh5,
            mh6: d.mh6 ?? 0,
          }
        : null,
  };
}

// ─── 공용 UI 조각 ───────────────────────────────────────────

function OptionCard({
  selected,
  onClick,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  description?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={`w-full text-left px-4 py-3.5 rounded-2xl border-2 transition-colors
        ${selected ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}
    >
      <div className={`text-[15px] leading-snug ${selected ? "text-indigo-700 font-semibold" : "text-slate-700"}`}>
        {label}
      </div>
      {description && (
        <div className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</div>
      )}
    </motion.button>
  );
}

function CheckCard({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className={`w-full text-left px-4 py-3 rounded-xl border-2 flex items-start gap-2.5 transition-colors
        ${checked ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}
    >
      <span
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center text-[11px] font-bold
          ${checked ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300 text-transparent"}`}
      >
        ✓
      </span>
      <span className={`text-sm leading-snug ${checked ? "text-indigo-700" : "text-slate-700"}`}>
        {label}
      </span>
    </motion.button>
  );
}

function NextButton({ enabled, onClick, label = "다음" }: { enabled: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      className={`w-full py-4 rounded-2xl text-lg font-semibold text-white mt-6
        ${enabled ? "bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-200" : "bg-slate-300"}`}
    >
      {label}
    </button>
  );
}

// ─── 메인 페이지 ────────────────────────────────────────────

export default function OSTRCPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [history, setHistory] = useState<Step[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [problems, setProblems] = useState<OSTRCProblem[]>([]);
  const [moreAnswer, setMoreAnswer] = useState<string | null>(null);
  const [totalScore, setTotalScore] = useState(0);

  const problemNo = problems.length + 1;

  const go = (next: Step) => {
    setHistory((h) => [...h, step]);
    setStep(next);
  };

  const back = () => {
    if (history.length === 0) {
      router.push("/home");
      return;
    }
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setStep(prev);
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  /** Q4까지 응답 후 다음 단계 결정 */
  const afterCore = () => {
    const allNone = draft.core.every((v) => v === 0);
    if (allNone && problems.length === 0) {
      // 지난 7일간 건강 문제 전혀 없음 → 즉시 제출
      addOSTRCResponse({ weekKey: mondayOf(), noProblem: true, problems: [] });
      setTotalScore(0);
      setStep("done");
    } else {
      go("q5");
    }
  };

  /** 문제 1건 등록 완료 → 추가 문제 여부로 */
  const finishProblem = () => {
    go("more");
  };

  const submitAll = (finalProblems: OSTRCProblem[]) => {
    addOSTRCResponse({
      weekKey: mondayOf(),
      noProblem: false,
      problems: finalProblems,
    });
    setTotalScore(finalProblems.reduce((s, p) => Math.max(s, p.severityScore), 0));
    setStep("done");
  };

  const handleMore = (answer: string) => {
    setMoreAnswer(answer);
    const finished = [...problems, draftToProblem(draft)];
    if (answer === "예") {
      setProblems(finished);
      setDraft(emptyDraft());
      setMoreAnswer(null);
      setHistory([]);
      setStep("core0");
    } else {
      submitAll(finished);
    }
  };

  const coreIndex =
    step === "core0" ? 0 : step === "core1" ? 1 : step === "core2" ? 2 : step === "core3" ? 3 : -1;

  return (
    <div className="mobile-frame flex flex-col bg-gradient-to-b from-blue-50 to-indigo-50">
      {/* 헤더 */}
      {step !== "done" && (
        <div className="flex items-center gap-3 px-5 pt-8 pb-2 safe-top">
          <button onClick={back} className="text-slate-400 text-xl px-1">←</button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-800">주간 건강 설문 (OSTRC)</h1>
            <p className="text-[11px] text-slate-400">
              지난 7일 기준{problems.length > 0 || step !== "intro" ? ` · 건강 문제 ${problemNo}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* exit 애니메이션은 쓰지 않는다 — 탭이 백그라운드로 가면 rAF가 멈춰
          mode="wait"의 다음 스텝 마운트가 막힐 수 있음. entrance만 적용 */}
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18 }}
          className="flex flex-col flex-1 px-5 pb-8 pt-2 overflow-y-auto"
        >
          {/* ── 인트로 ── */}
          {step === "intro" && (
            <div className="flex flex-col flex-1">
              <div className="text-4xl mb-4 mt-2">📋</div>
              <div className="flex flex-col gap-3">
                {OSTRC_INTRO.map((p, i) => (
                  <p key={i} className="text-sm text-slate-600 leading-relaxed bg-white rounded-2xl p-4">
                    {p}
                  </p>
                ))}
              </div>
              <div className="flex-1" />
              <NextButton enabled onClick={() => go("core0")} label="시작하기" />
            </div>
          )}

          {/* ── Q1~Q4 ── */}
          {coreIndex >= 0 && (
            <div className="flex flex-col flex-1">
              <div className="flex gap-1.5 mb-4">
                {OSTRC_CORE.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${i <= coreIndex ? "bg-indigo-400" : "bg-slate-200"}`}
                  />
                ))}
              </div>
              <div className="text-base font-semibold text-slate-800 leading-snug mb-4">
                {OSTRC_CORE[coreIndex].text}
              </div>
              <div className="flex flex-col gap-2.5">
                {OSTRC_CORE[coreIndex].options.map((opt, i) => (
                  <OptionCard
                    key={i}
                    label={opt}
                    selected={draft.core[coreIndex] === i}
                    onClick={() => {
                      const core = [...draft.core];
                      core[coreIndex] = i;
                      patch({ core });
                    }}
                  />
                ))}
              </div>
              <div className="flex-1" />
              <NextButton
                enabled={draft.core[coreIndex] !== null}
                onClick={() => {
                  if (coreIndex < 3) go(`core${coreIndex + 1}` as Step);
                  else afterCore();
                }}
              />
            </div>
          )}

          {/* ── Q5. 문제 유형 ── */}
          {step === "q5" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-4">
                {OSTRC_Q5.text}
              </div>
              <div className="flex flex-col gap-2.5">
                {OSTRC_Q5.options.map((opt) => (
                  <OptionCard
                    key={opt.value}
                    label={opt.label}
                    description={opt.description}
                    selected={draft.type === opt.value}
                    onClick={() => patch({ type: opt.value })}
                  />
                ))}
              </div>
              <div className="flex-1" />
              <NextButton
                enabled={draft.type !== null}
                onClick={() => {
                  if (draft.type === "injury") go("q6");
                  else if (draft.type === "illness") go("q7");
                  else go("mh1");
                }}
              />
            </div>
          )}

          {/* ── Q6. 부상 부위 ── */}
          {step === "q6" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-4">
                부상을 입은 신체 부위 및 영역 범주
              </div>
              <div className="flex flex-col gap-2">
                {OSTRC_BODY_AREAS.map((area) => (
                  <OptionCard
                    key={area.label}
                    label={area.label}
                    description={area.description || undefined}
                    selected={draft.bodyArea === area.label}
                    onClick={() => patch({ bodyArea: area.label })}
                  />
                ))}
              </div>
              <NextButton enabled={draft.bodyArea !== null} onClick={finishProblem} />
            </div>
          )}

          {/* ── Q7. 질병 증상군 ── */}
          {step === "q7" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-4">
                질병 증상군의 범주
              </div>
              <div className="flex flex-col gap-2">
                {OSTRC_ILLNESS_CATEGORIES.map((cat) => (
                  <OptionCard
                    key={cat.label}
                    label={cat.label}
                    description={cat.description}
                    selected={draft.illnessCategory === cat.label}
                    onClick={() => patch({ illnessCategory: cat.label })}
                  />
                ))}
              </div>
              <NextButton enabled={draft.illnessCategory !== null} onClick={finishProblem} />
            </div>
          )}

          {/* ── MH-1 ── */}
          {step === "mh1" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-1">
                {OSTRC_MH1.text}
              </div>
              <p className="text-xs text-slate-400 mb-4">{OSTRC_MH1.subtext}</p>
              <div className="flex flex-col gap-2">
                {OSTRC_MH1.options.map((opt) => (
                  <CheckCard
                    key={opt}
                    label={opt}
                    checked={draft.mh1.includes(opt)}
                    onClick={() =>
                      patch({
                        mh1: draft.mh1.includes(opt)
                          ? draft.mh1.filter((o) => o !== opt)
                          : [...draft.mh1, opt],
                      })
                    }
                  />
                ))}
                <input
                  type="text"
                  value={draft.mh1Other}
                  onChange={(e) => patch({ mh1Other: e.target.value })}
                  placeholder="기타, 명시해 주십시오"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 bg-white text-sm
                    focus:border-indigo-400 focus:outline-none"
                />
              </div>
              <NextButton
                enabled={draft.mh1.length > 0 || draft.mh1Other.trim().length > 0}
                onClick={() => go("mh2")}
              />
            </div>
          )}

          {/* ── MH-2 ── */}
          {step === "mh2" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-4">
                {OSTRC_MH2.text}
              </div>
              <div className="flex flex-col gap-2.5">
                {OSTRC_MH2.options.map((opt) => (
                  <OptionCard
                    key={opt}
                    label={opt}
                    selected={draft.mh2 === opt}
                    onClick={() => patch({ mh2: opt })}
                  />
                ))}
              </div>
              <div className="flex-1" />
              <NextButton enabled={draft.mh2 !== ""} onClick={() => go("mh3")} />
            </div>
          )}

          {/* ── MH-3 ── */}
          {step === "mh3" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-1">
                {OSTRC_MH3.text}
              </div>
              <p className="text-xs text-slate-400 mb-4">{OSTRC_MH3.subtext}</p>
              <input
                type="text"
                value={draft.mh3}
                onChange={(e) => patch({ mh3: e.target.value })}
                placeholder="예: 2026-06-15 또는 2026년 6월경"
                className="w-full px-4 py-4 rounded-2xl border-2 border-slate-200 bg-white text-base
                  focus:border-indigo-400 focus:outline-none"
              />
              <div className="flex-1" />
              <NextButton enabled={draft.mh3.trim().length > 0} onClick={() => go("mh4")} />
            </div>
          )}

          {/* ── MH-4 ── */}
          {step === "mh4" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-1">
                {OSTRC_MH4.text}
              </div>
              <p className="text-xs text-slate-400 mb-4">{OSTRC_MH4.subtext}</p>
              <div className="flex flex-col gap-2">
                {OSTRC_MH4.options.map((opt) => (
                  <CheckCard
                    key={opt}
                    label={opt}
                    checked={draft.mh4.includes(opt)}
                    onClick={() =>
                      patch({
                        mh4: draft.mh4.includes(opt)
                          ? draft.mh4.filter((o) => o !== opt)
                          : [...draft.mh4, opt],
                      })
                    }
                  />
                ))}
                <input
                  type="text"
                  value={draft.mh4Other}
                  onChange={(e) => patch({ mh4Other: e.target.value })}
                  placeholder="기타, 명시해 주십시오"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 bg-white text-sm
                    focus:border-indigo-400 focus:outline-none"
                />
              </div>
              <NextButton
                enabled={draft.mh4.length > 0 || draft.mh4Other.trim().length > 0}
                onClick={() => go("mh5")}
              />
            </div>
          )}

          {/* ── MH-5 ── */}
          {step === "mh5" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-4">
                {OSTRC_MH5.text}
              </div>
              <div className="flex flex-col gap-2.5">
                {OSTRC_MH5.options.map((opt) => (
                  <OptionCard
                    key={opt}
                    label={opt}
                    selected={draft.mh5 === opt}
                    onClick={() => patch({ mh5: opt })}
                  />
                ))}
              </div>
              <div className="flex-1" />
              <NextButton enabled={draft.mh5 !== ""} onClick={() => go("mh6")} />
            </div>
          )}

          {/* ── MH-6 ── */}
          {step === "mh6" && (
            <div className="flex flex-col flex-1">
              <div className="text-base font-semibold text-slate-800 leading-snug mb-6">
                {OSTRC_MH6.text}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <motion.button
                    key={n}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => patch({ mh6: n })}
                    className={`py-4 rounded-2xl border-2 text-lg font-bold
                      ${draft.mh6 === n ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-slate-200 bg-white text-slate-600"}`}
                  >
                    {n}
                  </motion.button>
                ))}
              </div>
              <p className="text-center text-xs text-slate-400 mt-3">지난 7일 중 겪은 일수</p>
              <div className="flex-1" />
              <NextButton enabled={draft.mh6 !== null} onClick={finishProblem} />
            </div>
          )}

          {/* ── 다른 건강 문제 여부 ── */}
          {step === "more" && (
            <div className="flex flex-col flex-1">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-6 text-sm text-emerald-700">
                ✅ 건강 문제 {problemNo}건이 기록되었습니다.
              </div>
              <div className="text-base font-semibold text-slate-800 leading-snug mb-4">
                {OSTRC_MORE.text}
              </div>
              <div className="flex flex-col gap-2.5">
                {OSTRC_MORE.options.map((opt) => (
                  <OptionCard
                    key={opt}
                    label={opt}
                    selected={moreAnswer === opt}
                    onClick={() => handleMore(opt)}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-4 leading-relaxed">
                &lsquo;예&rsquo;를 선택하시면 다음 건강 문제에 대해 같은 문항이 반복됩니다.
              </p>
            </div>
          )}

          {/* ── 완료 ── */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center flex-1 text-center">
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260 }}
                className="text-7xl mb-6"
              >
                🎉
              </motion.div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">
                이번 주 설문 완료!
              </h2>
              <p className="text-sm text-slate-500 mb-8">
                {totalScore === 0
                  ? "지난 7일간 건강 문제 없이 잘 지내셨네요."
                  : "응답이 안전하게 기록되었습니다. 다음 주 월요일에 다시 만나요."}
              </p>
              <button
                onClick={() => router.push("/home")}
                className="w-full py-4 rounded-2xl text-lg font-semibold text-white
                  bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-indigo-200"
              >
                홈으로
              </button>
            </div>
          )}
        </motion.div>
    </div>
  );
}
