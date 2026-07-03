import { NextResponse } from "next/server";
import { db, isAdmin } from "@/lib/db";

/**
 * 코치 계획(처방 운동량) 업로드 — 관리자 전용.
 * POST { rows: [{ code, date(YYYY-MM-DD), plannedMin, plannedRpe, note? }] }
 * 계획 AU = plannedRpe × plannedMin (Foster sRPE 부하). (participant_code, date)로 멱등 업서트.
 */
export async function POST(request: Request) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0 || rows.length > 5000) {
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    }
    const sql = db();
    let saved = 0;
    const skipped: string[] = [];
    for (const r of rows) {
      const code = String(r.code ?? "").trim().toUpperCase();
      const date = String(r.date ?? "").trim();
      const min = Number(r.plannedMin);
      const rpe = Number(r.plannedRpe);
      if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(min) || !isFinite(rpe) || min <= 0) {
        skipped.push(`${code || "?"}/${date || "?"}`);
        continue;
      }
      const au = Math.round(rpe * min * 10) / 10;
      const note = typeof r.note === "string" ? r.note : null;
      try {
        await sql`
          INSERT INTO plans (participant_code, date, planned_min, planned_rpe, planned_au, note, updated_at)
          VALUES (${code}, ${date}, ${Math.round(min)}, ${rpe}, ${au}, ${note}, now())
          ON CONFLICT (participant_code, date) DO UPDATE
            SET planned_min = EXCLUDED.planned_min,
                planned_rpe = EXCLUDED.planned_rpe,
                planned_au = EXCLUDED.planned_au,
                note = EXCLUDED.note,
                updated_at = now()
        `;
        saved++;
      } catch {
        // 참여자 코드 미존재(FK) 등
        skipped.push(`${code}/${date}`);
      }
    }
    return NextResponse.json({ ok: true, saved, skippedCount: skipped.length, skipped: skipped.slice(0, 20) });
  } catch (e) {
    console.error("plans upload error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
