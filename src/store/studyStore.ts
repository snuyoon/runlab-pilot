"use client";

/**
 * studyStore.ts — RunLab 파일럿 연구 데이터 저장소
 *
 * 저장 구조:
 *  - 모든 응답은 localStorage에 기록(오프라인 안전)하고, 동시에 outbox 큐에 넣어
 *    서버(/api/sync)로 전송한다. 전송 성공 시 큐에서 제거, 실패하면 다음 기회에 재시도.
 *  - 서버는 clientId 기준 멱등 upsert이므로 중복 전송해도 안전하다.
 */

// ─── 타입 정의 ─────────────────────────────────────────────

/** 알람 소리 (네이티브 앱에 번들된 사운드 id) */
export type AlarmSound = "default" | "radar" | "chime" | "bell" | "digital";
/** 진동 세기 */
export type AlarmVibration = "off" | "normal" | "strong";

export const ALARM_SOUNDS: { id: AlarmSound; label: string }[] = [
  { id: "default", label: "기본음" },
  { id: "radar", label: "레이더" },
  { id: "chime", label: "차임" },
  { id: "bell", label: "종소리" },
  { id: "digital", label: "디지털" },
];

export const ALARM_VIBRATIONS: { id: AlarmVibration; label: string }[] = [
  { id: "off", label: "진동 없음" },
  { id: "normal", label: "보통" },
  { id: "strong", label: "강하게" },
];

/** 알람 1개 (기본 시계 앱처럼 여러 개 등록·개별 on/off) */
export interface AlarmItem {
  id: string;
  hour: number;
  minute: number;
  label: string;
  enabled: boolean;
  sound: AlarmSound;
  vibration: AlarmVibration;
  days: number[]; // 1=월 ~ 7=일. 빈 배열 = 매일
  /** 기상 알람 여부 — true면 알람을 끄면 기상 설문이 자동으로 뜬다 */
  isWake: boolean;
}

/** 참여자 및 알람 설정 */
export interface StudySettings {
  participantCode: string; // 연구 참여 코드 (예: SNU-01-8XKQ)
  participantLabel: string; // 서버에 등록된 참여자 라벨 (오입력 확인용)
  enrolledAt: string; // 최초 로그인 시각 (ISO)
  lastResetAck: string; // 마지막으로 반영한 서버 원격 초기화 시각 (reset_at)
  alarms: AlarmItem[]; // 알람 목록 (기본 시계 앱 방식)
  // 하위 호환 — 예전 단일 알람 필드 (마이그레이션용, sleep/ema에서 대표 기상 알람 참조)
  alarmHour: number;
  alarmMinute: number;
  alarmEnabled: boolean;
  bedtimeHour: number;
  bedtimeMinute: number;
}

/** 기상 직후 EMA 응답 (1~10점 드래그) */
export interface WakeEMA {
  id: string;
  date: string; // YYYY-MM-DD
  sleepQuality: number;
  fatigue: number;
  mood: number;
  completedAt: string;
}

/** 러닝 세션 강도(RPE) 응답 */
export interface SessionRPE {
  id: string;
  date: string;
  rpe: number; // 1~10
  note: string;
  completedAt: string;
}

/**
 * OSTRC-H2 — 건강 문제 1건에 대한 응답
 *
 * 게이트키퍼 로직(Clarsen 2020, BJSM 54:390-396):
 *  - Q1=첫 선택지(완전 참여) → 문제 없음, 설문 종료 (이 레코드 자체가 생성되지 않음)
 *  - Q1=넷째 선택지(참여 불가) → Q2~Q4 스킵(null), 총 심각도 100 자동 부여
 *  - 그 외 → Q2~Q4 응답, 심각도 = 문항 점수(0/8/17/25) 합산
 */
