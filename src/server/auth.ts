import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { loginTokens, sessions, users } from "@/db/schema";

const SESSION_COOKIE = "teamup_session";
const SESSION_DAYS = 90;
const LOGIN_LINK_DAYS = 7;

const newToken = () => randomBytes(32).toString("base64url");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const daysFromNow = (days: number) => new Date(Date.now() + days * 864e5);

// Ссылка для входа. Её показывает админ или присылает бот в Max
export async function createLoginToken(userId: string) {
  const token = newToken();
  await db()
    .insert(loginTokens)
    .values({ userId, tokenHash: hash(token), expiresAt: daysFromNow(LOGIN_LINK_DAYS) });
  return token;
}

// Обменивает ссылку на сессию; ссылка срабатывает один раз
export async function signInWithToken(token: string) {
  const [row] = await db()
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(loginTokens.tokenHash, hash(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())),
    )
    .returning();
  if (!row) return false;

  const sessionToken = newToken();
  const expiresAt = daysFromNow(SESSION_DAYS);
  await db().insert(sessions).values({ userId: row.userId, tokenHash: hash(sessionToken), expiresAt });
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
