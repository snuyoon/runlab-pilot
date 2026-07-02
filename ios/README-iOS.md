# RunLab iOS 네이티브 앱

기존 웹앱(runlab-pilot.vercel.app)을 감싸는 네이티브 셸 + **진짜 기상 알람**.

## 왜 네이티브인가

| | 웹(PWA) | 네이티브 앱 |
|---|---|---|
| 알람 | 화면 켠 채 충전 필수, 앱 닫으면 안 울림 | **앱을 꺼도 울림** (시스템 알람) |
| 무음 모드 | 소리 안 날 수 있음 | **무음·집중 모드 관통** (AlarmKit 공식 보장) |
| 알람 UI | 페이지 안 슬라이더 | 잠금화면 시스템 알람 + "설문 시작" 버튼 |

## 구조

```
아이폰 앱 (SwiftUI)
├── WebShellView (WKWebView) ─── runlab-pilot.vercel.app 로드
│     · localStorage 영속 (로그인/기록 유지)
│     · JS 브리지: window.webkit.messageHandlers.runlab
├── AlarmService
│     · iOS 26.1+  → AlarmKit 시스템 알람 (무음 관통, 앱 종료돼도 울림)
│     · iOS 26.1미만 → 로컬 알림 폴백 (1분 간격 10회)
└── OpenSurveyIntent — 알람의 "설문 시작" 버튼 → 앱 열고 /ema로 이동
```

웹 쪽은 네이티브 셸을 자동 감지해서(`src/lib/native.ts`) 알람 저장/취침 시작 시
네이티브 알람을 예약하고, "화면 켜두세요" 안내 대신 "앱을 닫아도 울려요"를 보여준다.
설문·데이터 수집·관리자 화면은 전부 기존 웹/백엔드 그대로 재사용.

## 빌드 방법

1. **Xcode 26.x 필요** — AlarmKit은 iOS 26 SDK에만 있어서 Xcode 26 이상으로 빌드해야
   한다 (Xcode 16.4는 이미 설치돼 있고 폴백 경로 빌드 검증까지 끝났지만, 16.4로 최종
   빌드하면 AlarmKit이 빠진 앱이 됨). 이 Mac(macOS 15.3.2) 기준 두 경로 (2026-07 확인):
   - **A. macOS 15.7.7 업데이트 (6GB, 마이너)** → Xcode **26.3** 설치 (Sequoia 15.6+에서
     도는 마지막 26.x, iOS 26.2 SDK — AlarmKit 컴파일 가능). App Store가 26.3을 안 주면
     developer.apple.com/download/all 에서 Xcode 26.3 xip 직접 다운로드.
   - **B. macOS Tahoe 26.5.2 업그레이드 (10.5GB, 메이저)** → App Store 최신 Xcode 26.6.
     (Xcode 26.4+는 Tahoe 26.2+ 필수)
   설치 후 한 번 실행해 추가 컴포넌트(iOS 플랫폼) 설치.
2. 프로젝트 열기:
   ```bash
   open ios/RunLab.xcodeproj
   ```
   (프로젝트 정의를 바꿨으면 `cd ios && xcodegen generate`로 재생성 — `brew install xcodegen`)
3. **서명**: 프로젝트 → Signing & Capabilities → Team에서 본인 Apple ID 선택
   (Xcode > Settings > Accounts에서 Apple ID 추가). Bundle ID `com.snuyoon.runlab`.
4. 아이폰을 USB로 연결(또는 같은 Wi-Fi 무선 연결) → 상단 기기 선택 → ▶ Run.
   첫 실행 시 아이폰에서 설정 > 일반 > VPN 및 기기 관리 > 개발자 앱 신뢰.

## 알람 테스트 (실기기 필수)

1. 앱에서 로그인 → 알람 설정 → 2~3분 뒤 시각 저장 (이때 알람 권한 팝업 → 허용)
2. **앱을 완전히 종료**하고 화면을 꺼둔다
3. 설정 시각에 잠금화면에 시스템 알람이 떠야 함 (무음 스위치 켜도 소리 남)
4. "설문 시작" 버튼 → 앱이 열리며 기상 설문으로 이동
- ⚠️ 시뮬레이터는 잠금화면 알람 버그가 있어 실기기에서 확인할 것 (iOS 26.1+ 시뮬레이터 이슈)
- AlarmKit 경로는 **iOS 26.1 이상**에서 동작 (26.0의 stopButton 이니셜라이저가 26.1에서
  deprecated돼 현행 API 기준으로 작성 — 26.0 이하 기기는 폴백). 참여자 아이폰이 26.1
  미만이면 폴백(반복 알림)으로 동작 — 파일럿 안내문에 "iOS 26.1 이상으로 업데이트" 권장

## 참여자 배포 (TestFlight)

- **Apple Developer Program 필요** ($99/년). 대학(공인 교육기관) **기관 명의로 등록하면
  수수료 면제 신청 가능** (developer.apple.com/support/membership-fee-waiver, D-U-N-S 필요,
  무료 앱 전용). 개인 명의는 $99.
- 절차: App Store Connect에 앱 생성 → Xcode에서 Product > Archive > Distribute →
  TestFlight 외부 테스터 그룹 생성 → 참여자 이메일 초대
  - 첫 빌드는 베타 심사 통과 필요 (통상 24~48시간)
  - 참여자는 TestFlight 앱 설치 → 초대 수락 → RunLab 설치
  - **빌드는 90일 후 만료** — 파일럿이 90일 넘으면 재업로드
- 무료 Apple ID로는 본인 기기 테스트만 가능 (7일마다 재설치 필요, 기기 3대) —
  개발 확인용으로만 사용

## 앱 심사 참고 (Guideline 4.2)

웹뷰 래퍼 단독이면 리젝 가능성이 있으나, 시스템 알람(AlarmKit)이라는 브라우저가
못 하는 네이티브 핵심 기능이 있어 통과 요건에 부합. 심사 노트에
"연구 참여자용 앱, 네이티브 기상 알람 + 웹 기반 설문" 명시 권장.