export interface OSTRCProblem {
  id: string; // 문제 고유 id — 주간 반복 보고 연결(recurrence)에 사용
  label: string; // 표시용 요약 (예: "부상 · 무릎")
  q1: number; // 선택 인덱스 0~3
  q2: number | null; // 게이트키퍼로 스킵되면 null
  q3: number | null;
  q4: number | null;
  severityScore: number; // 0~100
  substantial: boolean; // Q1=④ 또는 Q2/Q3에서 3·4번째 선택지
  type: "injury" | "illness" | "mental" | null;
  bodyArea: string | null;
  illnessCategory: string | null;
  mh: {
    mh1: string[];
    mh1Other: string;
    mh2: string;
    mh3: string;
    mh4: string[];
    mh4Other: string;
    mh5: string;
    mh6: number;
  } | null;
  recurrenceOfId: string | null; // 이전 주에 보고한 문제의 루트 id (신규면 null)
  timeLossDays: number | null; // 지난 7일 중 완전히 쉰 날 수 (0~7)
}

/** OSTRC-H2 주간 응답 */
export interface OSTRCResponse {
  id: string;
  weekKey: string; // 해당 주 월요일 (YYYY-MM-DD)
  noProblem: boolean;
  problems: OSTRCProblem[];
  completedAt: string;
}

/** 수면 세션 로그 */
export interface SleepLog {
  id: string;
  date: string;
  bedtimeAt: string;
  alarmDismissedAt: string | null;
}

/** 서버 전송 대기 큐 항목 */
export interface OutboxItem {
  clientId: string;
  kind: "wake_ema" | "session_rpe" | "ostrc" | "sleep_log";
  date: string;
  completedAt: string;
  payload: unknown;
}

/** 저장소 전체 구조 */
export interface StudyData {
  settings: StudySettings;
  wakeEMAs: WakeEMA[];
  sessionRPEs: SessionRPE[];
  ostrcResponses: OSTRCResponse[];
  sleepLogs: SleepLog[];
  outbox: OutboxItem[];
}

// ─── 저장소 기본 ────────────────────────────────────────────

const STORAGE_KEY = "runlab-pilot-v1";

function defaultAlarms(): AlarmItem[] {
  return [
    {
      id: "wake",
      hour: 7,
      minute: 0,
      label: "기상 알람",
      enabled: true,
      sound: "default",
      vibration: "normal",
      days: [], // 매일
      isWake: true,
    },
  ];
}

const defaultData: StudyData = {
  settings: {
    participantCode: "",
    participantLabel: "",
    enrolledAt: "",
    lastResetAck: "",
    alarms: defaultAlarms(),
    alarmHour: 7,
    alarmMinute: 0,
    alarmEnabled: true,
    bedtimeHour: 23,
    bedtimeMinute: 0,
  },
  wakeEMAs: [],
  sessionRPEs: [],
  ostrcResponses: [],
  sleepLogs: [],
  outbox: [],
};

