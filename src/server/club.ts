import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { auditLog, clubs, memberships, seasons } from "@/db/schema";
import { currentUser } from "./auth";
import { can, type Permission } from "./permissions";

// Контекст страницы клуба: кто смотрит, в каком клубе, какой сезон открыт.
// Чужой клуб для пользователя не существует — отдаём 404
export async function clubContext(slug: string) {
  const user = await currentUser();
  if (!user) redirect("/");

  const [row] = await db()
    .select({ club: clubs, membership: memberships })
    .from(clubs)
    .innerJoin(memberships, and(eq(memberships.clubId, clubs.id), eq(memberships.userId, user.id)))
    .where(eq(clubs.slug, slug));
  if (!row || row.membership.status === "left") notFound();

  const [season] = await db()
    .select()
    .from(seasons)
    .where(eq(seasons.clubId, row.club.id))
    .orderBy(desc(seasons.startsOn))
    .limit(1);

  const role = row.membership.role;
  return {
    user,
    club: row.club,
    membership: row.membership,
    season: season ?? null,
    can: (p: Permission) => can(role, p),
  };
}

export type ClubContext = Awaited<ReturnType<typeof clubContext>>;

export async function requirePermission(slug: string, permission: Permission) {
  const ctx = await clubContext(slug);
  if (!ctx.can(permission)) throw new Error("Недостаточно прав");
  return ctx;
}

export function requireSeason(ctx: ClubContext) {
  if (!ctx.season) throw new Error("В клубе нет сезона");
  return ctx.season;
}

export async function audit(ctx: ClubContext, action: string, entity: string, entityId: string, data?: unknown) {
  await db()
    .insert(auditLog)
    .values({ clubId: ctx.club.id, userId: ctx.user.id, action, entity, entityId, data: data ?? null });
}
