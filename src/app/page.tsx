"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { loadData, saveSettings, applyRemoteReset } from "@/store/studyStore";
import { isNativeApp, nativeCancelAlarm, nativeSetParticipant } from "@/lib/native";

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [shaking, setShaking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const fail = (msg: string) => {
    setError(msg);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  };

  // 사전 등록된 코드만 통과 (서버 검증) — 쓰레기 데이터 방지
  const handleLogin = async () => {
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 2 || checking) {
      if (normalized.length < 2) fail("참여 코드를 입력해주세요");
      return;
    }
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const json = await res.json();
      if (!json.valid) {
        fail("등록되지 않은 참여 코드입니다. 연구자에게 문의해주세요.");
        return;
      }
      const current = loadData().settings;
      const codeChanged = current.participantCode !== normalized;
      const serverResetAt = typeof json.resetAt === "string" ? json.resetAt : "";
      // 다른 코드로 로그인하거나(기기 공유/계정 전환) 관리자 원격 초기화가
      // 걸려 있으면 이전 로컬 기록을 비우고 새로 시작한다
      if (codeChanged || serverResetAt !== current.lastResetAck) {
        applyRemoteReset(serverResetAt);
      }
      // 기기 공유/계정 전환: 이전 참여자의 시스템 알람이 계속 울리지 않도록 취소
      // (원격 초기화는 같은 참여자의 계속 진행이므로 알람 유지)
      if (codeChanged && current.participantCode && isNativeApp()) {
        nativeCancelAlarm();
      }
      if (isNativeApp()) {
        nativeSetParticipant(normalized);
      }
      saveSettings({
        participantCode: normalized,
        participantLabel: typeof json.label === "string" ? json.label : "",
        enrolledAt: codeChanged ? new Date().toISOString() : current.enrolledAt || new Date().toISOString(),
        lastResetAck: serverResetAt,
      });
      router.push("/home");
    } catch {
      fail("네트워크 연결을 확인한 뒤 다시 시도해주세요.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mobile-frame flex flex-col items-center justify-center px-8 bg-gradient-to-b from-emerald-50 to-sky-50">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-sm"
      >
        <motion.div
          className="text-center mb-12"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        >
          <div className="text-6xl mb-4">🏃‍♂️</div>
          <h1 className="text-3xl font-bold text-slate-800">RunLab</h1>
          <p className="text-slate-500 mt-2 text-sm">
            AI 스마트 러닝워치 연구
          </p>
        </motion.div>

        <motion.div
          animate={shaking ? { x: [0, -10, 10, -10, 10, 0] } : {}}
          transition={{ duration: 0.4 }}
        >
          <label className="block text-sm font-medium text-slate-600 mb-2">
            연구 참여 코드
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="예: SNU-001"
            className="w-full px-4 py-4 text-lg text-center tracking-widest font-mono
              border-2 border-slate-200 rounded-2xl bg-white
              focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-100
              placeholder:text-slate-300 placeholder:tracking-normal placeholder:font-sans"
            autoFocus
          />
        </motion.div>

        <motion.button
          onClick={handleLogin}
          disabled={checking}
          className={`w-full mt-6 py-4 rounded-2xl text-lg font-semibold text-white
            bg-gradient-to-r from-emerald-500 to-teal-500
            active:scale-95 transition-transform ${checking ? "opacity-60" : ""}`}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          {checking ? "확인 중..." : "참여 시작하기"}
        </motion.button>

        <p className={`text-center text-xs mt-6 ${error ? "text-red-500 font-semibold" : "text-slate-400"}`}>
          {error || "연구 참여 안내에서 받은 코드를 입력해주세요"}
        </p>
      </motion.div>
    </div>
  );
}
