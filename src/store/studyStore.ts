"use client";

/**
 * studyStore.ts — RunLab 파일럿 연구 데이터 저장소
 *
 * 파일럿(약 10명) 단계에서는 localStorage에 참여자 기기 단위로 저장하고,
 * 대시보드에서 JSON/CSV로 내보내 수거합니다.
 * 모든 읽기/쓰기가 이 파일을 거치므로, 이후 서버(DB) 연동 시
 * 이 파일의 함수 내부만 교체하면 됩니다.
 */

// ─── 타입 정의 ─────────────────────────────────────────────

/** 참여자 및 알람 설정 */
export interface StudySettings {
  participantCode: string; // 연구 참여 코드 (예: SNU-001)
  enrolledAt: string; // 최초 로그인 시각 (ISO)
  alarmHour: number; // 기상 알람 — 시
  alarmMinute: number; // 기상 알람 — 분
  bedtimeHour: number; // 취침 리마인더 — 시
  bedtimeMinute: number; // 취침 리마인더 — 분
}

/** 기상 직후 EMA 응답 (1~5점) */
export interface WakeEMA {
  id: string;
  date: string; // 응답한 아침 날짜 (YYYY-MM-DD)
  sleepQuality: number; // 어젯밤 수면의 질
  fatigue: number; // 근육통/피로감
  mood: number; // 오늘의 기분
  completedAt: string; // ISO
}

/** 러닝 세션 강도(RPE) 응답 */
export interface SessionRPE {
  id: string;
  date: string; // 세션 날짜 (YYYY-MM-DD)
  rpe: number; // 세션 RPE 1~10
  durationMin: number | null; // 러닝 시간(분), 선택 입력
  note: string; // 메모, 선택 입력
  completedAt: string; // ISO
}

/** OSTRC-H2 — 건강 문제 1건에 대한 응답 */
export interface OSTRCProblem {
  /** Q1~Q4 선택 인덱스(0~3). 심각도 점수는 0/8/17/25로 환산 */
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  severityScore: number; // Q1~Q4 환산 합계 (0~100)
  type: "injury" | "illness" | "mental" | null; // Q5
  bodyArea: string | null; // Q6 (부상일 때)
  illnessCategory: string | null; // Q7 (질병일 때)
  mh: {
    mh1: string[]; // 경험한 정신 건강 문제 (복수)
    mh1Other: string;
    mh2: string; // 신규/악화/재발/만성
    mh3: string; // 발생 시기
    mh4: string[]; // 원인/기여 요인 (복수)
    mh4Other: string;
    mh5: string; // 의료인 방문 여부
    mh6: number; // 지난 7일 중 겪은 일수 (0~7)
  } | null;
}

/** OSTRC-H2 주간 응답 (매주 월요일) */
export interface OSTRCResponse {
  id: string;
  weekKey: string; // 해당 주 월요일 날짜 (YYYY-MM-DD)
  noProblem: boolean; // Q1~Q4 모두 '문제 없음'이면 true
  problems: OSTRCProblem[]; // 등록한 건강 문제 목록 (없으면 빈 배열)
  completedAt: string; // ISO
}

/** 수면 세션 로그 (취침 버튼 ~ 알람 해제) */
export interface SleepLog {
  id: string;
  date: string; // 기상 기준 날짜 (YYYY-MM-DD)
  bedtimeAt: string; // 취침 시작 시각 (ISO)
  alarmDismissedAt: string | null; // 알람 해제 시각 (ISO)
}

/** 저장소 전체 구조 */
export interface StudyData {
  settings: StudySettings;
  wakeEMAs: WakeEMA[];
  sessionRPEs: SessionRPE[];
  ostrcResponses: OSTRCResponse[];
  sleepLogs: SleepLog[];
}

// ─── 저장소 기본 ────────────────────────────────────────────

const STORAGE_KEY = "runlab-pilot-v1";

const defaultData: StudyData = {
  settings: {
    participantCode: "",
    enrolledAt: "",
    alarmHour: 7,
    alarmMinute: 0,
    bedtimeHour: 23,
    bedtimeMinute: 0,
  },
  wakeEMAs: [],
  sessionRPEs: [],
  ostrcResponses: [],
  sleepLogs: [],
};

export function loadData(): StudyData {
  if (typeof window === "undefined") return defaultData;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...defaultData,
        ...parsed,
        settings: { ...defaultData.settings, ...parsed.settings },
      };
    }
  } catch {}
  return defaultData;
}

