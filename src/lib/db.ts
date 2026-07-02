import { neon } from "@neondatabase/serverless";

/**
 * Neon Postgres 접속 (서버 전용).
 * DATABASE_URL은 Vercel의 Neon 마켓플레이스 연동이 자동 주입하며,
 * 로컬 개발 시에는 .env.local에 넣는다 (git에 커밋 금지).
 */
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다");
  return neon(url);
}

/** 관리자 API 인증: x-admin-key 헤더를 ADMIN_KEY 환경변수와 비교 */
export function isAdmin(request: Request): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return false;
  return request.headers.get("x-admin-key") === key;
}
