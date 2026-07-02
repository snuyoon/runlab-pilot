import { NextResponse } from "next/server";
import { db, isAdmin } from "@/lib/db";

/**
 * 참여자 원격 초기화 (테스트/재시작용):
 *  1) 해당 참여자의 서버 기록 삭제
 *  2) reset_at 갱신 → 참여자 기기가 다음 앱 실행 시 로컬 데이터를 자동 초기화
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { code } = await request.json();
    if (typeof code !== "string" || code.trim().length < 2) {
      return NextResponse.json({ error: "bad code" }, { status: 400 });
    }
    const normalized = code.trim().toUpperCase();
    const sql = db();
    const deleted = await sql`
      DELETE FROM records WHERE participant_code = ${normalized} RETURNING client_id
    `;
    await sql`UPDATE participants SET reset_at = now() WHERE code = ${normalized}`;
    return NextResponse.json({ ok: true, deletedRecords: deleted.length });
  } catch (e) {
    console.error("reset error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
