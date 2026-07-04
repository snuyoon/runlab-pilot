import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RunLab 개인정보 처리방침",
  description: "RunLab 러닝 연구 파일럿 앱의 개인정보 처리방침",
};

// 정적 문서 페이지 — App Store 심사에 필요한 개인정보 처리방침 URL(/privacy)
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-slate-800 leading-relaxed">
      <h1 className="text-2xl font-bold mb-2">RunLab 개인정보 처리방침</h1>
      <p className="text-sm text-slate-500 mb-8">시행일: 2026년 7월 4일</p>

      <p className="mb-6">
        RunLab(이하 &ldquo;앱&rdquo;)은 러닝 연구를 위한 파일럿 앱으로, 연구 참여자의 응답
        데이터를 수집합니다. 본 방침은 앱이 어떤 정보를 어떻게 수집·이용·보관하는지 설명합니다.
      </p>

      <Section title="1. 수집하는 정보">
        <ul className="list-disc pl-5 space-y-1">
          <li>연구 참여 코드(연구팀이 배부한 식별 코드) 및 알람 설정값</li>
          <li>기상 직후 설문(EMA): 수면의 질, 피로도, 기분</li>
          <li>러닝 세션 강도(RPE)와 메모</li>
          <li>주간 건강 설문(OSTRC): 부상·질병·정신건강 관련 자가보고 응답</li>
          <li>수면 로그: 취침·기상(알람 해제) 시각</li>
          <li>러닝 기록: (연동 시) Apple 건강 앱을 통한 러닝 거리·페이스·심박</li>
          <li>신체 정보: 성별·나이·체중 등 연구에 필요한 기초 정보</li>
        </ul>
        <p className="mt-3">
          앱은 이름·전화번호·이메일 등 직접적인 신원 정보를 수집하지 않으며, 참여자는 연구팀이
          배부한 코드로만 식별됩니다.
        </p>
      </Section>

      <Section title="2. 이용 목적">
        <p>
          수집된 정보는 <strong>운동 중 무채혈 연속혈당기 기반 에너지 소모량 분석 연구</strong>
          (KAIST 생명윤리심의위원회 승인, 승인번호 KH2023-250) 목적으로만 이용됩니다. 광고,
          마케팅, 프로파일링, 자동화된 의사결정에 사용하지 않습니다.
        </p>
      </Section>

      <Section title="3. 보관 및 처리">
        <p>
          응답 데이터는 연구용 데이터베이스(클라우드 인프라)에 저장되며, 응답 전송 전에는
          참여자 기기 내부 저장소(localStorage)에 보관됩니다. 접근은 연구 책임자와 승인된
          연구원으로 제한됩니다.
        </p>
      </Section>

      <Section title="4. 제3자 제공">
        <p>
          수집한 정보를 타 연구자에게 임의로 제공하지 않으며, 제공이 필요한 경우 익명화 후 KAIST
          생명윤리심의위원회의 별도 심의를 거칩니다. 법령에 의한 경우를 제외하고 제3자에게
          판매·제공하지 않으며, 광고 네트워크나 추적(트래킹) 목적의 제3자와 공유하지 않습니다.
        </p>
      </Section>

      <Section title="5. 보관 기간 및 파기">
        <p>
          데이터는 연구 종료 후 3년간 보관한 뒤 파기(파쇄 및 데이터 삭제)합니다. 참여자는
          언제든지 참여를 중단할 수 있으며, 요청 시 본인의 데이터 삭제를 요청할 수 있습니다.
        </p>
      </Section>

      <Section title="6. 참여자의 권리">
        <p>
          참여자는 본인 데이터의 열람·정정·삭제 및 처리 중단을 요청할 수 있습니다. 요청은 아래
          연락처로 접수합니다.
        </p>
      </Section>

      <Section title="7. 문의처">
        <p>
          연구책임자: 박수경 교수(KAIST 기계공학과) · 이메일{" "}
          <a href="mailto:sukyungp@kaist.ac.kr" className="text-indigo-600 underline">
            sukyungp@kaist.ac.kr
          </a>
        </p>
        <p className="mt-1">담당 연구자: 박근아 · ☎ 042-350-3271</p>
        <p className="mt-1">
          KAIST 생명윤리심의위원회(IRB) 행정간사 · ☎ 042-350-2189 (승인번호 KH2023-250)
        </p>
      </Section>

      <p className="mt-10 text-xs text-slate-400">
        본 방침은 연구 진행에 따라 변경될 수 있으며, 변경 시 본 페이지에 게시합니다.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="text-[15px]">{children}</div>
    </section>
  );
}
