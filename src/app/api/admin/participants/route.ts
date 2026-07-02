import { NextResponse } from "next/server";
import { db, isAdmin } from "@/lib/db";

/** 참여자 코드 등록/수정 */
export async function POST(request: Request) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { code, label } = await request.json();
    if (typeof code !== "string" || code.trim().length < 2) {
      return NextResponse.json({ error: "bad code" }, { status: 400 });
    }
    const sql = db();
    await sql`
      INSERT INTO participants (code, label)
      VALUES (${code.trim().toUpperCase()}, ${typeof label === "string" ? label : ""})
      ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, active = TRUE
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("participant add error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}

/** 참여자 비활성화 (데이터는 보존, 로그인/수집만 차단) */
export async function DELETE(request: Request) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim().toUpperCase() ?? "";
    if (code.length < 2) {
      return NextResponse.json({ error: "bad code" }, { status: 400 });
    }
    const sql = db();
    await sql`UPDATE participants SET active = FALSE WHERE code = ${code}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("participant deactivate error:", e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
