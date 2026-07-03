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
    // 주간 프로그램 옵션 (코치가 주 단위로 옵션 1·2·3 처방)
    const progRows = await sql`
      SELECT to_char(week_monday, 'YYYY-MM-DD') AS week, option_no, label, planned_min, planned_rpe, planned_au
      FROM programs
      WHERE participant_code = ${code} AND week_monday >= (CURRENT_DATE - INTERVAL '60 days')
      ORDER BY week_monday DESC, option_no ASC LIMIT 200
    `;
    const programs = progRows.map((r) => ({
      week: r.week as string,
      option: r.option_no as number,
      label: (r.label as string) ?? "",
      plannedMin: r.planned_min as number,
      plannedRpe: r.planned_rpe as number,
      plannedAU: r.planned_au as number,
    }));
    return NextResponse.json({ ok: true, plans, programs });
  } catch (e) {
    console.error("plan get error:", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
