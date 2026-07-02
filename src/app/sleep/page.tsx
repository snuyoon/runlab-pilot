"use client";

/**
 * /sleep — 취침 → 수면 → 알람 → 해제 → 기상 EMA 자동 진입
 *
 * 웹앱 제약상 알람은 이 페이지가 열려 있는 동안 동작한다.
 * (아이폰: 충전기에 연결 + 화면 켜둔 채로 머리맡에 두는 것을 안내)
 *  - Wake Lock API로 화면 꺼짐 방지 (iOS 16.4+ 지원)
 *  - 알람음은 WebAudio로 생성 — 취침 버튼(사용자 제스처)에서 AudioContext를 미리 연다
 *  - 설정된 기상 시각이 되면 자동으로 알람 페이즈 진입
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { loadData, startSleepLog, finishSleepLog, isWakeEMADue } from "@/store/studyStore";
import { useMounted } from "@/hooks/useMounted";
import { isNativeApp } from "@/lib/native";

type Phase = "bedtime" | "sleeping" | "alarm" | "dismiss";

export default function SleepPage() {
  const mounted = useMounted();
  // 알람 시각 등 저장값은 클라이언트에서만 읽는다 (hydration mismatch 방지)
  if (!mounted) return <div className="mobile-frame bg-slate-900" />;
  return <SleepInner />;
}

function SleepInner() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("bedtime");
  const [settings] = useState(() => loadData().settings);
  // 네이티브 셸: 알람은 시스템(AlarmKit)이 담당 — 화면 켜둘 필요 없음
  const [native] = useState(() => isNativeApp());
  const [currentTime, setCurrentTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });
  const [slideX, setSlideX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const alarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const sleepLogIdRef = useRef<string | null>(null);
  const alarmFiredRef = useRef(false);
  /** 알람 목표 시각(timestamp). 정확 일치(===) 비교 대신 now >= target으로 판정 —
      JS가 잠깐 멈췄다 재개돼도(화면 잠김/스로틀) 알람을 놓치지 않는다 */
  const alarmTargetRef = useRef(0);
  const phaseRef = useRef<Phase>("bedtime");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const alarmTime = `${String(settings.alarmHour).padStart(2, "0")}:${String(settings.alarmMinute).padStart(2, "0")}`;
  const alarmEnabled = settings.alarmEnabled;

  // ── 알람음 (WebAudio 비프음 루프) ──
  const beep = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    // 삐-삐-삐 3연타 패턴
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, now + i * 0.25);
      gain.gain.linearRampToValueAtTime(0.5, now + i * 0.25 + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.25 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.25);
      osc.stop(now + i * 0.25 + 0.2);
    }
  }, []);

  const startAlarmSound = useCallback(() => {
    audioCtxRef.current?.resume();
    beep();
    alarmIntervalRef.current = setInterval(() => {
      beep();
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.([200, 100, 200]);
      }
    }, 1200);
  }, [beep]);

  const stopAlarmSound = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }, []);

  // ── 화면 꺼짐 방지 (Wake Lock) ──
  // 페이지가 잠깐이라도 hidden이 되면(앱 전환, 알림 탭 등) 브라우저가 lock을
  // 자동 해제하므로, visible 복귀 시마다 재획득해야 밤새 유지된다
  const requestWakeLock = useCallback(() => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: {
          request: (type: "screen") => Promise<{
            release: () => Promise<void>;
            addEventListener?: (t: string, cb: () => void) => void;
          }>;
        };
      };
      nav.wakeLock
        ?.request("screen")
        .then((lock) => {
          wakeLockRef.current = lock;
          lock.addEventListener?.("release", () => {
            wakeLockRef.current = null;
          });
        })
        .catch(() => {});
    } catch {}
  }, []);

  // ── 페이즈 전환 ──
  const startSleep = useCallback(() => {
    if (native) {
      // 네이티브: 시스템 알람은 알람 화면에서 저장할 때 이미 예약됨.
      // 취침 시작은 수면 로그만 기록하면 된다 (앱을 닫아도 알람이 울림).
      alarmTargetRef.current = 0;
    } else if (!alarmEnabled) {
      // 웹 · 알람 꺼짐: 예약 없이 수면만 기록
      alarmTargetRef.current = 0;
    } else {
      // 웹: 사용자 제스처 안에서 AudioContext 준비 (iOS 사운드 정책)
      // 주의: resume()을 await하면 정책에 막혔을 때 프로미스가 안 풀려
      // 버튼이 먹통이 되므로 화면 전환을 막지 않게 fire-and-forget으로 처리
      try {
        type AudioCtxCtor = typeof AudioContext;
        const Ctor: AudioCtxCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext;
        audioCtxRef.current = audioCtxRef.current ?? new Ctor();
        audioCtxRef.current.resume().catch(() => {});
      } catch {}
      requestWakeLock();
      // 알람 목표 시각: 이미 지난 시각이면 내일
      const t = new Date();
      t.setHours(settings.alarmHour, settings.alarmMinute, 0, 0);
      if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
      alarmTargetRef.current = t.getTime();
    }
    sleepLogIdRef.current = startSleepLog();
    alarmFiredRef.current = false;
    setPhase("sleeping");
  }, [native, alarmEnabled, requestWakeLock, settings.alarmHour, settings.alarmMinute]);

  const triggerAlarm = useCallback(() => {
    setPhase("alarm");
    startAlarmSound();
  }, [startAlarmSound]);

  const dismissAlarm = useCallback(() => {
    stopAlarmSound();
    wakeLockRef.current?.release().catch(() => {});
    if (sleepLogIdRef.current) finishSleepLog(sleepLogIdRef.current);
    setPhase("dismiss");
    // 오늘 기상 설문을 이미 했다면(낮잠 등) 홈으로
    setTimeout(() => router.push(isWakeEMADue() ? "/ema" : "/home"), 1200);
  }, [router, stopAlarmSound]);

  // ── 시계 + 알람 시각 감시 ──
  const doTick = useCallback(() => {
    const now = new Date();
    setCurrentTime(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    );
    if (
      !native && // 네이티브에선 시스템 알람이 담당
      phaseRef.current === "sleeping" &&
      !alarmFiredRef.current &&
      alarmTargetRef.current > 0 &&
      Date.now() >= alarmTargetRef.current
    ) {
      alarmFiredRef.current = true;
      triggerAlarm();
    }
  }, [native, triggerAlarm]);

  useEffect(() => {
    const interval = setInterval(doTick, 1000);
    return () => clearInterval(interval);
  }, [doTick]);

  // visible 복귀 시: wake lock 재획득 + 놓친 알람 즉시 발화
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (
        !native &&
        alarmEnabled && // 웹 알람이 있을 때만 화면 켜둠이 필요
        (phaseRef.current === "sleeping" || phaseRef.current === "alarm") &&
        !wakeLockRef.current
      ) {
        requestWakeLock();
      }
      doTick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [native, alarmEnabled, requestWakeLock, doTick]);

  // 페이지 이탈 시 정리
  useEffect(() => {
    return () => {
      stopAlarmSound();
      wakeLockRef.current?.release().catch(() => {});
    };
  }, [stopAlarmSound]);

  const handleSlideEnd = useCallback(() => {
    if (slideX > 200) dismissAlarm();
    setSlideX(0);
    setIsDragging(false);
  }, [slideX, dismissAlarm]);

  return (
    <div className="mobile-frame flex flex-col">
      {/* 페이즈 전환은 exit 없이 entrance만 — 백그라운드 탭에서 rAF가 멈춰도 다음 페이즈가 즉시 마운트되도록 */}
        {/* ===== 1. 취침 준비 ===== */}
        {phase === "bedtime" && (
          <motion.div
            key="bedtime"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center flex-1 px-8 py-10
              bg-gradient-to-b from-indigo-900 to-slate-900 text-white safe-top safe-bottom"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-center w-full"
            >
              <div className="text-6xl mb-4">🌙</div>
              <h1 className="text-2xl font-bold mb-2">취침 준비</h1>
              <p className="text-indigo-300 text-sm mb-8">
                워치를 착용하고 아래 버튼을 눌러주세요
              </p>

              <div className="bg-white/10 rounded-2xl p-4 mb-3 backdrop-blur">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">⌚</span>
                  <div className="text-left">
                    <div className="font-semibold text-sm">수면 워치 착용</div>
                    <div className="text-xs text-indigo-300">손목에 워치를 차고 주무세요</div>
                  </div>
                </div>
              </div>

              <div className="bg-white/10 rounded-2xl p-4 mb-3 backdrop-blur">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{alarmEnabled ? "⏰" : "🔕"}</span>
                  <div className="text-left">
                    <div className="font-semibold text-sm">
                      {alarmEnabled ? `기상 알람 ${alarmTime}` : "기상 알람 꺼짐"}
                    </div>
                    <div className="text-xs text-indigo-300">
                      {alarmEnabled
                        ? "알람이 울리면 밀어서 끄고, 바로 설문이 열려요"
                        : "아침에 직접 앱을 열어 기상 설문을 진행해주세요"}
                    </div>
                  </div>
                </div>
              </div>

              {!alarmEnabled ? (
                <div className="bg-white/10 border border-white/15 rounded-2xl p-4 mb-8">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">💤</span>
                    <div className="text-left">
                      <div className="font-semibold text-sm text-indigo-100">알람 없이 수면 기록</div>
                      <div className="text-xs text-indigo-300 leading-relaxed">
                        알람이 울리지 않아요. 다시 켜려면 알람 설정에서 스위치를 켜주세요.
                      </div>
                    </div>
                  </div>
                </div>
              ) : native ? (
                <div className="bg-emerald-400/15 border border-emerald-300/30 rounded-2xl p-4 mb-8">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">✅</span>
                    <div className="text-left">
                      <div className="font-semibold text-sm text-emerald-200">시스템 알람 예약</div>
                      <div className="text-xs text-emerald-200/80 leading-relaxed">
                        앱을 닫거나 화면이 꺼져 있어도 알람이 울려요.
                        무음 모드에서도 소리가 납니다.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-400/15 border border-amber-300/30 rounded-2xl p-4 mb-8">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🔌</span>
                    <div className="text-left">
                      <div className="font-semibold text-sm text-amber-200">중요</div>
                      <div className="text-xs text-amber-200/80 leading-relaxed">
                        충전기에 연결하고, 이 화면을 켜 둔 채로 머리맡에 두세요.
                        화면이 꺼지면 알람이 울리지 않아요.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>

            <motion.button
              onClick={startSleep}
              className="w-full py-4 rounded-2xl text-lg font-semibold
                bg-gradient-to-r from-indigo-500 to-purple-600 text-white
                shadow-lg shadow-indigo-900/50"
              whileTap={{ scale: 0.97 }}
            >
              😴 취침 시작하기
            </motion.button>

            <button
              onClick={() => router.push("/home")}
              className="text-indigo-400 text-sm mt-4 py-2"
            >
              돌아가기
            </button>
          </motion.div>
        )}

        {/* ===== 2. 수면 중 ===== */}
        {phase === "sleeping" && (
          <motion.div
            key="sleeping"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center flex-1 px-8 bg-slate-950 text-white"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-center"
            >
              <motion.div
                className="text-6xl font-light text-white/20 tabular-nums mb-6"
                animate={{ opacity: [0.15, 0.25, 0.15] }}
                transition={{ duration: 4, repeat: Infinity }}
              >
                {currentTime}
              </motion.div>

              <div className="relative h-12 mb-6">
                {["💤", "💤", "💤"].map((z, i) => (
                  <motion.span
                    key={i}
                    className="absolute text-2xl"
                    style={{ left: `${40 + i * 15}%` }}
                    animate={{
                      y: [0, -30, -60],
                      x: [0, 10, 20],
                      opacity: [0, 0.6, 0],
                      scale: [0.6, 1, 0.8],
                    }}
                    transition={{ duration: 3, repeat: Infinity, delay: i * 1 }}
                  >
                    {z}
                  </motion.span>
                ))}
              </div>

              <p className="text-white/30 text-sm mb-2">수면 중...</p>
              <p className="text-white/20 text-xs">
                알람: {alarmEnabled ? alarmTime : "꺼짐"}
              </p>
              {native && alarmEnabled && (
                <p className="text-emerald-300/60 text-xs mt-3">
                  시스템 알람 예약됨 — 앱을 닫아도 좋아요
                </p>
              )}
            </motion.div>

            {/* 알람 꺼짐: 알람 페이즈가 없으므로 직접 기상 종료 */}
            {!alarmEnabled && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
                onClick={dismissAlarm}
                className="mt-12 px-8 py-3.5 rounded-full text-sm font-semibold
                  bg-white/15 text-white/80 border border-white/15"
                whileTap={{ scale: 0.95 }}
              >
                ☀️ 기상하기
              </motion.button>
            )}

            {/* 파일럿 테스트용: 즉시 알람 (웹 전용 — 네이티브는 시스템 알람 사용) */}
            {!native && alarmEnabled && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2 }}
                onClick={() => {
                  alarmFiredRef.current = true;
                  triggerAlarm();
                }}
                className="mt-12 px-6 py-3 rounded-full text-sm
                  bg-white/10 text-white/50 border border-white/10"
                whileTap={{ scale: 0.95 }}
              >
                ⏩ 테스트: 알람 울리기
              </motion.button>
            )}
          </motion.div>
        )}

        {/* ===== 3. 알람 ===== */}
        {phase === "alarm" && (
          <motion.div
            key="alarm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center flex-1 px-8 bg-slate-950 text-white"
          >
            <motion.div
              className="absolute inset-0"
              animate={{
                background: [
                  "radial-gradient(circle, rgba(239,68,68,0.15) 0%, rgba(0,0,0,0) 70%)",
                  "radial-gradient(circle, rgba(239,68,68,0.3) 0%, rgba(0,0,0,0) 70%)",
                  "radial-gradient(circle, rgba(239,68,68,0.15) 0%, rgba(0,0,0,0) 70%)",
                ],
              }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />

            <motion.div
              className="text-7xl font-bold text-white tabular-nums mb-4 z-10"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            >
              {currentTime}
            </motion.div>

            <motion.div
              className="text-8xl mb-8 z-10"
              animate={{ rotate: [0, 15, -15, 15, -15, 0] }}
              transition={{ duration: 0.5, repeat: Infinity }}
            >
              🔔
            </motion.div>

            <div className="w-full max-w-xs relative z-10">
              <div className="bg-white/10 rounded-full h-16 relative overflow-hidden backdrop-blur">
                <motion.div
                  className="absolute inset-0 flex items-center justify-center text-white/30 text-sm"
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  밀어서 알람 끄기 →
                </motion.div>

                <motion.div
                  className="absolute left-1 top-1 w-14 h-14 bg-white rounded-full
                    flex items-center justify-center text-2xl cursor-grab active:cursor-grabbing shadow-lg"
                  drag="x"
                  dragConstraints={{ left: 0, right: 260 }}
                  dragElastic={0.1}
                  onDrag={(_, info) => {
                    setSlideX(info.offset.x);
                    setIsDragging(true);
                  }}
                  onDragEnd={handleSlideEnd}
                  animate={!isDragging ? { x: 0 } : {}}
                  whileDrag={{ scale: 1.1 }}
                  style={{ x: isDragging ? undefined : 0 }}
                >
                  ☀️
                </motion.div>
              </div>
            </div>

            <p className="text-white/30 text-xs mt-6 z-10">
              알람을 끄면 바로 기상 설문이 시작됩니다
            </p>
          </motion.div>
        )}

        {/* ===== 4. 해제 → EMA 전환 ===== */}
        {phase === "dismiss" && (
          <motion.div
            key="dismiss"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center flex-1 px-8
              bg-gradient-to-b from-amber-50 to-orange-50"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="text-center"
            >
              <div className="text-7xl mb-4">☀️</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">좋은 아침이에요!</h2>
              <p className="text-slate-500 text-sm">간단한 설문을 시작할게요...</p>
              <motion.div
                className="mt-6 flex justify-center gap-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-2.5 h-2.5 rounded-full bg-amber-400"
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </motion.div>
            </motion.div>
          </motion.div>
        )}
    </div>
  );
}
