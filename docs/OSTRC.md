# OSTRC-H2 구현 규칙 (문헌 검증본)

이 프로젝트의 주간 건강 설문은 **IOC modified OSTRC-H2 한국어판**(KSOC 진천·평창 국가대표선수촌 의무팀 번역·문화적 적응 최종판, 2025)을 사용한다.
문항 데이터: [`src/data/ostrc.ts`](../src/data/ostrc.ts) · 위저드: [`src/app/ostrc/page.tsx`](../src/app/ostrc/page.tsx) · 원문 PDF: 사용자 보관(OSTRC_Korean.pdf).

## ⚠️ 불변 규칙

**핵심 4문항(Q1~Q4)의 문구·선택지 4개·점수 체계를 절대 수정하지 않는다.**
원저자 권고: "we recommend that users retain the exact wording and scoring of the four key questions." (Clarsen 2020)
입력 UX 변경은 허용되나(현재 SnapSlider 드래그), 선택지는 공식 4개에 스냅되어야 한다.

## 게이트키퍼 로직 (공식 — Clarsen et al. 2020, BJSM 54:390-396)

| Q1 응답 | 동작 |
|---|---|
| ① 건강 문제없이 완전히 참여 | **Q2~Q4 스킵, 설문 종료.** 총 심각도 0. (문제 레코드 생성 안 함 — `noProblem: true`) |
| ②/③ | Q2 → Q3 → Q4 순차 응답 |
| ④ 건강 문제로 인해 참여하지 못함 | **Q2~Q4 전부 스킵**(q2/q3/q4 = null 저장), **총 심각도 100 자동 부여**, 분류 문항으로 직행 |

원문: "If an athlete selects the first answer option 'full participation without health problems', all further questions are redundant. In this case, a total severity score of 0 is assigned and the questionnaire is complete. / If an athlete selects the fourth answer option 'could not participate due to a health problem', questions 2–4 are redundant. In this case, a total severity score of 100 is assigned."

주의: Q1=④일 때 "각 문항에 25점"이 아니라 **총점 100을 통째로** 부여한다 (공식 R 패키지 ostRc는 25로 합산하는 불일치가 있음 — 우리는 논문 원문을 따름).

## 점수 체계

- 각 문항 선택지 인덱스(0~3) → 점수 `[0, 8, 17, 25]` (`OSTRC_SCORES`)
- **심각도(severityScore)** = Q1~Q4 합산 0~100. 게이트키퍼: Q1=①→0, Q1=④→100
- **substantial(중대한 문제)** = Q1=④ **또는** Q2/Q3에서 3·4번째 선택지(인덱스 ≥2)
- **주간 유병률** = 문제 보고 참여자 수 ÷ 해당 주 OSTRC 응답자 수
- 심각도 점수에 대한 임상 개입 컷오프는 **문헌에 존재하지 않음** — 표시/추세용으로만 사용 (개입 우선순위는 substantial)

## 설문 흐름 (문제 단위 반복)

```
인트로 → Q1 (게이트키퍼 분기)
  → [Q2 → Q3 → Q4]
  → 이전 보고 문제인가? (이전 주 문제 목록 존재 시)
      ├ 기존 문제 선택 → 분류 스킵, recurrenceOfId = 루트 문제 id → 시간 손실
      └ 새로운 문제 → Q5 유형 (부상/질병/정신 건강)
            ├ 부상 → 부위(19개 범주)
            ├ 질병 → 증상군(14개 범주)
            └ 정신 건강 → MH-1 ~ MH-6
  → 시간 손실 (지난 7일 중 완전히 쉰 날 0~7일)
  → "다른 건강 문제가 있으셨습니까?" → 예: Q1부터 반복 / 아니요: 제출
```

- **반복 문제 연결(recurrence)**: 같은 문제를 주 단위로 이어 추적 — `recurrenceOfId`는 항상 **루트 문제 id** (체인은 `priorProblems()`가 루트로 병합). 노르웨이 올림픽위 운용판(Clarsen 2021 부록 Q5)과 동일 구조. 지속 주 수(weeks reported)가 만성화 지표.
- **같은 세션 내 중복 보고 방지(2026-07-04)**: ① 정신 건강은 주간 배터리라 **1회 보고 후 Q5에서 제외**. ② 부상/질병은 복수 허용(무릎+발목 등 — 원판의 문제 단위 반복 유지)하되 **이미 보고한 부위/증상군만 목록에서 제외**(진짜 중복 차단). ③ 반복 연결 후보도 이번 세션에 쓴 루트는 제외. ④ 반복 회차 Q1에 **"더 보고할 문제 없음 — 지금까지 응답 제출" 탈출 버튼** — '예(또 있음)' 오탭 시 빠져나오는 명시적 경로(기존에는 Q1=①이 숨은 탈출구였음).
- **시간 손실**: IOC 표준 보조 심각도 지표. 분류 문항들은 논문상 "연구자 커스터마이즈 영역"이라 추가가 허용됨.
- 여러 문제 등록 시 **문제마다 Q1~Q4 반복** (원판 2013 논문 명시).
- 작성 중 이탈 대비: "예(다른 문제)" 선택 시점마다 완료된 문제들을 `runlab-ostrc-draft-v1`(localStorage)에 저장, 재진입 시 복원, 제출 시 삭제.
- 실시 주기: 매주 월요일(주 시작) 팝업, 완료 전까지 지속 노출. 미응답 경고는 +3일(목요일)부터 — 원조 운용 리마인더 관행.

## 데이터 저장 형태

`OSTRCResponse { id, weekKey(해당 주 월요일), noProblem, problems[], completedAt }`
`OSTRCProblem { id, label, q1, q2|null, q3|null, q4|null, severityScore, substantial, type(injury|illness|mental), bodyArea, illnessCategory, mh{mh1[]…mh6}, recurrenceOfId|null, timeLossDays|null }`

## 근거 문헌

- Clarsen B, et al. **Improved reporting of overuse injuries and health problems in sport** (OSTRC-O2/H2 업데이트). *Br J Sports Med* 2020;54:390-396. doi:10.1136/bjsports-2019-101337 — 게이트키퍼·점수·문구 유지 권고
- Clarsen B, et al. **Methods, challenges and benefits of a health monitoring programme…** *BJSM* 2021 — 실제 운용 흐름(반복 연결, 시간 손실, 전건 의료진 알림), 부록에 전체 문항·분기표
- Beaudart C, et al. 프랑스어판 OSTRC-H2 검증 (PMC10280517) — Q1=④→100, Q2-4 미응답 구현 교차 확인
- 일본어판 업데이트 (PLOS ONE, PMC8016239) — 게이트키퍼 로직 재확인
- KSOC 한국어판 번역 보고서 (OSTRC_Korean.pdf) — 사용 문항의 원천
