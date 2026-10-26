// Одноразовые ссылки. В базе хранится только хэш, поэтому утечка базы не даёт войти.
// login — вход на сайт; max_link и telegram_link — привязка аккаунта мессенджера к человеку в клубе

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { loginTokens } from "@/db/schema";

export type TokenPurpose = "login" | "max_link" | "telegram_link";

export const linkPurpose = (kind: "max" | "telegram") => (kind === "max" ? "max_link" : "telegram_link") satisfies TokenPurpose;

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

// Ссылка открывает бота в мессенджере, и бот получает токен в параметре start
export async function messengerLinkUrl(kind: "max" | "telegram", userId: string) {
  const bot = kind === "max" ? process.env.MAX_BOT_NAME : process.env.TELEGRAM_BOT_NAME;
  if (!bot) return null;
  const site = kind === "max" ? "https://max.ru" : "https://t.me";
  return `${site}/${bot}?start=${await createToken(userId, linkPurpose(kind))}`;
}
