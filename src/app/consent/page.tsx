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
        <h1 className="text-xl font-bold text-slate-800">연구 참여 동의</h1>
        <p className="text-sm text-slate-500 mt-1">
          RunLab — AI 스마트 러닝워치 연구
        </p>
      </div>

      {/* 동의 문서 (스크롤) */}
      <div className="flex-1 overflow-y-auto px-6 py-5 text-[14px] leading-relaxed text-slate-700">
        <p className="mb-5">
          아래 내용을 충분히 읽어보신 뒤, 자발적으로 연구 참여에 동의해주세요. 동의는 언제든지
          철회할 수 있습니다.
        </p>

        <ConsentSection title="1. 연구의 성격과 목적">
          본 연구는 서울대학교 연구팀이 수행하는 <strong>러닝 부상 예방 및 컨디션 모니터링에
          관한 파일럿 연구</strong>입니다. 스마트폰 앱과 러닝워치로 수집한 훈련·수면·건강 지표를
          분석하여, 러너의 부상 위험과 컨디션 변화를 조기에 파악하는 방법을 탐색하는 것이
          목적입니다.
        </ConsentSection>

        <ConsentSection title="2. 참여 기간과 절차">
          <p className="mb-2">
            참여 기간은 연구팀이 별도로 안내한 파일럿 테스트 기간 동안입니다. 참여하시면 이 앱을
            통해 아래 활동을 하시게 됩니다.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>기상 직후 간단한 설문(수면의 질·피로도·기분) 응답</li>
            <li>러닝 세션 후 운동 강도(RPE)와 메모 입력</li>
            <li>매주 1회 주간 건강 설문(OSTRC — 부상·질병·정신건강 자가보고)</li>
            <li>취침·기상 시각 기록 및 앱 알람 사용</li>
            <li>
              (선택) 러닝워치를 Apple 건강 앱에 연동하면 러닝 거리·페이스·심박 등 운동 기록이
              자동으로 수집됩니다.
            </li>
          </ul>
        </ConsentSection>

        <ConsentSection title="3. 수집하는 정보">
          <p className="mb-2">
            연구 참여 코드(연구팀이 배부한 식별 코드), 위 활동에서 입력·측정된 설문·훈련·수면·건강
            데이터를 수집합니다. 앱은 <strong>이름·전화번호·이메일 등 직접적인 신원 정보를 수집하지
            않으며</strong>, 참여자는 배부된 코드로만 식별됩니다.
          </p>
        </ConsentSection>

        <ConsentSection title="4. 위험과 이익">
          <p className="mb-2">
            본 연구는 최소 위험 연구입니다. 설문 응답에 약간의 시간이 필요하며, 부상·정신건강 관련
            문항이 일부 불편하게 느껴질 수 있습니다. 응답하고 싶지 않은 문항은 건너뛰거나 참여를
            중단하실 수 있습니다.
          </p>
          <p>
            참여로 인한 직접적인 이익은 없을 수 있으나, 수집된 정보는 러너의 부상 예방과 건강 관리
            방법을 개선하는 연구에 기여합니다.
          </p>
        </ConsentSection>

        <ConsentSection title="5. 기밀 유지와 데이터 처리">
          <p className="mb-2">
            응답 데이터는 연구용 데이터베이스(클라우드 인프라)에 저장되며, 전송 전에는 참여자 기기
            내부에 보관됩니다. 데이터 접근은 연구 책임자와 승인된 연구원으로 제한됩니다.
          </p>
          <p>
            수집한 정보는 법령에 의한 경우를 제외하고 <strong>제3자에게 판매·제공하지 않으며</strong>,
            광고·추적 목적의 제3자와 공유하지 않습니다. 데이터는 연구 종료·분석에 필요한 기간 동안
            보관 후 파기하거나 익명화합니다. 자세한 내용은{" "}
            <a href="/privacy" className="text-indigo-600 underline">
              개인정보 처리방침
            </a>
            을 참고하세요.
          </p>
        </ConsentSection>

        <ConsentSection title="6. 자발적 참여와 철회">
          참여는 전적으로 자발적입니다. 참여를 거부하거나 중간에 중단하셔도 어떠한 불이익도 없습니다.
          언제든지 앱 사용을 중단하거나 아래 연락처로 연락해 참여 철회 및 본인 데이터의 삭제를 요청할
          수 있습니다.
        </ConsentSection>

        <ConsentSection title="7. 문의처">
          연구 책임: 서울대학교 연구팀 · 이메일{" "}
          <a href="mailto:snuyoon@snu.ac.kr" className="text-indigo-600 underline">
            snuyoon@snu.ac.kr
          </a>
        </ConsentSection>

        <ConsentSection title="8. 연구윤리 심의">
          본 연구는 서울대학교 생명윤리위원회(IRB)의 심의·승인을 받아 수행됩니다.
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
