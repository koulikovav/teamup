// Ссылка для входа члену клуба, когда войти больше некак (например, первому админу).
//
//   npm run login-link -- ok178 "Куликов Алексей"

import { createHash, randomBytes } from "node:crypto";
import { and, eq, ilike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";

async function main() {
  const [slug, name] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!slug || !name || !url) throw new Error('Нужны DATABASE_URL, адрес клуба и часть ФИО: npm run login-link -- ok178 "Иванов"');

  const sql = postgres(url);
  const db = drizzle(sql);
  const found = await db
    .select({ userId: s.users.id, fullName: s.users.fullName })
    .from(s.memberships)
    .innerJoin(s.clubs, eq(s.memberships.clubId, s.clubs.id))
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .where(and(eq(s.clubs.slug, slug), ilike(s.users.fullName, `%${name}%`)));
  if (found.length !== 1) throw new Error(`Найдено ${found.length} человек, уточните ФИО`);

  const token = randomBytes(32).toString("base64url");
  await db.insert(s.loginTokens).values({
    userId: found[0].userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 7 * 864e5),
  });
  console.log(`${found[0].fullName}: ${process.env.APP_URL ?? "http://localhost:3000"}/login/${token}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
