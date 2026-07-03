import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * 참여자의 코치 계획(처방 운동량) 조회 — 앱이 계획 AU 비교에 사용.
 * GET /api/plan?code=SNU-01-XXXX → { plans: [{date, plannedMin, plannedRpe, plannedAU}] }
 */
export async function GET(request: Request) {
  try {
    const code = (new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
    if (!code) return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
    const sql = db();
    const p = await sql`SELECT code FROM participants WHERE code = ${code} AND active = TRUE`;
    if (p.length === 0) return NextResponse.json({ ok: false, error: "unknown code" }, { status: 403 });
    const rows = await sql`
      SELECT to_char(date, 'YYYY-MM-DD') AS date, planned_min, planned_rpe, planned_au, note
      FROM plans
      WHERE participant_code = ${code} AND date >= (CURRENT_DATE - INTERVAL '90 days')
      ORDER BY date DESC LIMIT 200
    `;
    const plans = rows.map((r) => ({
      date: r.date as string,
      plannedMin: r.planned_min as number | null,
      plannedRpe: r.planned_rpe as number | null,
      plannedAU: r.planned_au as number | null,
      note: (r.note as string) ?? "",
    }));
    return NextResponse.json({ ok: true, plans });
  } catch (e) {
    console.error("plan get error:", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
