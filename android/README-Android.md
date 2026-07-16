# RunLab Android 네이티브 앱

기존 웹앱(runlab-pilot.vercel.app)을 감싸는 **WebView 셸 + 진짜 기상 알람 + Health Connect 러닝 연동**.
iOS 앱과 동일한 웹/백엔드를 재사용하며, 네이티브 브리지 프로토콜도 iOS와 공유한다(`src/lib/native.ts`).

## 왜 네이티브인가 (iOS와 동일 논리)

| | 모바일 웹(PWA) | 네이티브 앱 |
|---|---|---|
| 알람 | 화면 켠 채 대기, 앱 닫으면 안 울림 | **앱을 꺼도·재부팅해도 울림** (setAlarmClock, Doze 관통) |
| 잠금화면 | 불가 | **전체화면 알람 UI**(showWhenLocked) + 소리·진동 |
| 러닝 데이터 | 수동 입력 | **Health Connect**에서 가민 러닝 자동 유입 |

## 구조

```
안드로이드 앱 (Kotlin / View 기반)
├── MainActivity ─────── WebView 로 runlab-pilot.vercel.app 로드
│     · domStorage 영속(localStorage 유지), UA 접미사 "RunLabNative/1.0"
│     · JS 브리지: window.RunLabAndroid.postMessage(json)  (addJavascriptInterface)
│     · 네이티브→웹: webView.evaluateJavascript(window.__runlab*(json))
│     · Health Connect 권한 요청·러닝 세션 조회·전달
├── alarm/
│     · AlarmScheduler ── setAlarmClock() 예약(정확·Doze 관통), 발화 시 다음 회차 재예약
│     · AlarmReceiver ─── 발화 수신 → 전체화면 알림 게시 + 재예약
│     · AlarmActivity ─── 잠금화면 위 알람 UI, 소리 반복·진동, '끄기'→기상설문(/ema)
│     · BootReceiver ──── 재부팅/업데이트 후 저장된 알람 재예약
└── health/HealthConnectManager ── 러닝 ExerciseSession(거리·심박) 집계 (가민 writer 한정)
```

## 갤럭시에서 알람이 확실히 울리게 (중요)

`setAlarmClock`은 Doze를 관통하지만, **삼성의 "앱 절전"이 밤새 알람을 죽이는 최상위 원인**이고 이걸 켜고 끄는 공개 API가 없다. 앱은 첫 실행 시 `maybeShowReliabilityGuide`로 안내하지만, 참여자가 아래를 **한 번** 설정해야 확실하다:

1. **설정 → 배터리 → 백그라운드 사용 제한**: "사용 안 하는 앱을 절전" **끄기**, "절전 안 함 앱"에 **RunLab 추가**. (OTA 업데이트가 초기화할 수 있어 재확인 권장)
2. **알림 권한 허용**(미허용 시 알람이 조용히 실패), Android 14+는 **전체 화면 알람** 허용.
3. 배터리 최적화에서 RunLab을 "최적화 안 함". (앱은 Play 정책상 직접 프롬프트 대신 설정 화면으로만 안내)

> **웹 링크(브라우저)로는 백그라운드 알람이 원천적으로 불가능**하다(화면 켜둔 `/sleep`만 동작). 반드시 네이티브 APK를 설치해야 "취침하기 없이, 앱을 닫아도" 울린다.

## 러닝 세션 중복 방지

한 번의 러닝이 여러 소스(가민·애플워치·타 앱)로 Health Connect/Apple 건강에 각각 기록되면 UUID만 다른 중복이 생긴다. 방지책 2단계: ① Android는 Health Connect 읽기를 **가민 Connect 패키지(`com.garmin.android.apps.connectmobile`)로 한정**(`dataOriginFilter`). ② 공통(웹) `addWorkoutSession`이 UUID 중복 외에 **시간 구간이 겹치는 세션**도 같은 러닝으로 보고 건너뛴다(러닝은 동시 불가). 웹 로직이라 **라이브 iOS 앱도 Vercel 배포만으로 즉시 교정**된다(앱 재심사 불필요).

웹은 `src/lib/native.ts`가 `window.RunLabAndroid`(Android) 또는
`window.webkit.messageHandlers.runlab`(iOS)를 자동 감지해 동일 메시지(`syncAlarms`/`cancelAll`/
`setParticipant`/`getAlarmDiag`/`requestHealthKit`/`healthKitSync`)를 보낸다. 콜백
(`window.__runlabAlarmResult`, `window.__runlabWorkout`)은 두 플랫폼 공통.

## 기술 결정 (2024–2025 문서 검증)

- **알람 API: `AlarmManager.setAlarmClock()`** — Doze에서도 정확 발화, 스로틀 없음, 상태바 알람 아이콘.
  1회성이라 발화 시 `AlarmReceiver`가 다음 회차를 재예약(주간 반복 구현), 부팅 시 전체 재예약.
- **정확 알람 권한: `USE_EXACT_ALARM`** (SCHEDULE_EXACT_ALARM 아님) — 설치 시 자동 승인·해지 불가.
  ⚠️ `setAlarmClock()`은 **더 이상 권한 면제가 아님**(Android 12 초기 면제는 폐지). 알람앱이므로 Play 제한 권한 통과.
