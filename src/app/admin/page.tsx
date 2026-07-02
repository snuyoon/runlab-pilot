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
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
            <div className="text-sm font-bold text-slate-600 mb-4">
              {selected} 상세 기록
              <span className="font-normal text-slate-400 ml-2">
                마지막 활동: {sel.lastActivity ? new Date(sel.lastActivity).toLocaleString("ko-KR") : "없음"}
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              {/* OSTRC */}
              <div className="md:col-span-2">
                <div className="text-xs font-bold text-slate-500 mb-2">주간 건강 설문 (OSTRC)</div>
                {sel.ostrcs.length === 0 ? (
                  <p className="text-xs text-slate-300">기록 없음</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead>
                        <tr className="text-slate-400 text-left">
                          <th className="py-1.5 pr-3">주 (월요일)</th>
                          <th className="pr-3">문제</th>
                          <th className="pr-3">심각도</th>
                          <th className="pr-3">중대</th>
                          <th className="pr-3">쉰 날</th>
                          <th className="pr-3">반복</th>
                          <th>Q1~Q4</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...sel.ostrcs]
                          .sort((a, b) => (a.weekKey < b.weekKey ? 1 : -1))
                          .flatMap((r) =>
                            r.noProblem || r.problems.length === 0
                              ? [
                                  <tr key={r.id} className="border-t border-slate-100">
                                    <td className="py-1.5 pr-3">{r.weekKey}</td>
                                    <td colSpan={6} className="text-emerald-500">문제 없음 (심각도 0)</td>
                                  </tr>,
                                ]
                              : r.problems.map((pr, i) => (
                                  <tr key={r.id + i} className="border-t border-slate-100">
                                    <td className="py-1.5 pr-3">{i === 0 ? r.weekKey : ""}</td>
                                    <td className="pr-3 font-semibold text-slate-700">{pr.label}</td>
                                    <td className="pr-3">
                                      <span className={pr.severityScore >= 50 ? "text-red-500 font-bold" : ""}>
                                        {pr.severityScore}
                                      </span>
                                      /100
                                    </td>
                                    <td className="pr-3">{pr.substantial ? "⚠️ 예" : "아니요"}</td>
                                    <td className="pr-3">{pr.timeLossDays ?? "—"}일</td>
                                    <td className="pr-3">{pr.recurrenceOfId ? "🔁 지속" : "신규"}</td>
                                    <td className="text-slate-400">
                                      {pr.q1 + 1}
                                      {pr.q2 !== null ? `·${pr.q2 + 1}·${pr.q3! + 1}·${pr.q4! + 1}` : " (게이트키퍼: 참여불가)"}
                                    </td>
                                  </tr>
                                ))
                          )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* EMA */}
              <div>
                <div className="text-xs font-bold text-slate-500 mb-2">기상 설문 (최근 14건)</div>
                {sel.emas.length === 0 ? (
                  <p className="text-xs text-slate-300">기록 없음</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="py-1.5">날짜</th>
                        <th>수면질</th>
                        <th>피로</th>
                        <th>기분</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...sel.emas]
                        .sort((a, b) => (a.date < b.date ? 1 : -1))
                        .slice(0, 14)
                        .map((e) => (
                          <tr key={e.id} className="border-t border-slate-100">
                            <td className="py-1.5">{e.date}</td>
                            <td>{e.sleepQuality}/5</td>
                            <td>{e.fatigue}/5</td>
                            <td>{e.mood}/5</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* RPE */}
              <div>
                <div className="text-xs font-bold text-slate-500 mb-2">러닝 세션 RPE (최근 14건)</div>
                {sel.rpes.length === 0 ? (
                  <p className="text-xs text-slate-300">기록 없음</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="py-1.5">날짜</th>
                        <th>RPE</th>
                        <th>메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...sel.rpes]
                        .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
                        .slice(0, 14)
                        .map((s2) => (
                          <tr key={s2.id} className="border-t border-slate-100">
                            <td className="py-1.5">{s2.date}</td>
                            <td className="font-bold text-orange-500">{s2.rpe}</td>
                            <td className="text-slate-400">{s2.note}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
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
                  <button onClick={() => deactivate(p.code)} className="text-red-300 hover:text-red-500 ml-0.5">
                    ✕
                  </button>
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
