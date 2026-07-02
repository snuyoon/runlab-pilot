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
      SELECT code, label FROM participants
      WHERE code = ${code.trim().toUpperCase()} AND active = TRUE
    `;
    if (rows.length === 0) {
      return NextResponse.json({ valid: false });
    }
    return NextResponse.json({ valid: true, label: rows[0].label });
  } catch (e) {
    console.error("validate error:", e);
    return NextResponse.json({ valid: false, error: "server" }, { status: 500 });
  }
}
