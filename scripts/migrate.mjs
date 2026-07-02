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
    kind TEXT NOT NULL CHECK (kind IN ('wake_ema','session_rpe','ostrc','sleep_log')),
    date DATE NOT NULL,
    completed_at TIMESTAMPTZ,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS idx_records_participant ON records (participant_code, kind, date)
`;

// 초기 참여자 코드 (관리자 화면에서 추가/비활성화 가능)
const seed = [
  ["TEST-01", "연구자 테스트"],
  ...Array.from({ length: 10 }, (_, i) => [
    `SNU-${String(i + 1).padStart(3, "0")}`,
    `참여자 ${i + 1}`,
  ]),
];
for (const [code, label] of seed) {
  await sql`
    INSERT INTO participants (code, label) VALUES (${code}, ${label})
    ON CONFLICT (code) DO NOTHING
  `;
}

const participants = await sql`SELECT code, label, active FROM participants ORDER BY code`;
console.log("스키마 생성 완료. 등록된 참여자:");
for (const p of participants) console.log(` - ${p.code} (${p.label})${p.active ? "" : " [비활성]"}`);
