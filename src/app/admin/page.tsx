"use client";

/**
 * /admin — 연구자(관리자) 대시보드
 *
 * ADMIN_KEY로 보호. PC 화면 기준 레이아웃.
 *  - 참여자 × 최근 14일 컴플라이언스 격자 (기상 EMA / RPE / 주간 OSTRC)
 *  - 참여자별 응답 상세 (OSTRC 심각도·substantial·시간손실 포함)
 *  - 이번 주 유병률 등 요약 지표, 미응답자 하이라이트
 *  - 참여자 코드 등록/비활성화, 전체 CSV 다운로드
 */

import { useCallback, useEffect, useState } from "react";
import {
  WakeEMA,
  SessionRPE,
  OSTRCResponse,
  SleepLog,
  todayStr,
  mondayOf,
} from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";

const KEY_STORAGE = "runlab-admin-key";

interface Participant {
  code: string;
  label: string;
  active: boolean;
  created_at: string;
}

interface RecordRow {
  client_id: string;
  participant_code: string;
  kind: "wake_ema" | "session_rpe" | "ostrc" | "sleep_log";
  date: string;
  completed_at: string | null;
  payload: unknown;
  received_at: string;
}

interface AdminData {
  participants: Participant[];
  records: RecordRow[];
}

// ─── 날짜 유틸 ──────────────────────────────────────────────

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const c = new Date(d);
    c.setDate(d.getDate() - i);
    out.push(todayStr(c));
  }
  return out;
}