- **잠금화면 UI: full-screen intent** — 발화 → `IMPORTANCE_HIGH`+`CATEGORY_ALARM` 알림에
  `setFullScreenIntent(pi, true)` → 시스템이 `AlarmActivity` 실행(`setShowWhenLocked`/`setTurnScreenOn`).
  백그라운드 리시버에서 직접 액티비티 실행은 금지되므로 알림 경로가 정석.
  권한 3종 필수: `USE_EXACT_ALARM` + `USE_FULL_SCREEN_INTENT` + `POST_NOTIFICATIONS`(API 33+ 미승인 시 FSI 무발화).
- **Health Connect: `androidx.health.connect:connect-client:1.1.0`** — `getSdkStatus()` 확인 →
  `PermissionController` 계약으로 권한 요청 → `getGrantedPermissions()` 재확인 →
  `ExerciseSessionRecord`(EXERCISE_TYPE_RUNNING) 읽고 세션 구간별 `DistanceRecord.DISTANCE_TOTAL`·
  `HeartRateRecord.BPM_AVG` 집계. 읽기 전용, 백그라운드/이력 권한 미사용(파일럿).

## 빌드

```bash
# 사전: JDK 17 + Android SDK(platform 36, build-tools 36) 필요. 이 저장소는 아래로 준비됨.
# 툴체인: AGP 8.9.1 · Gradle 8.11.1(래퍼) · Kotlin 2.0.21 · compileSdk 36 · minSdk 26 · JDK 17
#   brew install openjdk@17
#   brew install --cask android-commandlinetools
#   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
# local.properties 의 sdk.dir 를 본인 SDK 경로로 맞출 것.

cd android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17    # 시스템 gradle(9.x)이 아니라 래퍼(8.11.1)+JDK17 사용
./gradlew assembleDebug                            # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease                          # 서명 설정 후 → aab/apk (Play 업로드용은 bundleRelease)
```

Android Studio를 쓰면 `android/` 폴더를 열어 Run ▶ 하면 된다(에뮬레이터/실기기).

버전: `app/build.gradle.kts`의 `versionCode`/`versionName` 단일 소스. 재업로드 시 `versionCode` 증가.

## 실기기 테스트 (필수)

1. 앱 로그인 → 알람 설정(2~3분 뒤). 첫 실행 시 **알림 권한** 팝업 허용, Android 14+는 **전체화면 알람** 설정 안내 → 허용.
2. **앱을 완전히 종료**하고 화면을 끈다.
3. 설정 시각에 잠금화면에 전체화면 알람이 떠야 함(소리 반복·진동).
4. '끄고 기상 설문 시작' → 잠금 해제 후 앱이 열리며 기상 설문(/ema)로 이동.
5. Health Connect: 홈의 '가민·건강 연동' → Health Connect 권한 화면에서 러닝/거리/심박 허용 →
   가민 러닝이 Garmin Connect→Health Connect 로 들어온 뒤 앱 진입 시 자동 유입.
- ⚠️ **OEM 배터리 최적화**(삼성/샤오미 등)가 앱을 죽이면 알람이 누락될 수 있음 → 참여자 기기에서
  "배터리 최적화 제외" 설정 권장, 대상 OEM별로 콜드 상태 발화 확인.
- ⚠️ Health Connect 미설치(Android 13 이하)면 Play에서 설치 필요 — 앱이 스토어로 안내.

## 참여자 배포 (Google Play — 내부 테스트)

- **Google Play Console 개발자 등록**: 1회 **$25**(애플 $99/년과 달리 영구). 가능하면 대학/기관 계정 사용.
- **내부 테스트(Internal testing) 트랙**: 최대 100명, 몇 분 내 반영, 공개 목록 비노출,
  신규 개인계정의 12명·14일 프로덕션 요건을 우회. 연구원 이메일을 테스터 목록에 추가 → 링크 공유.
- 제출 준비물:
  - **개인정보 처리방침 URL**: https://runlab-pilot.vercel.app/privacy (이미 게시).
  - **데이터 안전(Data safety) 양식** + **건강 앱 선언**(카테고리: 인간대상연구 Human subjects research).
  - **정확 알람 선언**: `USE_EXACT_ALARM` 사용 사유(알람 시계 핵심 기능) 기재.
  - Health Connect 권한 근거 화면(rationale)은 앱이 `/privacy`로 응답하도록 매니페스트에 연결됨.
- 웹뷰 래퍼 반려 위험은 **네이티브 알람 + Health Connect**라는 브라우저 불가 기능으로 완화됨.
  심사 노트에 "연구 참여자용, 네이티브 기상 알람 + 웹 기반 설문 + Health Connect 러닝 연동" 명시 권장.

## 알려진 리스크 / 미검증

- 실기기 **알람 발화·소리·진동**은 이 환경에서 미검증(빌드까지 검증). 실기기에서 최종 확인 필요.
- 커스텀 알람음 5종 중 radar/chime/bell/digital 원음이 없으면 **기본 알람음**으로 폴백.
  `app/src/main/res/raw/<radar|chime|bell|digital>.ogg` 를 넣으면 해당 음 사용.
- OEM 배터리 관리로 인한 알람 누락(위 참조).
- Garmin→Health Connect 유입 지연/정합성은 실기기·실계정에서 확인 필요.
```
