/**
 * DB 스키마 생성 + 초기 참여자 코드 시드.
 * 실행: DATABASE_URL을 .env.local에 넣은 뒤 `node scripts/migrate.mjs`
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

// .env.local에서 DATABASE_URL 로드 (dotenv 없이 간단 파싱)
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]+)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS participants (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS records (
    client_id TEXT PRIMARY KEY,
    participant_code TEXT NOT NULL REFERENCES participants(code),
    kind TEXT NOT NULL,
    date DATE NOT NULL,
    completed_at TIMESTAMPTZ,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

// 기존 DB의 kind CHECK 제약 제거 — 새 kind('workout' 등) 추가 시 매번 마이그레이션하지 않도록
// kind 유효성은 앱/서버(/api/sync의 KINDS)에서 검증한다.
await sql`ALTER TABLE records DROP CONSTRAINT IF EXISTS records_kind_check`;

await sql`
  CREATE INDEX IF NOT EXISTS idx_records_participant ON records (participant_code, kind, date)
`;

// 코치 처방(계획 운동량) — 관리자가 엑셀로 업로드. 참여자 앱이 /api/plan으로 조회해 계획 AU 비교.
// 계획 AU = planned_rpe × planned_min (Foster sRPE 부하).
await sql`
  CREATE TABLE IF NOT EXISTS plans (
    participant_code TEXT NOT NULL REFERENCES participants(code),
    date DATE NOT NULL,
    planned_min INTEGER,
    planned_rpe REAL,
    planned_au REAL,
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (participant_code, date)
  )
`;

// 주간 코치 프로그램 — 코치가 주 단위로 옵션 1·2·3을 처방, 참여자는 세션 설문에서
// 실시한 옵션을 골라 그 옵션의 목표 AU와 실제 AU를 비교한다.
// week_monday = 해당 주 월요일(YYYY-MM-DD). 목표 AU = planned_rpe × planned_min.
await sql`
  CREATE TABLE IF NOT EXISTS programs (
    participant_code TEXT NOT NULL REFERENCES participants(code),
    week_monday DATE NOT NULL,
    option_no INTEGER NOT NULL CHECK (option_no BETWEEN 1 AND 9),
    label TEXT NOT NULL DEFAULT '',
    planned_min INTEGER NOT NULL,
    planned_rpe REAL NOT NULL,
    planned_au REAL NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (participant_code, week_monday, option_no)
  )
`;

// 연구자 테스트 코드만 시드 — 참여자 코드는 추측 불가능한 무작위 접미사로
// scripts/add-participants.mjs 또는 관리자 화면에서 발급한다
await sql`
  INSERT INTO participants (code, label) VALUES ('TEST-01', '연구자 테스트')
  ON CONFLICT (code) DO NOTHING
`;

const participants = await sql`SELECT code, label, active FROM participants ORDER BY code`;
console.log("스키마 생성 완료. 등록된 참여자:");
for (const p of participants) console.log(` - ${p.code} (${p.label})${p.active ? "" : " [비활성]"}`);
