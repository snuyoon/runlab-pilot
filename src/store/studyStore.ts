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

/** 계획 편차 사유 코드 (KAIST 협의 스키마 C1~C6) */
export type DeviationReasonCode =
  | "injury" // C1 몸이 아프거나 통증
  | "illness" // C2 감기 등 컨디션
  | "fatigue" // C3 피곤/회복 부족
  | "psych" // C4 의욕 없음
  | "external" // C5 시간·날씨·일정
  | "adaptive"; // C6 일부러 조절(적응 신호 — 실패와 분리)

/**
 * 러닝 세션 설문 (세션 종료 후 micro-EMA — sRPE + 계획 편차 + 부상 트랙)
 * Q1 sRPE(Foster CR-10 0~10) · Q2 계획완수 → (아니오면) Q2a 편차·Q2b 사유 · Q3 통증(독립)
 */
export interface SessionRPE {
  id: string;
  date: string;
  rpe: number; // Q1: 0~10 (Foster CR-10)
  planCompleted: boolean; // Q2: 계획대로 완수했나
  deviations: string[]; // Q2a: 무엇이 달랐나 (복수, planCompleted면 [])
  reasonCode: DeviationReasonCode | null; // Q2b: 가장 큰 이유 (planCompleted면 null)
  pain: boolean; // Q3: 세션 중/후 통증
  painArea: string | null; // Q3: 부위 (통증 없으면 null)
  painNRS: number | null; // Q3: 통증 강도 NRS 0~10 (통증 없으면 null)
  completedAt: string;
}

/** Q1 sRPE 언어 앵커 (Foster CR-10 표준 — 6·8·9는 앵커 없음) */
export const SRPE_ANCHORS: Record<number, string> = {
  0: "휴식", 1: "매우 쉬움", 2: "쉬움", 3: "보통", 4: "다소 힘듦",
  5: "힘듦", 7: "매우 힘듦", 10: "최대",
};

/** Q2a 계획과 무엇이 달랐나 (복수 선택) */
export const DEVIATION_OPTIONS: { id: string; label: string }[] = [
  { id: "distance", label: "거리를 못 채웠다" },
  { id: "pace", label: "페이스가 느려졌다" },
  { id: "intensity", label: "전체적인 강도를 못 냈다" },
  { id: "stopped", label: "중간에 멈췄다" },
  { id: "other", label: "기타" },
];

/** Q2b 가장 큰 이유 (단일 선택, C1~C6) */
export const REASON_OPTIONS: { code: DeviationReasonCode; label: string }[] = [
  { code: "injury", label: "몸이 아프거나 통증이 있었다" },
  { code: "illness", label: "감기 등 컨디션이 안 좋았다" },
  { code: "fatigue", label: "피곤하거나 회복이 덜 됐다" },
  { code: "psych", label: "의욕이 나지 않았다" },
  { code: "external", label: "시간·날씨·일정 등 상황 때문" },
  { code: "adaptive", label: "일부러 강도·거리를 조절했다" },
];

/** Q3 통증 부위 */
export const PAIN_AREAS: { id: string; label: string }[] = [
  { id: "foot_ankle", label: "발/발목" },
  { id: "shin_calf", label: "정강이/종아리" },
  { id: "knee", label: "무릎" },
  { id: "thigh", label: "허벅지" },
  { id: "hip_pelvis", label: "고관절/골반" },
  { id: "lower_back", label: "허리" },
  { id: "other", label: "기타" },
];

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

/**
 * 러닝 워치 운동 세션 (자동 유입 — Apple 건강/HealthKit 경유).
 * 가민 FR265 → Garmin Connect → Apple 건강 → iOS 네이티브 셸이 읽어 브리지로 전달.
 * id = HealthKit 워크아웃 UUID → 멱등 키(중복 방지).
 */
export interface WorkoutSession {
  id: string; // HealthKit 워크아웃 UUID
  date: string; // YYYY-MM-DD (세션 시작 로컬 날짜)
  source: string; // "healthkit"
  activityType: string; // "running" 등
  startAt: string; // ISO
  endAt: string; // ISO
  durationSec: number;
  distanceM: number; // 미터
  avgPaceSecPerKm: number | null; // 초/km (거리 0이면 null)
  avgHeartRate: number | null; // bpm
  completedAt: string;
}

/** 서버 전송 대기 큐 항목 */
export interface OutboxItem {
  clientId: string;
  kind: "wake_ema" | "session_rpe" | "ostrc" | "sleep_log" | "workout";
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
  workouts: WorkoutSession[];
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

function makeDefaultData(): StudyData {
  return {
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
    workouts: [],
    outbox: [],
  };
}

// SSR 렌더용 고정 기본값 (읽기 전용으로만 사용할 것)
const defaultData: StudyData = makeDefaultData();

export function loadData(): StudyData {
  // 항상 새 객체를 반환 — 호출자가 mutate 후 persist하는 패턴이므로
  // 모듈 레벨 기본 객체가 오염되지 않도록 한다
  if (typeof window === "undefined") return makeDefaultData();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const settings = { ...makeDefaultData().settings, ...parsed.settings };
      // 마이그레이션: 구버전(alarms 필드 자체가 없음) → 기존 단일 알람 설정을 보존해 변환.
      // 판정은 병합 전 원본(parsed) 기준 — 병합값으로 판정하면 기본 배열이 끼어들어
      // 구버전 설정(시각/켜짐)이 유실된다. 빈 배열([])은 '전부 삭제'라는 유효한 상태로 존중.
      const rawAlarms = parsed?.settings?.alarms;
      if (!Array.isArray(rawAlarms)) {
        settings.alarms = [
          {
            id: "wake",
            hour: parsed?.settings?.alarmHour ?? 7,
            minute: parsed?.settings?.alarmMinute ?? 0,
            label: "기상 알람",
            enabled: parsed?.settings?.alarmEnabled ?? true,
            sound: "default",
            vibration: "normal",
            days: [],
            isWake: true,
          },
        ];
      } else {
        settings.alarms = rawAlarms;
      }
      return {
        ...makeDefaultData(),
        ...parsed,
        settings,
        outbox: parsed.outbox ?? [],
      };
    }
  } catch {}
  return makeDefaultData();
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

