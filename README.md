# RunLab Pilot — 러닝 연구 파일럿 참여자 앱

> AI 스마트 러닝워치 연구의 **파일럿 테스트(약 10명)** 용 참여자 앱 + 연구자 백엔드.
> **아이폰 전용** 최적화. 응답은 서버(Neon Postgres)로 자동 수집되어 관리자 화면에서 실시간 확인.

- 참여자 앱: **https://runlab-pilot.vercel.app**
- 관리자 대시보드: **https://runlab-pilot.vercel.app/admin** (관리자 키 필요)
- 실기기 테스트 절차: [docs/파일럿테스트_체크리스트.md](docs/파일럿테스트_체크리스트.md)

---

## 참여자가 하는 일

| 주기 | 할 일 | 화면 |
|---|---|---|
| 매일 밤 | 워치 착용 → 취침 시작 (화면 켠 채 충전) | `/sleep` |
| 매일 아침 | 알람 해제 → **기상 설문** 자동 실행 (수면질/피로/기분, 1~5점, 하루 1회) | `/ema` |
| 러닝 후 | **세션 강도(RPE)** 기록 (1~10점 + 메모, 하루 여러 번 가능) | `/rpe` |
| 매주 월요일 | **OSTRC-H2 주간 건강 설문** — 앱 진입 시 팝업 알림 | `/ostrc` |

## 주요 기능

### 로그인 — 사전 등록 코드만 허용
- 관리자가 발급한 코드만 통과 (`/api/validate` 서버 검증). 코드는 추측 불가능한
  무작위 접미사 형식(`SNU-01-8HMJ`)으로 오타·위조 입력을 차단
- 코드 발급: 관리자 화면에서 추가하거나 `node scripts/add-participants.mjs [인원] [접두사]`

### 알람 + 수면 플로우 (`/alarm`, `/sleep`)
- 취침 시작 → 수면 화면 → **설정 시각에 자동 알람** (WebAudio 알람음)
- 알람 판정은 목표 시각 기준(`now >= target`) — JS가 잠시 멈춰도 복귀 즉시 발화
- Wake Lock으로 화면 꺼짐 방지 + **visible 복귀 시 자동 재획득** (앱 전환에도 유지)
- 밀어서 끄기 → 기상 설문 자동 진입(오늘 완료했으면 홈으로), 취침/기상 시각 로그 저장

### 주간 OSTRC-H2 설문 (`/ostrc`)
- IOC modified OSTRC-H2 **한국어판**(KSOC 최종판) 문항 — 검증된 문구 그대로 사용
- **공식 게이트키퍼 로직** (Clarsen et al. 2020, BJSM 54:390-396):
  - Q1=① 완전 참여 → 설문 즉시 종료, 심각도 0
  - Q1=④ 참여 불가 → Q2~Q4 스킵, **심각도 100 자동 부여**, 분류 문항으로 직행
  - 그 외 → Q2~Q4 응답, 심각도 = 문항 점수(0/8/17/25) 합산 (0~100)
- **반복 문제 연결**: "이전에 보고한 문제인가요?" — 같은 부상을 주 단위로 이어 추적 (노르웨이 올림픽위 운용판 구조)
- **시간 손실**: 지난 7일 중 완전히 쉰 날 수(0~7일) — IOC 표준 지표
- **substantial(중대한 문제) 플래그**: Q1=④ 또는 Q2/Q3에서 3·4번째 선택지
- 여러 문제 등록 시 문제마다 반복. 작성 중 이탈해도 완료한 문제는 초안으로 보존·복원

### 데이터 수집 (자동)
- 모든 응답은 기기(localStorage)에 저장되는 동시에 **서버로 자동 전송** (`/api/sync`)
- 오프라인이면 전송 큐에 대기, 네트워크 복구/앱 재진입 시 재시도 (clientId 멱등 — 중복 없음)
- 참여자의 수동 내보내기(내 기록 화면)는 백업 수단으로 유지

### 관리자 대시보드 (`/admin`)
- **ADMIN_KEY**로 보호 (Vercel 환경변수). 입력한 키는 브라우저에 저장됨
- 참여자 × 최근 14일 컴플라이언스 격자 (기상 설문 ✅ / RPE 세션 수 / 주간 OSTRC)
- 참여자별 응답 상세: OSTRC 심각도·substantial·시간손실·반복 여부, EMA/RPE 이력
- 요약 지표: 오늘 기상 설문 완료율, 주간 OSTRC 완료율, **주간 유병률**, 중대한 문제 수
- 2일 이상 미응답자 하이라이트 (넛지용), 참여자 코드 등록/비활성화, **전체 CSV 다운로드**

## 기술 구조

```
클라이언트(iPhone PWA, localStorage+outbox) ─→ /api/sync ─→ Neon Postgres
로그인 ─→ /api/validate (사전 등록 코드 검증)          ↑
관리자 /admin ─→ /api/admin/* (x-admin-key) ──────────┘
```

- Next.js 16 (App Router) + React 19 + Tailwind v4 + Framer Motion + `@neondatabase/serverless`
- DB: Neon Postgres (Vercel Marketplace 연동, 무료 티어) — `participants`, `records`(jsonb payload)
- 클라이언트 데이터 로직은 [src/store/studyStore.ts](src/store/studyStore.ts) 단일 창구
- OSTRC 문항 데이터: [src/data/ostrc.ts](src/data/ostrc.ts)

```bash
npm install
# .env.local 에 DATABASE_URL(Neon), ADMIN_KEY 필요 (git 커밋 금지)
node scripts/migrate.mjs           # 스키마 생성 + TEST-01 시드
node scripts/add-participants.mjs  # 참여자 코드 발급
npm run dev
```

## 알려진 제약

- **백그라운드 알람 불가**: 화면 꺼짐/Safari 종료 시 알람 안 울림 → 취침 시 충전기 연결 + 화면 켜두기(앱이 화면 꺼짐을 방지함)
- iOS 무음 스위치 상태에서 알람음이 나는지 실기기 확인 필요 (체크리스트 참고)
- API rate limit 없음 (파일럿 규모 전제). 무작위 코드가 무단 접근의 실질적 방어선
- 푸시 알림 없음: OSTRC 알림은 앱 진입 시 팝업. 필요 시 iOS 웹푸시(16.4+, 홈 화면 설치 시)로 확장 가능

## 이전 버전

VC 피칭용 컨셉 데모(동물 게이미피케이션)는 [snuyoon/runlab-demo](https://github.com/snuyoon/runlab-demo) 참고.
`docs/ARCHITECTURE.md`, `docs/프로젝트계획서.md`는 데모 버전 기준 문서입니다.
