import { timingSafeEqual } from "node:crypto";

// Сравнение секрета вебхука без утечки по времени. Пустой секрет не подходит никогда
export function sameSecret(got: string | null, expected: string | undefined) {
  if (!got || !expected || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
