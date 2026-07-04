"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { loadData, saveSettings, resetAll } from "@/store/studyStore";
import { isNativeApp, nativeCancelAlarm } from "@/lib/native";
import { useMounted } from "@/hooks/useMounted";

export default function ConsentPage() {
  const mounted = useMounted();
  if (!mounted) {
    return <div className="mobile-frame bg-slate-50" />;
  }
  return <ConsentInner />;
}

function ConsentInner() {
  const router = useRouter();
  // 진입 가드: 참여 코드가 없으면 로그인으로, 이미 동의했으면 홈으로.
  const [gate] = useState<string | null>(() => {
    const s = loadData().settings;
    if (s.participantCode === "") return "/";
    if (s.consentAt) return "/home";
    return null;
  });
  useEffect(() => {
    if (gate) router.replace(gate);
  }, [gate, router]);

  const [agreed, setAgreed] = useState(false);

  const accept = () => {
    if (!agreed) return;
    saveSettings({ consentAt: new Date().toISOString() });
    router.replace("/home");
  };

  const decline = () => {
    // 동의하지 않으면 참여를 시작하지 않는다 — 로컬 기록을 비우고 로그인 화면으로.
    if (isNativeApp()) nativeCancelAlarm();
    resetAll();
    router.replace("/");
  };

  if (gate) {
    return <div className="mobile-frame bg-slate-50" />;
  }

  return (
    <div className="mobile-frame bg-slate-50 flex flex-col">
      {/* 헤더 */}
      <div className="px-6 pt-8 pb-4 bg-white border-b border-slate-100">
        <div className="text-2xl mb-1">🏃‍♂️</div>
        <h1 className="text-xl font-bold text-slate-800">연구 참여 안내 및 동의</h1>
        <p className="text-sm text-slate-500 mt-1">인간대상연구 피험자 동의 (요약)</p>
      </div>

      {/* 동의 문서 (스크롤) */}
      <div className="flex-1 overflow-y-auto px-6 py-5 text-[14px] leading-relaxed text-slate-700">
        <p className="mb-4">
          아래는 본 연구의 주요 내용 요약입니다. 정식 서면 동의는 연구팀을 통해 별도로 진행되며,
          이 앱을 사용하기 전 아래 내용을 확인하고 참여에 동의해주세요. 동의는 언제든지 철회할 수
          있습니다.
        </p>

        {/* 기본 정보 카드 */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 mb-5 text-[13px] space-y-1">
          <InfoRow label="연구 과제명" value="운동 중 무채혈 연속혈당기 기반 에너지 소모량 분석" />
          <InfoRow label="연구책임자" value="박수경 (KAIST 기계공학과 교수)" />
          <InfoRow label="승인번호" value="KH2023-250 · IRB-25-042 (KAIST 생명윤리심의위원회)" />
        </div>

        <ConsentSection title="1. 연구의 배경과 목적">
          본 연구는 상용 웨어러블 센서(연속 혈당측정기, 심박계 등)로 측정한 운동·운동학 정보와
          생리 지표로부터 신체의 생리적 반응과 에너지 소모량을 추정하는 것을 목적으로 합니다.
          측정이 쉬운 지표로부터 운동 능력·컨디션을 파악하는 방법을 탐색합니다.
        </ConsentSection>

        <ConsentSection title="2. 참여 기간과 절차">
          <p className="mb-2">
            본 연구 기간은 2025년 8월부터 2026년 12월까지이며, 개별 참여 기간은 연구팀 안내를
            따릅니다. 건강한 성인을 대상으로 하며, 참여하시면 아래를 수행하시게 됩니다.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>주 2회 이상 정해진 실외 코스 러닝 및 지정 웨어러블 착용</li>
            <li>기상 직후 간단한 설문(수면의 질·피로도·기분) 응답</li>
            <li>러닝 세션 후 운동 강도(RPE)와 메모 입력</li>
            <li>매주 1회 주간 건강 설문(OSTRC — 부상·질병·정신건강 자가보고)</li>
            <li>취침·기상 시각 기록 및 앱 알람 사용</li>
            <li>
              러닝워치를 Apple 건강 앱에 연동하면 러닝 거리·페이스·심박 등 운동 기록이 자동으로
              수집됩니다.
            </li>
          </ul>
        </ConsentSection>

        <ConsentSection title="3. 수집하는 정보">
          <p>
            연구 참여 코드(연구팀이 배부한 식별 코드), 위 활동에서 입력·측정된 설문·훈련·수면·건강
            데이터 및 신체 정보(성별·나이·체중 등)를 수집합니다. 앱은{" "}
            <strong>이름·전화번호·이메일 등 직접적인 신원 정보를 수집하지 않으며</strong>,
            참여자는 배부된 코드로만 식별됩니다.
          </p>
        </ConsentSection>

        <ConsentSection title="4. 위험·이익 및 보상">
          <p className="mb-2">
            본 연구는 최소 위험 연구입니다. 보행·주행 중 낙상 위험과 센서 착용에 따른 불편감이 있을
            수 있으며, 부상·정신건강 관련 문항이 일부 불편하게 느껴질 수 있습니다. 사용하는 센서는
            침습적 처치나 유해 물질을 수반하지 않습니다.
          </p>
          <p className="mb-2">
            참여로 인한 직접적인 이익은 없을 수 있으나, 수집된 정보는 건강관리·운동 코칭을 위한
            생리 데이터 연구에 기여합니다.
          </p>
          <p>
            연구와 관련된 손상이 발생하면 응급처치를 제공하고 관련 치료비는 연구팀이 부담합니다.
            참여에 대한 참가비는 연구팀 안내에 따라 지급되며(연구 계획 기준 주당 약 1만원 수준),
            참여로 인한 별도 비용은 없습니다.
          </p>
        </ConsentSection>

        <ConsentSection title="5. 기밀 유지와 개인정보 처리">
          <p className="mb-2">
            귀하의 신원을 파악할 수 있는 기록은 비밀이 유지되며 공개적으로 열람되지 않습니다.
            응답 데이터는 연구용 데이터베이스에 저장되고, 접근은 연구책임자와 승인된 연구원으로
            제한됩니다.
          </p>
          <p>
            수집한 정보는 <strong>타 연구자에게 임의로 제공하지 않으며</strong>(제공이 필요한 경우
            익명화 후 KAIST 생명윤리심의위원회의 별도 심의를 거칩니다), 광고·추적 목적의 제3자와
            공유하지 않습니다. 데이터는 연구 종료 후 3년간 보관한 뒤 폐기합니다. 자세한 내용은{" "}
            <a href="/privacy" className="text-indigo-600 underline">
              개인정보 처리방침
            </a>
            을 참고하세요.
          </p>
        </ConsentSection>

        <ConsentSection title="6. 자발적 참여와 철회">
          참여는 전적으로 자발적입니다. 참여를 거부하거나 언제든 중단하셔도 어떠한 불이익이나
          차별도 받지 않습니다. 앱 사용을 중단하거나 아래 연구팀 연락처로 연락해 참여 철회 및 본인
          데이터의 삭제를 요청할 수 있습니다.
        </ConsentSection>

        <ConsentSection title="7. 문의 및 연락처">
          <div className="space-y-0.5">
            <p>담당 연구자: 박근아 · ☎ 042-350-3271</p>
            <p>
              연구책임자: 박수경 교수 ·{" "}
              <a href="mailto:sukyungp@kaist.ac.kr" className="text-indigo-600 underline">
                sukyungp@kaist.ac.kr
              </a>
            </p>
            <p>KAIST 생명윤리심의위원회(IRB) 행정간사 · ☎ 042-350-2189</p>
          </div>
        </ConsentSection>

        <ConsentSection title="8. 연구윤리 심의">
          본 연구는 KAIST 생명윤리심의위원회(IRB)의 심의·승인(승인번호 KH2023-250)을 받아
          수행됩니다.
        </ConsentSection>

        {/* 동의 체크 */}
        <button
          onClick={() => setAgreed((v) => !v)}
          className="flex items-start gap-3 w-full text-left mt-2 mb-1"
        >
          <span
            className={`mt-0.5 shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center text-white text-sm transition-colors
              ${agreed ? "bg-indigo-500 border-indigo-500" : "bg-white border-slate-300"}`}
          >
            {agreed ? "✓" : ""}
          </span>
          <span className="text-[14px] font-medium text-slate-800 leading-snug">
            위 내용을 읽고 이해했으며, 자발적으로 연구 참여에 동의합니다.
          </span>
        </button>
      </div>

      {/* 하단 버튼 */}
      <div className="px-6 py-4 bg-white border-t border-slate-100 space-y-2">
        <motion.button
          onClick={accept}
          disabled={!agreed}
          whileTap={agreed ? { scale: 0.97 } : undefined}
          className={`w-full py-4 rounded-2xl text-lg font-semibold text-white transition-colors
            ${agreed ? "bg-indigo-500" : "bg-slate-300"}`}
        >
          동의하고 시작하기
        </motion.button>
        <button
          onClick={decline}
          className="w-full py-3 rounded-2xl text-sm font-medium text-slate-500"
        >
          동의하지 않음 (참여 취소)
        </button>
      </div>
    </div>
  );
}

function ConsentSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h2 className="text-[15px] font-bold text-slate-800 mb-1.5">{title}</h2>
      <div className="text-slate-600">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-20 text-slate-400 font-medium">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}
