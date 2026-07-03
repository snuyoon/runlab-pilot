# OPERATIONS — 연구 운영 · 배포 가이드

연구자(관리자)가 파일럿을 돌리는 데 필요한 모든 절차. 최종 갱신: 2026-07-03.

## 접속 정보

- 참여자 앱: https://runlab-pilot.vercel.app (Safari) / **RunLab iOS 앱** (권장 — 진짜 알람)
- 관리자: https://runlab-pilot.vercel.app/admin — 키는 `.env.local`의 `ADMIN_KEY` (Vercel 환경변수에도 동일 값). **키를 저장소·문서에 적지 말 것.**
- 인프라: GitHub `snuyoon/runlab-pilot`(main 푸시=자동 배포) · Vercel 프로젝트 `runlab-pilot` · Neon DB `runlab-pilot-db`

## 참여자 온보딩

1. `/admin → 참여자 코드 관리`에서 코드 확인/추가 (또는 `node scripts/add-participants.mjs 5 SNU`)
   - 현재 발급: `SNU-01-8HMJ` ~ `SNU-10-97XP` + `TEST-01`(연구자 테스트 전용)
   - 무작위 접미사는 보안장치 — 순차 코드(SNU-001)로 되돌리지 말 것
2. 참여자에게 개별 전달: 앱 설치(TestFlight) + 본인 코드
3. 참여자: 앱 실행 → 코드 입력 → 알람 권한 **허용** → 알람 시각 설정
4. 확인: /admin 격자에 해당 참여자 행이 생기고 응답이 올라오는지

## 일상 운영 (하루 1분)

/admin 상단 **⚠️ 주의가 필요한 참여자** 3패널만 보면 됨. 행 클릭 → 상세.

| 패널 | 빨강 기준 | 조치 |
|---|---|---|
| 📵 응답 누락 | 기상설문 2일+ 연속 미응답 · 7일 응답률<50% · 기록 없음(등록 2일↑) | 카톡/전화 넛지 (연속 미응답은 이탈 조기경보 — EMA 문헌) |
| 🩹 건강 문제 | substantial 문제(참여불가 또는 훈련수정/경기력 3·4번째) · 정신건강 보고 | 후속 확인. **비-substantial도 전원 표시** — 노르웨이 프로그램은 심각도 무관 전건 팔로업 |
| 🔥 훈련 부하 | 고강도(RPE≥8) 3일 연속 | 회복 권고. 주황(2일 연속·주 3일+·평균≥7·모노토니≥2)은 관찰 |

주황 기준 근거: EMA 준수 벤치마크 80%(메타분석), OSTRC 리마인더 +3일 관행, Foster 모노토니>2.0(세션시간 미수집이라 RPE-only 근사), 고강도 주 1~2회 권장. 임계값은 모니터링 플래그이지 진단 컷오프가 아님.

## 참여자 문제 해결

| 상황 | 조치 |
|---|---|
| 참여자 기기를 초기화하고 싶다 (재테스트 등) | /admin 코드 칩의 **↺** → 서버 기록 삭제 + 다음 앱 실행 시 기기 자동 초기화 (로그인·알람 유지) |
| 참여자가 중도 이탈 | 코드 칩의 **✕** 비활성화 — 로그인/수집 차단, 데이터는 보존 |
| 알람이 안 울린다고 함 | ① 앱에서 알람 켜져 있는지 ② 설정>RunLab 알람 권한 ③ iOS 26.1 미만이면 업데이트 안내 (폴백은 제한적) |
| 설문이 잠겨 있다고 함 | 기상설문·RPE는 하루 1회, OSTRC는 주 1회가 정상 |
| 데이터가 안 올라온다 | 참여자 폰이 온라인 상태에서 앱(홈) 한번 열게 하기 — outbox가 자동 재전송 |

## 데이터

- 수집 원천: Neon `records` (participant_code, kind, date, payload). /admin **전체 CSV**가 분석용 표준 내보내기 (wake_ema / session_rpe / ostrc(문제 단위 행) / sleep_log 섹션).
- 수면 로그: 취침 시점에 일단 올라오고 기상 시 갱신됨 — `alarm_dismissed_at`이 비어 있으면 "알람을 안 껐거나 앱을 안 연 밤".
- OSTRC 분석 지표: severityScore(0-100), substantial, recurrenceOfId(문제 체인), timeLossDays. 정의는 [OSTRC.md](OSTRC.md).
- 서버 데이터 일괄 삭제(테스트 정리): 절대 프로덕션에서 함부로 하지 말고, 특정 참여자만 ↺ 사용 권장.

## 배포

### 웹 (설문/관리자 수정)
`git push origin main` → Vercel 자동 배포(약 1분). 참여자 앱은 다음 실행 시 자동 반영 — **앱 심사 불필요** (하이브리드 구조의 핵심 장점).

### iOS 앱 (네이티브 변경 시에만)
```bash
cd ios && xcodegen generate   # project.yml 바꿨을 때만
open RunLab.xcodeproj          # Xcode → 기기 선택 → Run
```
서명 팀은 project.yml `DEVELOPMENT_TEAM`에 저장됨. 세부: [../ios/README-iOS.md](../ios/README-iOS.md)

### TestFlight (참여자/연구원 배포) — Apple Developer 승인 후
1. https://appstoreconnect.apple.com → 앱 등록 (Bundle ID `com.snuyoon.runlab`, 이름 RunLab)
2. Xcode: Product > Archive > Distribute App > TestFlight
3. App Store Connect > TestFlight > 외부 테스터 그룹 생성 → 빌드 추가 → **베타 심사 제출** (첫 빌드만, 통상 24~48시간)
4. 테스터 이메일 초대 → 테스터는 TestFlight 앱에서 수락·설치
5. 주의: 빌드 90일 만료(재업로드), 버전 올릴 때 `project.yml`의 MARKETING_VERSION/CURRENT_PROJECT_VERSION
- 승인 전 임시 배포: 대상자 아이폰을 개발 맥에 USB 연결 → Xcode Run (무료 서명, 7일 유효, 기기 3대)
- 대학 기관 명의 등록 시 연 $99 면제 신청 가능 (developer.apple.com/support/membership-fee-waiver)

## 환경변수 / 시크릿

| 키 | 위치 | 용도 |
|---|---|---|
| `DATABASE_URL` 등 Neon 세트 | Vercel(자동 주입) + `.env.local` | DB 접속 |
| `ADMIN_KEY` | Vercel 환경변수 + `.env.local` | /admin 및 admin API 인증 |

`.env.local`은 git 제외. 분실 시: Neon 값은 Vercel 프로젝트 Storage에서 재복사, ADMIN_KEY는 새로 생성해 Vercel에 갱신(관리자 브라우저 저장 키도 재입력).

## 알려진 한계 (참여자 안내문에 반영할 것)

- 알람은 iOS 26.1+에서 완전 동작(무음 관통·앱 종료 무관). 미만 버전은 일반 알림 수준.
- Safari(웹)로 쓰면 알람은 화면 켠 채 충전 필수 — **반드시 앱 사용** 안내.
- 진동 세기는 iOS 시스템이 제어(설정값의 체감 반영은 제한적일 수 있음 — 실기기 확인 예정).