export function loadData(): StudyData {
  if (typeof window === "undefined") return defaultData;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const settings = { ...defaultData.settings, ...parsed.settings };
      // 마이그레이션: 예전 단일 알람 → alarms 배열
      if (!Array.isArray(settings.alarms) || settings.alarms.length === 0) {
        settings.alarms = [
          {
            id: "wake",
            hour: settings.alarmHour ?? 7,
            minute: settings.alarmMinute ?? 0,
            label: "기상 알람",
            enabled: settings.alarmEnabled ?? true,
            sound: "default",
            vibration: "normal",
            days: [],
            isWake: true,
          },
        ];
      }
      return {
        ...defaultData,
        ...parsed,
        settings,
        outbox: parsed.outbox ?? [],
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

// ─── 알람 목록 관리 ─────────────────────────────────────────

export function getAlarms(): AlarmItem[] {
  return loadData().settings.alarms;
}

/** 대표 기상 알람 (sleep/ema 등 기존 화면 참조용) */
export function wakeAlarm(data: StudyData = loadData()): AlarmItem | null {
  return data.settings.alarms.find((a) => a.isWake) ?? data.settings.alarms[0] ?? null;
}

/** 알람 목록 저장 + 대표 기상 알람을 구필드에 동기화 (하위 호환) */
export function saveAlarms(alarms: AlarmItem[]) {
  const data = loadData();
  data.settings.alarms = alarms;
  const wake = alarms.find((a) => a.isWake) ?? alarms[0];
  if (wake) {
    data.settings.alarmHour = wake.hour;
    data.settings.alarmMinute = wake.minute;
    data.settings.alarmEnabled = wake.enabled;
  }
  persist(data);
}

export function resetAll() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("runlab-ostrc-draft-v1"); // OSTRC 작성 중 초안도 함께 삭제
}

/**
 * 관리자 원격 초기화 반영: 응답 기록만 비우고 로그인/알람 설정은 유지.
 * lastResetAck를 갱신해 같은 초기화가 반복 적용되지 않게 한다.
 */
export function applyRemoteReset(resetAt: string) {
  if (typeof window === "undefined") return;
  const current = loadData();
  const fresh: StudyData = {
    ...defaultData,
    settings: { ...current.settings, lastResetAck: resetAt },
  };
  persist(fresh);
  localStorage.removeItem("runlab-ostrc-draft-v1");
}

export function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 서버 동기화 (outbox) ───────────────────────────────────

function enqueue(data: StudyData, item: OutboxItem) {
  data.outbox.push(item);
}

let flushing = false;

/**
 * outbox의 레코드를 서버로 전송. 실패해도 조용히 넘어가고 다음 호출 때 재시도.
 * 앱 진입(홈), 레코드 추가 직후, online 이벤트에서 호출된다.
 */
export async function flushOutbox(): Promise<void> {
  if (typeof window === "undefined" || flushing) return;
  const snapshot = loadData();
  if (!snapshot.settings.participantCode || snapshot.outbox.length === 0) return;
  flushing = true;
  try {
    const batch = snapshot.outbox.slice(0, 50);
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: snapshot.settings.participantCode,
        records: batch,
      }),
    });
    if (res.ok) {
      const sent = new Set(batch.map((b) => b.clientId));
      const current = loadData(); // 전송 중 추가된 항목 보존
      current.outbox = current.outbox.filter((o) => !sent.has(o.clientId));
      persist(current);
      // 남은 게 있으면 이어서 전송
      if (current.outbox.length > 0) {
        flushing = false;
        return flushOutbox();
      }
    }
  } catch {
    // 오프라인 등 — 다음 기회에 재시도
  } finally {
    flushing = false;
  }
}

// ─── 기록 추가 ──────────────────────────────────────────────

export function addWakeEMA(entry: Omit<WakeEMA, "id" | "completedAt">) {
  const data = loadData();
  const record: WakeEMA = { ...entry, id: makeId(), completedAt: new Date().toISOString() };
  data.wakeEMAs.push(record);
  enqueue(data, {
    clientId: record.id,
    kind: "wake_ema",
    date: record.date,
    completedAt: record.completedAt,
    payload: record,
  });
  persist(data);
  void flushOutbox();
}

export function addSessionRPE(entry: Omit<SessionRPE, "id" | "completedAt">) {
  const data = loadData();
  const record: SessionRPE = { ...entry, id: makeId(), completedAt: new Date().toISOString() };
  data.sessionRPEs.push(record);
  enqueue(data, {
    clientId: record.id,
    kind: "session_rpe",
    date: record.date,
    completedAt: record.completedAt,
    payload: record,
  });
  persist(data);
  void flushOutbox();
}

