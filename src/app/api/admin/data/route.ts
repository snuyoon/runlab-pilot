import { NextResponse } from "next/server";
import { db, isAdmin } from "@/lib/db";

/**
 * 관리자용 전체 데이터 조회.
 * 파일럿 규모(10명 × 수개월)에서는 전체를 내려도 수천 행 수준이므로
 * 단일 엔드포인트로 내리고 집계는 관리자 화면(클라이언트)에서 수행한다.
 */
export async function GET(request: Request) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const sql = db();
    const participants = await sql`
      SELECT code, label, active, created_at FROM participants ORDER BY code
    `;
    const records = await sql`
      SELECT client_id, participant_code, kind, date::text AS date, completed_at, payload, received_at
      FROM records
      ORDER BY participant_code, date DESC, completed_at DESC
      LIMIT 20000
    `;
    return NextResponse.json({ participants, records });
  } catch (e) {
    console.error("admin data error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
