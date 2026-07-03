import { NextResponse } from "next/server";
import { db, isAdmin } from "@/lib/db";

/** ISO 요일 기준 해당 날짜가 속한 주의 월요일 */
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=일
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * 코치 처방 업로드 — 관리자 전용. 두 모드 지원(멱등 업서트):
 *  - 주간 프로그램(권장): rows: [{ code, week(그 주 아무 날짜), option(1~9), label?, plannedMin, plannedRpe }]
 *    → programs 테이블. 참여자가 세션 설문에서 실시한 옵션을 골라 목표 AU와 비교.
 *  - 일자 계획(구): rows: [{ code, date, plannedMin, plannedRpe, note? }] → plans 테이블.
 * 목표 AU = plannedRpe × plannedMin (Foster sRPE 부하).
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
      const min = Number(r.plannedMin);
      const rpe = Number(r.plannedRpe);
      const au = Math.round(rpe * min * 10) / 10;
      const isProgram = r.option != null || r.week != null;

      if (isProgram) {
        const weekRaw = String(r.week ?? r.date ?? "").trim();
        const opt = Number(r.option);
        if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(weekRaw) || !isFinite(min) || min <= 0 ||
            !isFinite(rpe) || !Number.isInteger(opt) || opt < 1 || opt > 9) {
          skipped.push(`${code || "?"}/${weekRaw || "?"}/opt${r.option ?? "?"}`);
          continue;
        }
        const week = mondayOf(weekRaw);
        const label = typeof r.label === "string" ? r.label.slice(0, 40) : "";
        try {
          await sql`
            INSERT INTO programs (participant_code, week_monday, option_no, label, planned_min, planned_rpe, planned_au, updated_at)
            VALUES (${code}, ${week}, ${opt}, ${label}, ${Math.round(min)}, ${rpe}, ${au}, now())
            ON CONFLICT (participant_code, week_monday, option_no) DO UPDATE
              SET label = EXCLUDED.label,
                  planned_min = EXCLUDED.planned_min,
                  planned_rpe = EXCLUDED.planned_rpe,
                  planned_au = EXCLUDED.planned_au,
                  updated_at = now()
          `;
          saved++;
        } catch {
          skipped.push(`${code}/${week}/opt${opt}`); // 참여자 코드 미존재(FK) 등
        }
        continue;
      }

      // 일자 계획(구 형식)
      const date = String(r.date ?? "").trim();
      if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(min) || !isFinite(rpe) || min <= 0) {
        skipped.push(`${code || "?"}/${date || "?"}`);
        continue;
      }
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
        skipped.push(`${code}/${date}`);
      }
    }
    return NextResponse.json({ ok: true, saved, skippedCount: skipped.length, skipped: skipped.slice(0, 20) });
  } catch (e) {
    console.error("plans upload error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