function persist(data: StudyData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function saveSettings(patch: Partial<StudySettings>) {
  const data = loadData();
  data.settings = { ...data.settings, ...patch };
  persist(data);
}

export function resetAll() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 기록 추가 ──────────────────────────────────────────────

export function addWakeEMA(entry: Omit<WakeEMA, "id" | "completedAt">) {
  const data = loadData();
  data.wakeEMAs.push({ ...entry, id: makeId(), completedAt: new Date().toISOString() });
  persist(data);
}

export function addSessionRPE(entry: Omit<SessionRPE, "id" | "completedAt">) {
  const data = loadData();
  data.sessionRPEs.push({ ...entry, id: makeId(), completedAt: new Date().toISOString() });
  persist(data);
}

export function addOSTRCResponse(entry: Omit<OSTRCResponse, "id" | "completedAt">) {
  const data = loadData();
  data.ostrcResponses.push({ ...entry, id: makeId(), completedAt: new Date().toISOString() });
  persist(data);
}

export function startSleepLog(): string {
  const data = loadData();
  const id = makeId();
  data.sleepLogs.push({
    id,
    date: todayStr(),
    bedtimeAt: new Date().toISOString(),
    alarmDismissedAt: null,
  });
  persist(data);
  return id;
}

/** 알람 해제 시각 기록. 기상 날짜 기준으로 date도 갱신 */
export function finishSleepLog(id: string) {
  const data = loadData();
  const log = data.sleepLogs.find((l) => l.id === id);
  if (log) {
    log.alarmDismissedAt = new Date().toISOString();
    log.date = todayStr();
    persist(data);
  }
}

// ─── 날짜 유틸 ──────────────────────────────────────────────

/** 로컬 기준 YYYY-MM-DD */
export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 해당 날짜가 속한 주의 월요일 (YYYY-MM-DD) */
export function mondayOf(d: Date = new Date()): string {
  const copy = new Date(d);
  const day = copy.getDay(); // 0=일 ~ 6=토
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return todayStr(copy);
}

// ─── 오늘 할 일 판정 ────────────────────────────────────────

/** 오늘 기상 EMA를 아직 안 했는가 */
export function isWakeEMADue(data: StudyData = loadData()): boolean {
  const today = todayStr();
  return !data.wakeEMAs.some((e) => e.date === today);
}

/**
 * 이번 주(월요일 시작) OSTRC를 아직 안 했는가.
 * 매주 월요일부터 완료 전까지 계속 due 상태로 남아 팝업이 뜬다.
 */
export function isOSTRCDue(data: StudyData = loadData()): boolean {
  const week = mondayOf();
  return !data.ostrcResponses.some((r) => r.weekKey === week);
}

/** 오늘이 월요일인가 (OSTRC 정규 실시일) */
export function isMonday(d: Date = new Date()): boolean {
  return d.getDay() === 1;
}

/** 연속 기상 EMA 완료 일수 (오늘 포함, 어제부터 거꾸로 계산) */
export function emaStreak(data: StudyData = loadData()): number {
  const dates = new Set(data.wakeEMAs.map((e) => e.date));
  let streak = 0;
  const cursor = new Date();
  if (!dates.has(todayStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dates.has(todayStr(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ─── 데이터 내보내기 ────────────────────────────────────────

/** 전체 데이터를 JSON 문자열로 */
export function exportJSON(): string {
  const data = loadData();
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), app: "runlab-pilot", ...data },
    null,
    2
  );
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 응답 유형별 CSV — 분석 시 바로 붙일 수 있는 형태 */
export function exportCSV(): string {
  const data = loadData();
  const code = data.settings.participantCode;
  const lines: string[] = [];

  lines.push("== wake_ema ==");
  lines.push("participant,date,sleep_quality,fatigue,mood,completed_at");
  for (const e of data.wakeEMAs) {
    lines.push([code, e.date, e.sleepQuality, e.fatigue, e.mood, e.completedAt].map(csvEscape).join(","));
  }

  lines.push("");
  lines.push("== session_rpe ==");
  lines.push("participant,date,rpe,duration_min,note,completed_at");
  for (const s of data.sessionRPEs) {
    lines.push([code, s.date, s.rpe, s.durationMin ?? "", s.note, s.completedAt].map(csvEscape).join(","));
  }

  lines.push("");
  lines.push("== ostrc ==");
  lines.push(
    "participant,week_monday,problem_index,q1,q2,q3,q4,severity_score,type,body_area,illness_category,mh1,mh2,mh3,mh4,mh5,mh6,completed_at"
  );
  for (const r of data.ostrcResponses) {
    if (r.problems.length === 0) {
      lines.push([code, r.weekKey, 0, 0, 0, 0, 0, 0, "none", "", "", "", "", "", "", "", "", r.completedAt].map(csvEscape).join(","));
    }
    r.problems.forEach((p, i) => {
      lines.push(
        [
          code, r.weekKey, i + 1, p.q1, p.q2, p.q3, p.q4, p.severityScore,
          p.type ?? "", p.bodyArea ?? "", p.illnessCategory ?? "",
          p.mh ? p.mh.mh1.join("; ") + (p.mh.mh1Other ? `; 기타: ${p.mh.mh1Other}` : "") : "",
          p.mh?.mh2 ?? "", p.mh?.mh3 ?? "",
          p.mh ? p.mh.mh4.join("; ") + (p.mh.mh4Other ? `; 기타: ${p.mh.mh4Other}` : "") : "",
          p.mh?.mh5 ?? "", p.mh?.mh6 ?? "",
          r.completedAt,
        ].map(csvEscape).join(",")
      );
    });
  }

  lines.push("");
  lines.push("== sleep_log ==");
  lines.push("participant,date,bedtime_at,alarm_dismissed_at");
  for (const l of data.sleepLogs) {
    lines.push([code, l.date, l.bedtimeAt, l.alarmDismissedAt ?? ""].map(csvEscape).join(","));
  }

  return lines.join("\n");
}
