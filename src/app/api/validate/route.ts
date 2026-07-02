import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** 참여 코드 검증 — 사전 등록된(active) 코드만 로그인 허용 */
export async function POST(request: Request) {
  try {
    const { code } = await request.json();
    if (typeof code !== "string" || code.trim().length < 2) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }
    const sql = db();
    const rows = await sql`
      SELECT code, label, reset_at FROM participants
      WHERE code = ${code.trim().toUpperCase()} AND active = TRUE
    `;
    if (rows.length === 0) {
      return NextResponse.json({ valid: false });
    }
    // resetAt: 관리자가 원격 초기화를 지시한 시각 — 클라이언트가 비교해 로컬 데이터를 리셋
    return NextResponse.json({
      valid: true,
      label: rows[0].label,
      resetAt: rows[0].reset_at ?? null,
    });
  } catch (e) {
    console.error("validate error:", e);
    return NextResponse.json({ valid: false, error: "server" }, { status: 500 });
  }
}