function dayLabel(ds: string): string {
  const d = new Date(ds + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── 참여자별 집계 ──────────────────────────────────────────

interface ParticipantStats {
  emaDates: Set<string>;
  rpeByDate: Map<string, SessionRPE[]>;
  ostrcByWeek: Map<string, OSTRCResponse>;
  sleepLogs: SleepLog[];
  emas: WakeEMA[];
  rpes: SessionRPE[];
  ostrcs: OSTRCResponse[];
  lastActivity: string | null;
  missedEMADays: number; // 어제부터 거꾸로 연속 미응답 일수
}

function computeStats(records: RecordRow[]): Map<string, ParticipantStats> {
  const map = new Map<string, ParticipantStats>();
  const ensure = (code: string): ParticipantStats => {
    let s = map.get(code);
    if (!s) {
      s = {
        emaDates: new Set(),
        rpeByDate: new Map(),
        ostrcByWeek: new Map(),
        sleepLogs: [],
        emas: [],
        rpes: [],
        ostrcs: [],
        lastActivity: null,
        missedEMADays: 0,
      };
      map.set(code, s);
    }
    return s;
  };

  for (const r of records) {
    const s = ensure(r.participant_code);
    if (r.completed_at && (!s.lastActivity || r.completed_at > s.lastActivity)) {
      s.lastActivity = r.completed_at;
    }
    if (r.kind === "wake_ema") {
      const p = r.payload as WakeEMA;
      s.emaDates.add(p.date);
      s.emas.push(p);
    } else if (r.kind === "session_rpe") {
      const p = r.payload as SessionRPE;
      const arr = s.rpeByDate.get(p.date) ?? [];
      arr.push(p);
      s.rpeByDate.set(p.date, arr);
      s.rpes.push(p);
    } else if (r.kind === "ostrc") {
      const p = r.payload as OSTRCResponse;
      // 같은 주에 응답이 여러 건이면 가장 최근 것을 대표로
      const existing = s.ostrcByWeek.get(p.weekKey);
      if (!existing || p.completedAt > existing.completedAt) {
        s.ostrcByWeek.set(p.weekKey, p);
      }
      s.ostrcs.push(p);
    } else if (r.kind === "sleep_log") {
      s.sleepLogs.push(r.payload as SleepLog);
    }
  }

  // 연속 미응답 일수 — 오늘 완료했으면 0, 아니면 어제부터 거꾸로 계산
  for (const s of map.values()) {
    if (s.emaDates.has(todayStr())) {
      s.missedEMADays = 0;
      continue;
    }
    let missed = 0;
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - 1);
    while (missed < 30 && !s.emaDates.has(todayStr(cursor))) {
      missed++;
      cursor.setDate(cursor.getDate() - 1);
    }
    s.missedEMADays = missed;
  }
  return map;
}

// ─── CSV (전체 참여자) ──────────────────────────────────────

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCSV(records: RecordRow[]): string {
  const lines: string[] = [];

  lines.push("== wake_ema ==");
  lines.push("participant,date,sleep_quality,fatigue,mood,completed_at");
  for (const r of records.filter((r) => r.kind === "wake_ema")) {
    const p = r.payload as WakeEMA;
    lines.push([r.participant_code, p.date, p.sleepQuality, p.fatigue, p.mood, p.completedAt].map(csvEscape).join(","));
  }

  lines.push("");
  lines.push("== session_rpe ==");
  lines.push("participant,date,rpe,note,completed_at");
  for (const r of records.filter((r) => r.kind === "session_rpe")) {
    const p = r.payload as SessionRPE;
    lines.push([r.participant_code, p.date, p.rpe, p.note, p.completedAt].map(csvEscape).join(","));
  }

  lines.push("");
  lines.push("== ostrc ==");
  lines.push(
    "participant,week_monday,problem_index,problem_id,recurrence_of,q1,q2,q3,q4,severity_score,substantial,type,body_area,illness_category,time_loss_days,mh1,mh2,mh3,mh4,mh5,mh6,completed_at"
  );
  for (const r of records.filter((r) => r.kind === "ostrc")) {
    const res = r.payload as OSTRCResponse;
    if (res.problems.length === 0) {
      lines.push([r.participant_code, res.weekKey, 0, "", "", 0, 0, 0, 0, 0, false, "none", "", "", "", "", "", "", "", "", "", res.completedAt].map(csvEscape).join(","));
    }
    res.problems.forEach((p, i) => {
      lines.push(
        [
          r.participant_code, res.weekKey, i + 1, p.id, p.recurrenceOfId ?? "",
          p.q1, p.q2 ?? "", p.q3 ?? "", p.q4 ?? "", p.severityScore, p.substantial,
          p.type ?? "", p.bodyArea ?? "", p.illnessCategory ?? "", p.timeLossDays ?? "",
          p.mh ? p.mh.mh1.join("; ") + (p.mh.mh1Other ? `; 기타: ${p.mh.mh1Other}` : "") : "",
          p.mh?.mh2 ?? "", p.mh?.mh3 ?? "",
          p.mh ? p.mh.mh4.join("; ") + (p.mh.mh4Other ? `; 기타: ${p.mh.mh4Other}` : "") : "",
          p.mh?.mh5 ?? "", p.mh?.mh6 ?? "",
          res.completedAt,
        ].map(csvEscape).join(",")
      );
    });
  }

  lines.push("");
  lines.push("== sleep_log ==");
  lines.push("participant,date,bedtime_at,alarm_dismissed_at");
  for (const r of records.filter((r) => r.kind === "sleep_log")) {
    const p = r.payload as SleepLog;
    lines.push([r.participant_code, p.date, p.bedtimeAt, p.alarmDismissedAt ?? ""].map(csvEscape).join(","));
  }

  return lines.join("\n");
}

// ─── 상세 보기 표시 유틸 ────────────────────────────────────

/** 1~10 응답값 색상 (낮을수록 나쁨 기준) */
function chip10(v: number): string {
  if (v <= 4) return "bg-red-100 text-red-600";
  if (v <= 6) return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

/** RPE 1~10 색상 */
function chipRPE(v: number): string {
  if (v <= 3) return "bg-emerald-100 text-emerald-700";
  if (v <= 5) return "bg-amber-100 text-amber-700";
  if (v <= 7) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

function severityColor(score: number): string {
  if (score >= 50) return "bg-red-400";
  if (score >= 20) return "bg-amber-400";
  return "bg-emerald-400";
}

function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function sleepDuration(l: SleepLog): string {
  if (!l.alarmDismissedAt) return "—";
  const ms = new Date(l.alarmDismissedAt).getTime() - new Date(l.bedtimeAt).getTime();
  if (ms <= 0 || ms > 24 * 3600000) return "—";
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}시간 ${m}분`;
}

/** OSTRC Q1 응답 요약 라벨 */
const Q1_SHORT = ["문제 없음", "문제 있으나 완전 참여", "참여 감소", "참여 불가"];
const DEGREE_SHORT = ["없음", "작음", "보통", "큼"];

function coreSummary(p: OSTRCResponse["problems"][number]): string {
  if (p.q2 === null) return `참여: ${Q1_SHORT[p.q1]} → Q2~Q4 자동 스킵 (게이트키퍼)`;
  return `참여: ${Q1_SHORT[p.q1]} · 훈련수정: ${DEGREE_SHORT[p.q2]} · 경기력영향: ${DEGREE_SHORT[p.q3 ?? 0]} · 증상: ${DEGREE_SHORT[p.q4 ?? 0]}`;
}

// ─── 페이지 ─────────────────────────────────────────────────

export default function AdminPage() {
  const mounted = useMounted();
  if (!mounted) return <div className="min-h-dvh bg-slate-100" />;
  return <AdminInner />;
}

function AdminInner() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const fetchData = useCallback(async (k: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/data", { headers: { "x-admin-key": k } });
      if (res.status === 401) {
        setError("관리자 키가 올바르지 않습니다");
        localStorage.removeItem(KEY_STORAGE);
        setKey("");
        return;
      }
      if (!res.ok) throw new Error("server");
      const json = (await res.json()) as AdminData;
      setData(json);
      localStorage.setItem(KEY_STORAGE, k);
    } catch {
      setError("데이터를 불러오지 못했습니다. 네트워크를 확인해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (key) void fetchData(key);
  }, [key, fetchData]);

  // ── 키 입력 화면 ──
  if (!key) {
    return (
      <div className="min-h-dvh bg-slate-100 flex items-center justify-center px-6">
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-sm">
          <div className="text-3xl mb-3">🔐</div>
          <h1 className="text-xl font-bold text-slate-800 mb-1">RunLab 관리자</h1>
          <p className="text-xs text-slate-400 mb-6">연구자용 대시보드입니다. 관리자 키를 입력하세요.</p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && keyInput && setKey(keyInput)}
            placeholder="관리자 키"
            className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 mb-3
              focus:border-indigo-400 focus:outline-none"
          />
          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
          <button
            onClick={() => keyInput && setKey(keyInput)}
            className="w-full py-3 rounded-xl bg-indigo-500 text-white font-semibold"
          >
            들어가기
          </button>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-dvh bg-slate-100 flex items-center justify-center text-slate-400">
        불러오는 중...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-dvh bg-slate-100 flex flex-col items-center justify-center gap-4 text-slate-500">
        <p>{error || "데이터가 없습니다"}</p>
        <button onClick={() => fetchData(key)} className="px-4 py-2 rounded-xl bg-white border">
          다시 시도
        </button>
      </div>
    );
  }

  // ── 집계 ──
  const stats = computeStats(data.records);
  const days = lastNDays(14);
  const today = todayStr();
  const week = mondayOf();
  const activeParticipants = data.participants.filter((p) => p.active);

  const emaToday = activeParticipants.filter((p) => stats.get(p.code)?.emaDates.has(today)).length;
  const ostrcThisWeek = activeParticipants.filter((p) => stats.get(p.code)?.ostrcByWeek.has(week));
  const weekReporters = ostrcThisWeek.filter(
    (p) => (stats.get(p.code)?.ostrcByWeek.get(week)?.problems.length ?? 0) > 0
  );
  const substantialThisWeek = ostrcThisWeek.flatMap(
    (p) => stats.get(p.code)?.ostrcByWeek.get(week)?.problems.filter((pr) => pr.substantial) ?? []
  );

  const addParticipant = async () => {
    if (newCode.trim().length < 2) return;
    await fetch("/api/admin/participants", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({ code: newCode, label: newLabel }),
    });
    setNewCode("");
    setNewLabel("");
    void fetchData(key);
  };

  const deactivate = async (code: string) => {
    if (!confirm(`${code} 참여자를 비활성화할까요? (데이터는 보존, 로그인만 차단)`)) return;
    await fetch(`/api/admin/participants?code=${encodeURIComponent(code)}`, {
      method: "DELETE",
      headers: { "x-admin-key": key },
    });
    void fetchData(key);
  };

  const resetParticipant = async (code: string) => {
    if (
      !confirm(
        `${code} 참여자를 초기화할까요?\n\n· 서버에 저장된 이 참여자의 응답이 모두 삭제됩니다\n· 참여자가 다음에 앱을 열면 기기의 기록도 자동 초기화됩니다 (로그인·알람 설정은 유지)`
      )
    )
      return;
    await fetch("/api/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({ code }),
    });
    setSelected(null);
    void fetchData(key);
  };

  const downloadCSV = () => {
    const blob = new Blob(["﻿" + buildCSV(data.records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runlab-all-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sel = selected ? stats.get(selected) : null;

  return (
    <div className="min-h-dvh bg-slate-100 px-6 py-8">
      <div className="max-w-6xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              RunLab 관리자 <span className="text-indigo-500 text-sm align-top">PILOT</span>
            </h1>
            <p className="text-xs text-slate-400">
              {today} · 활성 참여자 {activeParticipants.length}명 · 수집 레코드 {data.records.length}건
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fetchData(key)}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-600"
            >
              🔄 새로고침
            </button>
            <button
              onClick={downloadCSV}
              className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-semibold"
            >
              ⬇️ 전체 CSV
            </button>
          </div>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-400 mb-1">오늘 기상 설문</div>
            <div className="text-2xl font-bold text-slate-800">
              {emaToday}<span className="text-sm text-slate-400">/{activeParticipants.length}</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-400 mb-1">이번 주 OSTRC 완료</div>
            <div className="text-2xl font-bold text-slate-800">
              {ostrcThisWeek.length}<span className="text-sm text-slate-400">/{activeParticipants.length}</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-400 mb-1">주간 유병률 (문제 보고자)</div>
            <div className="text-2xl font-bold text-slate-800">
              {ostrcThisWeek.length > 0
                ? `${Math.round((weekReporters.length / ostrcThisWeek.length) * 100)}%`
                : "—"}
              <span className="text-sm text-slate-400">
                {" "}({weekReporters.length}/{ostrcThisWeek.length})
              </span>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-400 mb-1">이번 주 중대한 문제</div>
            <div className={`text-2xl font-bold ${substantialThisWeek.length > 0 ? "text-red-500" : "text-slate-800"}`}>
              {substantialThisWeek.length}건
            </div>
          </div>
        </div>

        {/* 컴플라이언스 격자 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-6 overflow-x-auto">
          <div className="text-sm font-bold text-slate-600 mb-3">
            최근 14일 컴플라이언스 <span className="font-normal text-slate-400">(✅ 기상 설문 · 숫자 = RPE 세션 수)</span>
          </div>
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-slate-400 text-xs">
                <th className="text-left py-2 pr-3 font-semibold">참여자</th>
                {days.map((d) => (
                  <th key={d} className={`px-1 font-normal ${d === today ? "text-indigo-500 font-bold" : ""}`}>
                    {dayLabel(d)}
                  </th>
                ))}
                <th className="px-2 font-semibold">이번 주<br />OSTRC</th>
                <th className="px-2 font-semibold">상세</th>
              </tr>
            </thead>
            <tbody>
              {activeParticipants.map((p) => {
                const s = stats.get(p.code);
                const ostrc = s?.ostrcByWeek.get(week);
                const behind = (s?.missedEMADays ?? 99) >= 2;
                return (
                  <tr key={p.code} className="border-t border-slate-100">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="font-mono font-semibold text-slate-700">{p.code}</span>
                      {p.label && <span className="text-xs text-slate-400 ml-1.5">{p.label}</span>}
                      {behind && (
                        <span className="ml-1.5 text-[10px] bg-red-100 text-red-500 font-bold px-1.5 py-0.5 rounded-full">
                          {s ? `${s.missedEMADays}일 미응답` : "기록 없음"}
                        </span>
                      )}
                    </td>
                    {days.map((d) => {
                      const ema = s?.emaDates.has(d);
                      const rpeCount = s?.rpeByDate.get(d)?.length ?? 0;
                      return (
                        <td key={d} className="text-center px-1 py-2">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={ema ? "" : "opacity-20"}>{ema ? "✅" : "·"}</span>
                            {rpeCount > 0 && (
                              <span className="text-[10px] bg-orange-100 text-orange-600 font-bold px-1 rounded">
                                {rpeCount}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="text-center px-2">
                      {ostrc ? (
                        ostrc.noProblem ? (
                          <span className="text-emerald-500 text-xs font-semibold">✅ 문제없음</span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-700">
                            문제 {ostrc.problems.length}건
                            {ostrc.problems.some((pr) => pr.substantial) && (
                              <span className="text-red-500 ml-1">⚠️</span>
                            )}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-300 text-xs">미완료</span>
                      )}
                    </td>
                    <td className="text-center px-2">
                      <button
                        onClick={() => setSelected(selected === p.code ? null : p.code)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-semibold
                          ${selected === p.code ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600"}`}
                      >
                        {selected === p.code ? "닫기" : "보기"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 참여자 상세 */}
        {selected && sel && (
          <div className="bg-white rounded-2xl shadow-sm mb-6 overflow-hidden">
            {/* 상세 헤더 */}
            <div className="bg-slate-800 text-white px-6 py-4 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="font-mono font-bold text-lg">
                  {selected}
                  <span className="font-sans font-normal text-sm text-slate-300 ml-2">
                    {data.participants.find((p) => p.code === selected)?.label}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  마지막 활동: {fmtDateTime(sel.lastActivity)}
                </div>
              </div>
              <div className="flex gap-4 text-center">
                {[
                  ["☀️ 기상 설문", `${sel.emas.length}회`],
                  ["🏃 러닝 세션", `${sel.rpes.length}회`],
                  ["📋 주간 설문", `${sel.ostrcs.length}주`],
                  ["🌙 수면 기록", `${sel.sleepLogs.length}회`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-lg font-bold">{value}</div>
                    <div className="text-[10px] text-slate-400">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 flex flex-col gap-8">
              {/* ── OSTRC — 주별 카드 ── */}
              <section>
                <h3 className="text-sm font-bold text-slate-700 mb-3">📋 주간 건강 설문 (OSTRC)</h3>
                {sel.ostrcs.length === 0 ? (
                  <p className="text-sm text-slate-300">기록 없음</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {[...sel.ostrcs]
                      .sort((a, b) =>
                        a.weekKey !== b.weekKey
                          ? a.weekKey < b.weekKey ? 1 : -1
                          : a.completedAt < b.completedAt ? 1 : -1
                      )
                      .map((r) => (
                        <div key={r.id} className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-700">
                              {r.weekKey} 주
                            </span>
                            <span className="text-xs text-slate-400">
                              응답 {fmtDateTime(r.completedAt)}
                            </span>
                          </div>
                          {r.noProblem || r.problems.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-emerald-600 font-semibold">
                              ✅ 건강 문제 없음 · 심각도 0/100
                            </div>
                          ) : (
                            r.problems.map((pr, i) => (
                              <div
                                key={r.id + i}
                                className={`px-4 py-3 ${i > 0 ? "border-t border-slate-100" : ""}`}
                              >
                                <div className="flex items-center gap-2 flex-wrap mb-2">
                                  <span className="text-sm font-bold text-slate-800">{pr.label}</span>
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                                      ${pr.recurrenceOfId ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"}`}
                                  >
                                    {pr.recurrenceOfId ? "🔁 지속 중인 문제" : "신규"}
                                  </span>
                                  {pr.substantial && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                                      ⚠️ 중대한 문제
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mb-1.5">
                                  <span className="text-xs text-slate-500 w-14 shrink-0">심각도</span>
                                  <div className="flex-1 max-w-[240px] h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${severityColor(pr.severityScore)}`}
                                      style={{ width: `${pr.severityScore}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-bold text-slate-700 w-16">
                                    {pr.severityScore}<span className="text-xs font-normal text-slate-400">/100</span>
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    훈련 쉰 날 <strong className="text-slate-700">{pr.timeLossDays ?? "—"}</strong>일
                                  </span>
                                </div>
                                <div className="text-xs text-slate-400">{coreSummary(pr)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </section>

              {/* ── EMA + RPE ── */}
              <div className="grid lg:grid-cols-2 gap-8">
                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                    ☀️ 기상 설문 <span className="font-normal text-slate-400">(최근 14일 · 1~10점)</span>
                  </h3>
                  {sel.emas.length === 0 ? (
                    <p className="text-sm text-slate-300">기록 없음</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 text-xs text-left border-b border-slate-200">
                          <th className="py-2 font-semibold">날짜</th>
                          <th className="font-semibold text-center">수면질</th>
                          <th className="font-semibold text-center">피로/근육통</th>
                          <th className="font-semibold text-center">기분</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...sel.emas]
                          .sort((a, b) => (a.date < b.date ? 1 : -1))
                          .slice(0, 14)
                          .map((e, i) => (
                            <tr key={e.id} className={i % 2 === 1 ? "bg-slate-50" : ""}>
                              <td className="py-2 text-slate-600">{e.date.slice(5).replace("-", "/")}</td>
                              {[e.sleepQuality, e.fatigue, e.mood].map((v, j) => (
                                <td key={j} className="text-center py-1.5">
                                  <span className={`inline-block w-8 py-0.5 rounded-lg text-xs font-bold ${chip10(v)}`}>
                                    {v}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                    🏃 러닝 세션 RPE <span className="font-normal text-slate-400">(최근 14건 · 1~10점)</span>
                  </h3>
                  {sel.rpes.length === 0 ? (
                    <p className="text-sm text-slate-300">기록 없음</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 text-xs text-left border-b border-slate-200">
                          <th className="py-2 font-semibold">날짜</th>
                          <th className="font-semibold text-center">RPE</th>
                          <th className="font-semibold">메모</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...sel.rpes]
                          .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
                          .slice(0, 14)
                          .map((s2, i) => (
                            <tr key={s2.id} className={i % 2 === 1 ? "bg-slate-50" : ""}>
                              <td className="py-2 text-slate-600">{s2.date.slice(5).replace("-", "/")}</td>
                              <td className="text-center py-1.5">
                                <span className={`inline-block w-8 py-0.5 rounded-lg text-xs font-bold ${chipRPE(s2.rpe)}`}>
                                  {s2.rpe}
                                </span>
                              </td>
                              <td className="text-slate-500 text-xs">{s2.note || "—"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>

              {/* ── 수면 로그 ── */}
              <section>
                <h3 className="text-sm font-bold text-slate-700 mb-3">
                  🌙 수면 기록 <span className="font-normal text-slate-400">(최근 14건 · 취침 버튼~알람 해제)</span>
                </h3>
                {sel.sleepLogs.length === 0 ? (
                  <p className="text-sm text-slate-300">기록 없음</p>
                ) : (
                  <table className="w-full text-sm max-w-xl">
                    <thead>
                      <tr className="text-slate-400 text-xs text-left border-b border-slate-200">
                        <th className="py-2 font-semibold">기상 날짜</th>
                        <th className="font-semibold">취침</th>
                        <th className="font-semibold">알람 해제</th>
                        <th className="font-semibold">누운 시간</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...sel.sleepLogs]
                        .sort((a, b) => (a.bedtimeAt < b.bedtimeAt ? 1 : -1))
                        .slice(0, 14)
                        .map((l, i) => (
                          <tr key={l.id} className={i % 2 === 1 ? "bg-slate-50" : ""}>
                            <td className="py-2 text-slate-600">{l.date.slice(5).replace("-", "/")}</td>
                            <td className="text-slate-600">{fmtClock(l.bedtimeAt)}</td>
                            <td className="text-slate-600">{fmtClock(l.alarmDismissedAt)}</td>
                            <td className="font-semibold text-slate-700">{sleepDuration(l)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </div>
        )}

        {/* 참여자 관리 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="text-sm font-bold text-slate-600 mb-3">참여자 코드 관리</div>
          <div className="flex gap-2 mb-4 flex-wrap">
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              placeholder="코드 (예: SNU-011)"
              className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-mono w-44
                focus:border-indigo-400 focus:outline-none"
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="메모 (예: 참여자 11)"
              className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm w-44
                focus:border-indigo-400 focus:outline-none"
            />
            <button
              onClick={addParticipant}
              className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-semibold"
            >
              ＋ 등록
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.participants.map((p) => (
              <span
                key={p.code}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border
                  ${p.active ? "bg-slate-50 border-slate-200 text-slate-600" : "bg-slate-100 border-slate-200 text-slate-300 line-through"}`}
              >
                <span className="font-mono font-semibold">{p.code}</span>
                {p.label && <span className="text-slate-400">{p.label}</span>}
                {p.active && (
                  <>
                    <button
                      onClick={() => resetParticipant(p.code)}
                      title="기록 초기화 (서버 + 기기)"
                      className="text-slate-300 hover:text-indigo-500 ml-0.5"
                    >
                      ↺
                    </button>
                    <button
                      onClick={() => deactivate(p.code)}
                      title="비활성화"
                      className="text-red-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </>
                )}
              </span>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-slate-300 mt-6">
          RunLab Pilot 관리자 대시보드 · 데이터는 Neon Postgres에 저장됩니다
        </p>
      </div>
    </div>
  );
}
