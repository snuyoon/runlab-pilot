# RunLab Pilot — 기술 아키텍처

> 최종 갱신: 2026-07-03. 데모 버전(동물 게이미피케이션) 문서를 대체함 — 데모는 [snuyoon/runlab-demo](https://github.com/snuyoon/runlab-demo) 참고.

## 전체 그림

```
┌─ 참여자 아이폰 ──────────────────────────────┐
│  RunLab iOS 앱 (SwiftUI 셸)                   │
│  ├─ WKWebView ── runlab-pilot.vercel.app 로드 │
│  │    localStorage(응답·설정) + outbox 큐     │
│  └─ AlarmKit 시스템 알람 (앱 꺼져도 울림)     │
│       └─ 끄기/설문 버튼 → 앱 열고 /ema 딥링크 │
└──────────────┬───────────────────────────────┘
               │ POST /api/sync (멱등 업서트)
               ▼
   Vercel (Next.js 16 App Router)
   ├─ 참여자 웹앱 (Safari에서도 동작 — 웹 알람 폴백)
   ├─ /api/validate · /api/sync · /api/admin/*
   └─ /admin 연구자 대시보드 (ADMIN_KEY)
               │
               ▼
   Neon Postgres (participants, records)
```

스택: Next.js 16(App Router) · React 19 · TypeScript · Tailwind v4 · Framer Motion · `@neondatabase/serverless` · SwiftUI + WKWebView + AlarmKit · XcodeGen.

## 웹앱 (src/)

### 페이지 (모두 클라이언트 컴포넌트)

| 경로 | 역할 | 비고 |
|---|---|---|
| `/` | 로그인 (사전 등록 코드 서버 검증) | 로그인 상태면 /home 자동 이동. 코드 변경 로그인 시 이전 기록 초기화 + 네이티브 알람 취소 후 재동기화 |
| `/home` | 허브: 오늘의 할 일, OSTRC 팝업, 알람 카드 | 진입 시 flushOutbox + 원격초기화 확인 + 네이티브 알람 재동기화 |
| `/alarm` | 알람앱 (여러 알람, 소리 5종, 진동 3단, 요일, 기상알람 지정) | 변경 시 saveAlarms + nativeSyncAlarms. 기상 알람은 삭제/해제 불가(다른 알람으로 이전만) |
| `/sleep` | 취침→수면→알람→해제 (웹 폴백 알람) | 네이티브에선 수면 로그만 기록(알람은 시스템 담당) |
| `/ema` | 기상 설문 3문항 (1~10 드래그 ScaleSlider) | 하루 1회. 진입 시 열린 수면 로그 마감 |
| `/rpe` | 세션 RPE (1~10 + 메모) | 하루 1회 |
| `/ostrc` | 주간 OSTRC-H2 위저드 (SnapSlider — 4선택지 스냅) | [OSTRC.md](OSTRC.md) 참조. 작성 중 초안 자동 보존·복원 |
| `/dashboard` | 참여자 본인 기록 + 수동 백업 + 전체 초기화 | 초기화 시 네이티브 알람도 취소 |
| `/admin` | 연구자 대시보드 (데스크톱 레이아웃) | 하단 별도 섹션 |

공통 패턴: `useMounted()` 게이트 → Inner 컴포넌트에서 lazy `useState(() => loadData())` (hydration 안전). 설문 3종은 미로그인 가드(`router.replace("/")`) — 알람 딥링크가 로그인 전에 열 수 있어서 필수.

### 상태 저장소 — `src/store/studyStore.ts` (단일 창구)

```
StudyData {
  settings: { participantCode, participantLabel, enrolledAt, lastResetAck,
              alarms: AlarmItem[],            // 알람앱 목록 (진실 원천)
              alarmHour/Minute/Enabled,       // 하위호환 미러 (홈/수면 표시용, saveAlarms가 동기화)
              bedtimeHour/Minute }
  wakeEMAs / sessionRPEs / ostrcResponses / sleepLogs
  outbox: OutboxItem[]                        // 서버 미전송 큐
}
AlarmItem { id, hour, minute, label, enabled, sound(5종), vibration(3단),
            days[](1=월~7=일, 빈배열=매일), isWake }
```

- `loadData()`는 **항상 새 객체** 반환 (모듈 기본값 오염 방지). 구버전 마이그레이션은 **parsed 원본**에 `alarms` 필드가 없을 때만 — 빈 배열(`[]`)은 "전부 삭제"라는 유효 상태.
- 응답 추가(addWakeEMA 등) = 로컬 push + outbox enqueue + `flushOutbox()`. **수면 로그는 취침 시점 부분 전송 → 기상 시 같은 clientId로 갱신 전송** (알람 무시해도 취침 기록은 수집).
- `flushOutbox()`: 배치(≤50) POST → 성공 시 `clientId|completedAt` 키로 제거 (전송 중 들어온 갱신본 보존). 오프라인이면 다음 기회 재시도. 호출: 홈 진입, online 이벤트, 각 add* 직후.
- 원격 초기화: 서버 `participants.reset_at` ≠ 로컬 `lastResetAck` → `applyRemoteReset()` (응답만 비우고 로그인·알람 설정 유지). 홈 진입과 로그인 두 경로에서 확인.

### 네이티브 브리지 — `src/lib/native.ts`

감지: `window.webkit.messageHandlers.runlab` 존재 (+네이티브가 `window.__RUNLAB_NATIVE__` 주입, UA 접미사 `RunLabNative/1.0`).

| 메시지 | payload | 처리(네이티브) |
|---|---|---|
| `syncAlarms` | `{alarms: AlarmItem[]}` | 전체 취소 후 재등록 (멱등) |
| `cancelAll` | — | AlarmKit + 폴백 알림 전부 취소 |
| `setParticipant` | `{code}` | UserDefaults 기록 (진단용) |

호출 지점: 로그인 성공(초기 등록), 홈 진입(재동기화 — 재설치 복구 겸용), /alarm 변경마다, 계정 전환·전체 초기화 시 cancelAll.

### 드래그 입력 — `src/components/sliders.tsx`

포인터 이벤트 직접 구현 (framer drag 미사용 — 백그라운드 탭 rAF 동결에 안전, `touch-none`으로 스크롤 간섭 차단).
- `ScaleSlider`: 1~10 정수 (기상 설문)
- `SnapSlider`: 고정 선택지 스냅 (OSTRC 4문항 — 검증된 선택지 유지하며 드래그 UX)

## 백엔드 (Neon Postgres + API Routes)

```sql
participants(code PK, label, active, reset_at, created_at)
records(client_id PK, participant_code FK, kind, date, completed_at, payload jsonb, received_at)
  -- kind: wake_ema | session_rpe | ostrc | sleep_log
```

- `POST /api/validate` `{code}` → `{valid, label, resetAt}` — active 코드만 통과.
- `POST /api/sync` `{code, records[≤100]}` — 코드 검증(403) 후 **ON CONFLICT(client_id) DO UPDATE**(participant 일치 조건) 멱등 업서트. 형식 불량 레코드는 건너뜀.
- `GET /api/admin/data` — participants + records 전체(LIMIT 20000). 집계는 클라이언트에서.
- `POST/DELETE /api/admin/participants` — 코드 등록 / 비활성화(데이터 보존).
- `POST /api/admin/reset` `{code}` — 해당 참여자 records 삭제 + `reset_at=now()` → 기기 자동 초기화.
- 관리자 인증: `x-admin-key` 헤더 == env `ADMIN_KEY`.
- 참여 코드는 무작위 접미사(`SNU-01-8HMJ`) — 열거/이웃 오타 방지. 발급: `scripts/add-participants.mjs`, 스키마: `scripts/migrate.mjs`(멱등).

## 관리자 대시보드 (/admin)

- **주의 필요 3패널** — 응답 누락 / OSTRC 건강 문제 / RPE 훈련 부하. 판정 기준·문헌 근거는 [OPERATIONS.md](OPERATIONS.md). 행 클릭 → 해당 참여자 상세.
- 요약 카드(오늘 EMA n/N, 주간 OSTRC n/N, 주간 유병률, 중대 문제 수), 최근 14일 컴플라이언스 격자, 참여자 상세(OSTRC 주별 카드+심각도 바+배지, EMA/RPE 색 칩, 수면 기록+누운 시간), 참여자 코드 관리(↺ 원격 초기화 / ✕ 비활성화), 전체 CSV 다운로드(BOM 포함).

## iOS 앱 (ios/)

XcodeGen(`project.yml`) → `RunLab.xcodeproj`. Bundle `com.snuyoon.runlab`, 배포 타깃 iOS 18+(AlarmKit 경로는 26.1+ 가드, 미만은 로컬알림 폴백). **Xcode 26.6 / iOS 26.5 SDK로 빌드 검증 완료.**

| 파일 | 역할 |
|---|---|
| `Sources/RunLabApp.swift` | @main + AppDelegate(폴백 알림 탭→/ema) + `WebRouter`(딥링크 상태, UserDefaults `runlab.pendingPath`) |
| `Sources/WebShellView.swift` | WKWebView: 영속 저장소(localStorage 유지), 브리지 수신(runlab), 도메인 화이트리스트(외부는 Safari), target=_blank 처리, pull-to-refresh, JS alert/confirm, **콜드런치 딥링크**(pendingPath 있으면 처음부터 /ema 로드) |
| `Sources/AlarmService.swift` | **작업 직렬화 체인** 위에서 sync/cancelAll 실행(연속 조작 레이스 방지). AlarmKit: 요일 반복, 커스텀 사운드 4종(`Sounds/*.caf` 번들), 저장 id+시스템 목록 양쪽 취소, AlarmKit↔폴백 상호 정리(이중 알람 방지) |
| `Sources/OpenSurveyIntent.swift` | 기상 알람 버튼 인텐트 2종('설문 시작'/'끄기') — **둘 다 `AlarmManager.stop()` 호출**(.custom 버튼은 알람을 자동으로 안 멈춤) 후 /ema 라우팅 |

AlarmKit 핵심 사실 (Apple 공식 문서로 검증):
- 시스템이 알람 소유 → 앱 종료돼도 울림, **무음 스위치·집중 모드 관통 공식 보장**
- entitlement **불필요** (지어내면 프로비저닝 에러) — Info.plist `NSAlarmKitUsageDescription`만 필수
- 시스템이 '끄기' 버튼 자동 제공, 매일 반복은 `.weekly(요일 7개)`
- 스누즈(.countdown 동작)는 Live Activity 위젯 익스텐션 필요 → 미사용
- 시뮬레이터는 잠금화면 발화 불안정(알려진 버그) — 예약까지만 시뮬레이터 검증, 발화는 실기기

딥링크 수명주기: 인텐트 perform → UserDefaults 기록 + `WebRouter.open("/ema")` → (실행 중) updateUIView가 로드 후 **양쪽 키 즉시 소비** / (콜드 런치) makeUIView가 시작 URL로 사용 후 소비. `lastHandledPath`는 처리 직후 async 리셋 — 잠금 금지(다음 딥링크 무시됨).

## 검증 이력

- 웹: Claude preview에서 전 플로우 E2E (OSTRC 게이트키퍼 3경로·초안 복원·반복 연결, EMA/RPE 하루 1회 가드, 계정 전환 초기화, 원격 초기화, 관리자 패널 3종).
- iOS 시뮬레이터(iPhone 17 Pro / iOS 26.5): 로그인 → AlarmKit 권한 다이얼로그 → 예약 성공(`runlab.alarmkit.ids` plist 확인), 콜드런치 /ema 딥링크, 앱 재실행 세션 유지.
- 적대적 리뷰 3회(백엔드 회차 5건 + 알람앱 회차 17건)에서 확정 버그 수정 — 교훈은 [DEVLOG.md](DEVLOG.md) 참고.
