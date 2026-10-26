// Одноразовые ссылки. В базе хранится только хэш, поэтому утечка базы не даёт войти.
// login — вход на сайт; max_link — привязка аккаунта Max к человеку в клубе

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { loginTokens } from "@/db/schema";

export type TokenPurpose = "login" | "max_link";

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const daysFromNow = (days: number) => new Date(Date.now() + days * 864e5);

const LINK_DAYS = 7;

export async function createToken(userId: string, purpose: TokenPurpose) {
  const token = newToken();
  await db()
    .insert(loginTokens)
    .values({ userId, purpose, tokenHash: hashToken(token), expiresAt: daysFromNow(LINK_DAYS) });
  return token;
}

// Гасит ссылку и возвращает, чья она. Ссылка срабатывает один раз
export async function consumeToken(token: string, purpose: TokenPurpose) {
  const [row] = await db()
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(loginTokens.tokenHash, hashToken(token)),
        eq(loginTokens.purpose, purpose),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  return row?.userId ?? null;
}

export const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

export async function loginUrl(userId: string) {
  return `${appUrl()}/login/${await createToken(userId, "login")}`;
}

// Ссылка открывает бота в Max, и бот получает токен в параметре start
export async function maxLinkUrl(userId: string) {
  const bot = process.env.MAX_BOT_NAME;
  if (!bot) return null;
  return `https://max.ru/${bot}?start=${await createToken(userId, "max_link")}`;
}
