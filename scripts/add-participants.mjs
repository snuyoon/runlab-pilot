/**
 * 참여자 코드 발급 — 무작위 접미사로 추측/오타 방지.
 * 실행: node scripts/add-participants.mjs [인원수=10] [접두사=SNU]
 * 기존의 순차 코드(SNU-001 등)는 비활성화한다.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

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
const count = Number(process.argv[2] ?? 10);
const prefix = (process.argv[3] ?? "SNU").toUpperCase();

// 혼동되는 글자(0/O, 1/I/L) 제외한 알파벳
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function suffix(len = 4) {
  const bytes = randomBytes(len);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

// 순차 코드 비활성화 (추측 가능하므로)
await sql`UPDATE participants SET active = FALSE WHERE code ~ '^SNU-[0-9]{3}$'`;

const created = [];
for (let i = 1; i <= count; i++) {
  const code = `${prefix}-${String(i).padStart(2, "0")}-${suffix()}`;
  await sql`
    INSERT INTO participants (code, label) VALUES (${code}, ${`참여자 ${i}`})
    ON CONFLICT (code) DO NOTHING
  `;
  created.push(code);
}

console.log("발급된 참여 코드 (참여자에게 개별 전달):");
for (const c of created) console.log(` - ${c}`);
console.log("\n(기존 SNU-001~ 순차 코드는 비활성화됨. TEST-01은 연구자 테스트용으로 유지)");
