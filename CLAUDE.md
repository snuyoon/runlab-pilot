@AGENTS.md

# RunLab Pilot — 에이전트 작업 가이드

러닝 연구 파일럿(참여자 ~10명) 앱. **웹앱(Next.js/Vercel) + iOS 네이티브 셸(WKWebView + AlarmKit 알람) + Android 네이티브 셸(WebView + AlarmManager + Health Connect) + Neon Postgres 백엔드**.
새 세션은 이 파일 → [docs/DEVLOG.md](docs/DEVLOG.md)(현황·의사결정) → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)(구조) 순으로 읽을 것.

## 핵심 링크

| | |
|---|---|
| 참여자 앱 (프로덕션) | https://runlab-pilot.vercel.app |
| 관리자 대시보드 | https://runlab-pilot.vercel.app/admin (ADMIN_KEY 필요 — `.env.local` 참조) |
| GitHub | https://github.com/snuyoon/runlab-pilot (main 푸시 = Vercel 자동 배포) |
| DB | Neon Postgres `runlab-pilot-db` (Vercel Marketplace 연동, 리전 iad1) |

## 명령어

```bash
npm run dev                      # 웹 개발 서버 (localhost:3000)
npx eslint src && npm run build  # 웹 검증 (커밋 전 필수)
node scripts/migrate.mjs         # DB 스키마 생성 (멱등)
node scripts/add-participants.mjs [N] [접두사]  # 참여 코드 발급

# iOS (Xcode 26.6 / iOS 26.5 SDK 설치됨 — AlarmKit 포함)
cd ios && xcodegen generate      # project.yml 변경 시 재생성
xcodebuild -project ios/RunLab.xcodeproj -scheme RunLab -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO

# Android (JDK17 + SDK 36 / build-tools 36 설치됨. AGP 8.9.1 · Gradle 8.11.1 래퍼 · Kotlin 2.0.21)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17   # 시스템 java(26)가 아니라 JDK17 사용 필수
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd android && ./gradlew assembleDebug            # → app/build/outputs/apk/debug/app-debug.apk
```

`.env.local`(git 제외)에 `DATABASE_URL`(Neon), `ADMIN_KEY`. Vercel 환경변수에도 동일 키 설정돼 있음. **비밀값을 저장소/문서에 쓰지 말 것.**

## 절대 규칙

1. **OSTRC 핵심 4문항의 문구·선택지·점수(0/8/17/25)를 수정 금지** — 검증된 도구(KSOC 한국어판). 게이트키퍼 로직 포함 규칙은 [docs/OSTRC.md](docs/OSTRC.md).
2. **localStorage를 읽는 페이지는 `useMounted()` 게이트 + 내부 컴포넌트 lazy useState** 패턴 (hydration mismatch + `react-hooks/set-state-in-effect` 린트 회피). 기존 페이지 참고.
3. 데이터 읽기/쓰기는 전부 `src/store/studyStore.ts` 경유. 응답 추가 함수는 반드시 outbox enqueue + `flushOutbox()` 호출.
4. 알람 목록 변경 후엔 반드시 `nativeSyncAlarms(getAlarms())` (네이티브일 때). 네이티브 초기 동기화는 로그인·홈 진입에서 이미 수행.
5. 설문 페이지(/ema, /rpe, /ostrc)는 미로그인 진입 가드 유지 (알람 딥링크가 로그인 전에 열 수 있음).
6. UI 전환에 `AnimatePresence mode="wait"`(exit 대기) 사용 금지 — 백그라운드 탭에서 rAF가 멈춰 다음 화면이 영영 안 뜸. entrance 애니메이션만.
7. iOS: AlarmKit에 **entitlement 없음** (지어내면 프로비저닝 에러). Info.plist `NSAlarmKitUsageDescription`만. AlarmKit API는 iOS 26.1+ 가드.
8. 커밋 메시지는 한국어, 기존 스타일 유지. main 푸시 = 즉시 프로덕션 배포임을 유의.

## 테스트 노하우 (하드웨어 없이 검증하는 법)

- **웹 (Claude preview)**: 프리뷰 탭은 hidden이라 ① rAF 동결(framer exit 미완료) ② setTimeout ≥1s 클램프 ③ 프로그램적 click 후 React 플러시가 비동기. → `MessageChannel` tick으로 yield하며 `document.body.innerText` 폴링하는 패턴 사용 (과거 세션 eval 코드 참조).
- **iOS 시뮬레이터**: `xcrun simctl boot/install/launch/io screenshot`. UI 조작은 osascript: `tell application "System Events" to tell process "Simulator" to click at {x,y}` + `keystroke`. 좌표 매핑: Simulator 창 pos/size 읽고 content(타이틀바 28px 제외)에 기기 해상도(1206×2622) 비례 매핑.
- **알람 딥링크 재현**: `xcrun simctl spawn <sim> defaults write com.snuyoon.runlab runlab.pendingPath -string "/ema"` 후 launch → /ema 직행해야 정상.
- **AlarmKit 예약 성공 판정**: 앱 컨테이너 plist에 `runlab.alarmkit.ids` 존재 확인 (`simctl get_app_container ... data` → `Library/Preferences/com.snuyoon.runlab.plist`). Swift `print()`는 `log stream`에 안 잡힘.
- 시뮬레이터는 잠금화면 알람 발화가 불안정(알려진 버그) — 발화·소리는 실기기에서만 최종 확인.

## 문서 지도

- [docs/DEVLOG.md](docs/DEVLOG.md) — 작업 경과, 의사결정과 근거, 알려진 이슈, 다음 할 일 ← **새 세션 필독**
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 웹/백엔드/관리자/iOS 전체 구조, 브리지 프로토콜, 데이터 모델
- [docs/OSTRC.md](docs/OSTRC.md) — OSTRC-H2 구현 규칙 (게이트키퍼, 점수, 반복 연결) + 문헌 근거
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — 연구자 운영 가이드 (참여자 관리, 원격 초기화, 경고 패널 기준, TestFlight 배포)
- [docs/파일럿테스트_체크리스트.md](docs/파일럿테스트_체크리스트.md) — 실기기 검수 절차
- [ios/README-iOS.md](ios/README-iOS.md) — iOS 빌드/서명/배포
- [android/README-Android.md](android/README-Android.md) — Android 빌드/구조/Play 배포(내부 테스트)·리스크