export function addOSTRCResponse(entry: Omit<OSTRCResponse, "id" | "completedAt">) {
  const data = loadData();
  const record: OSTRCResponse = { ...entry, id: makeId(), completedAt: new Date().toISOString() };
  data.ostrcResponses.push(record);
  enqueue(data, {
    clientId: record.id,
    kind: "ostrc",
    date: record.weekKey,
    completedAt: record.completedAt,
    payload: record,
  });
  persist(data);
  void flushOutbox();
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

/**
 * 미완료 수면 로그 마감 (네이티브 앱용):
 * 시스템 알람은 앱 밖에서 울리므로, 알람 해제 후 설문이 열리는 시점에
 * 24시간 내 시작된 미완료 수면 로그를 기상으로 마감한다.
 */
export function finishLatestOpenSleepLog() {
  const data = loadData();
  const open = [...data.sleepLogs]
    .reverse()
    .find(
      (l) =>
        l.alarmDismissedAt === null &&
        Date.now() - new Date(l.bedtimeAt).getTime() < 24 * 3600000
    );
  if (open) finishSleepLog(open.id);
}

/** 알람 해제 시각 기록 후 서버 전송 큐에 추가 */
export function finishSleepLog(id: string) {
  const data = loadData();
  const log = data.sleepLogs.find((l) => l.id === id);
  if (log) {
    log.alarmDismissedAt = new Date().toISOString();
    log.date = todayStr();
    enqueue(data, {
      clientId: log.id,
      kind: "sleep_log",
      date: log.date,
      completedAt: log.alarmDismissedAt,
      payload: log,
    });
    persist(data);
    void flushOutbox();
  }
}

// ─── OSTRC 반복 문제 목록 ───────────────────────────────────

export interface PriorProblem {
  rootId: string; // 반복 체인의 루트 문제 id
  label: string;
  type: OSTRCProblem["type"];
  bodyArea: string | null;
  illnessCategory: string | null;
  mh: OSTRCProblem["mh"];
  lastWeek: string; // 마지막으로 보고된 주
}

/**
 * 이전 주들에 보고된 건강 문제 목록 (반복 보고 연결용).
 * 반복 체인은 루트 id로 묶어 최신 보고 기준으로 1건씩 반환.
 */
export function priorProblems(data: StudyData = loadData()): PriorProblem[] {
  const byRoot = new Map<string, PriorProblem>();
  for (const res of data.ostrcResponses) {
    for (const p of res.problems) {
      const rootId = p.recurrenceOfId ?? p.id;
      const existing = byRoot.get(rootId);
      if (!existing || res.weekKey > existing.lastWeek) {
        byRoot.set(rootId, {
          rootId,
          label: p.label,
          type: p.type,
          bodyArea: p.bodyArea,
          illnessCategory: p.illnessCategory,
          mh: p.mh,
          lastWeek: res.weekKey,
        });
      }
    }
  }
  return [...byRoot.values()].sort((a, b) => (a.lastWeek < b.lastWeek ? 1 : -1));
}

// ─── 날짜 유틸 ──────────────────────────────────────────────

export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function mondayOf(d: Date = new Date()): string {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return todayStr(copy);
}

// ─── 오늘 할 일 판정 ────────────────────────────────────────

export function isWakeEMADue(data: StudyData = loadData()): boolean {
  const today = todayStr();
  return !data.wakeEMAs.some((e) => e.date === today);
}

/** 오늘 러닝 세션 RPE를 이미 기록했는가 (하루 1회 제한) */
export function isRPEDoneToday(data: StudyData = loadData()): boolean {
  const today = todayStr();
  return data.sessionRPEs.some((s) => s.date === today);
}

export function isOSTRCDue(data: StudyData = loadData()): boolean {
  const week = mondayOf();
  return !data.ostrcResponses.some((r) => r.weekKey === week);
}

export function isMonday(d: Date = new Date()): boolean {
  return d.getDay() === 1;
}

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

// ─── 데이터 내보내기 (수동 백업용 — 서버 동기화와 별개) ─────

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
  lines.push("participant,date,rpe,note,completed_at");
  for (const s of data.sessionRPEs) {
    lines.push([code, s.date, s.rpe, s.note, s.completedAt].map(csvEscape).join(","));
  }

  lines.push("");
  lines.push("== ostrc ==");
  lines.push(
    "participant,week_monday,problem_index,problem_id,recurrence_of,q1,q2,q3,q4,severity_score,substantial,type,body_area,illness_category,time_loss_days,mh1,mh2,mh3,mh4,mh5,mh6,completed_at"
  );
  for (const r of data.ostrcResponses) {
    if (r.problems.length === 0) {
      lines.push([code, r.weekKey, 0, "", "", 0, 0, 0, 0, 0, false, "none", "", "", "", "", "", "", "", "", "", r.completedAt].map(csvEscape).join(","));
    }
    r.problems.forEach((p, i) => {
      lines.push(
        [
          code, r.weekKey, i + 1, p.id, p.recurrenceOfId ?? "",
          p.q1, p.q2 ?? "", p.q3 ?? "", p.q4 ?? "", p.severityScore, p.substantial,
          p.type ?? "", p.bodyArea ?? "", p.illnessCategory ?? "", p.timeLossDays ?? "",
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
