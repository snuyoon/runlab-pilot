import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const KINDS = new Set(["wake_ema", "session_rpe", "ostrc", "sleep_log"]);

interface IncomingRecord {
  clientId: string;
  kind: string;
  date: string;
  completedAt: string;
  payload: unknown;
}

/**
 * 참여자 응답 수집 — 클라이언트 outbox의 배치 업로드.
 * client_id 기준 멱등(중복 전송해도 1건만 저장).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const records: IncomingRecord[] = Array.isArray(body.records) ? body.records : [];

    if (!code || records.length === 0 || records.length > 100) {
      return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
    }

    const sql = db();
    const participant = await sql`
      SELECT code FROM participants WHERE code = ${code} AND active = TRUE
    `;
    if (participant.length === 0) {
      return NextResponse.json({ ok: false, error: "unknown code" }, { status: 403 });
    }

    let saved = 0;
    for (const r of records) {
      if (
        typeof r.clientId !== "string" ||
        !KINDS.has(r.kind) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")
      ) {
        continue; // 형식이 깨진 레코드는 건너뜀 (클라이언트 큐에서 제거되도록 실패시키지 않음)
      }
      await sql`
        INSERT INTO records (client_id, participant_code, kind, date, completed_at, payload)
        VALUES (${r.clientId}, ${code}, ${r.kind}, ${r.date},
                ${r.completedAt ?? null}, ${JSON.stringify(r.payload ?? {})}::jsonb)
        ON CONFLICT (client_id) DO NOTHING
      `;
      saved++;
    }

    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    console.error("sync error:", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
