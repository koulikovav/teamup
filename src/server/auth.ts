import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { consumeToken, daysFromNow, hashToken as hash, newToken } from "./tokens";

const SESSION_COOKIE = "teamup_session";
const SESSION_DAYS = 90;

// Обменивает ссылку для входа на сессию; ссылка срабатывает один раз
export async function signInWithToken(token: string) {
  const userId = await consumeToken(token, "login");
  if (!userId) return false;

  const sessionToken = newToken();
  const expiresAt = daysFromNow(SESSION_DAYS);
  await db().insert(sessions).values({ userId, tokenHash: hash(sessionToken), expiresAt });
  (await cookies()).set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
  return true;
}

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.tokenHash, hash(token)));
  jar.delete(SESSION_COOKIE);
}