/** 대표 기상 알람 (sleep/ema 등 기존 화면 참조용) — isWake 알람만 인정 */
export function wakeAlarm(data: StudyData = loadData()): AlarmItem | null {
  return data.settings.alarms.find((a) => a.isWake) ?? null;
}

/** 알람 목록 저장 + 대표 기상 알람을 구필드에 동기화 (하위 호환) */
export function saveAlarms(alarms: AlarmItem[]) {
  const data = loadData();
  data.settings.alarms = alarms;
  const wake = alarms.find((a) => a.isWake);
  if (wake) {
    data.settings.alarmHour = wake.hour;
    data.settings.alarmMinute = wake.minute;
    data.settings.alarmEnabled = wake.enabled;
  } else {
    // 기상 알람이 없으면(전부 삭제 등) 구필드도 꺼짐으로 — 유령 알람 표시/발화 방지
    data.settings.alarmEnabled = false;
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
      // clientId+completedAt로 식별 — 전송 중 같은 clientId의 갱신본(수면 로그 마감 등)이
      // 새로 큐에 들어온 경우 그 갱신본은 남겨서 다음에 전송되게 한다
      const sentKeys = new Set(batch.map((b) => `${b.clientId}|${b.completedAt}`));
      const current = loadData(); // 전송 중 추가된 항목 보존
      current.outbox = current.outbox.filter((o) => !sentKeys.has(`${o.clientId}|${o.completedAt}`));
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

/**
 * 워치 운동 세션 자동 유입 (HealthKit 경유). id = 워크아웃 UUID로 멱등 —
 * 이미 저장된 세션이면 스킵. 반환값: 새로 추가됐으면 true.
 */
export function addWorkoutSession(entry: Omit<WorkoutSession, "completedAt">): boolean {
  const data = loadData();
  if (!entry.id || data.workouts.some((w) => w.id === entry.id)) return false;
  const record: WorkoutSession = { ...entry, completedAt: new Date().toISOString() };
  data.workouts.push(record);
  enqueue(data, {
    clientId: record.id,
    kind: "workout",
    date: record.date,
    completedAt: record.completedAt,
    payload: record,
  });
  persist(data);
  void flushOutbox();
  // 새 워크아웃 유입 시 화면이 실시간 갱신되도록 알림 (dashboard·/runs가 구독)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("runlab:workout"));
  }
  return true;
}

/** 최근 운동 세션 (자동 유입) — 최신순 */
export function getWorkouts(data: StudyData = loadData()): WorkoutSession[] {
  return [...data.workouts].sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
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
  const log: SleepLog = {
    id,
    date: todayStr(),
    bedtimeAt: new Date().toISOString(),
    alarmDismissedAt: null,
  };
  data.sleepLogs.push(log);
  // 취침 시점에 부분 전송 — 알람을 무시하고 앱을 안 열어도 취침 기록은 서버에 남는다.
  // 기상 시 finishSleepLog가 같은 clientId로 재전송하면 서버가 갱신(업서트).
  enqueue(data, {
    clientId: log.id,
    kind: "sleep_log",
    date: log.date,
    completedAt: log.bedtimeAt,
    payload: log,
  });
  persist(data);
  void flushOutbox();
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
  lines.push("participant,date,rpe,plan_completed,deviations,reason_code,pain,pain_area,pain_nrs,completed_at");
  for (const s of data.sessionRPEs) {
    lines.push([
      code, s.date, s.rpe,
      s.planCompleted === false ? "no" : s.planCompleted === true ? "yes" : "",
      (s.deviations ?? []).join("; "),
      s.reasonCode ?? "",
      s.pain === true ? "yes" : s.pain === false ? "no" : "",
      s.painArea ?? "", s.painNRS ?? "",
      s.completedAt,
    ].map(csvEscape).join(","));
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

  lines.push("");
  lines.push("== workout (auto / HealthKit) ==");
  lines.push("participant,date,source,activity,start_at,end_at,duration_sec,distance_m,avg_pace_sec_per_km,avg_hr");
  for (const w of data.workouts) {
    lines.push([
      code, w.date, w.source, w.activityType, w.startAt, w.endAt,
      w.durationSec, w.distanceM, w.avgPaceSecPerKm ?? "", w.avgHeartRate ?? "",
    ].map(csvEscape).join(","));
  }

  return lines.join("\n");
}
