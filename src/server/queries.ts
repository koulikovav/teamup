import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { memberBalances } from "@/domain/balance";
import { seasonReport } from "@/domain/report";
import { allocateSeats } from "@/domain/seats";
import type { ClubContext } from "./club";

type Ctx = ClubContext & { season: NonNullable<ClubContext["season"]> };

export async function members(ctx: ClubContext) {
  return db()
    .select({
      id: s.memberships.id,
      userId: s.users.id,
      fullName: s.users.fullName,
      phone: s.users.phone,
      role: s.memberships.role,
      status: s.memberships.status,
      memberNo: s.memberships.memberNo,
      feeCategoryId: s.memberships.feeCategoryId,
    })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .where(eq(s.memberships.clubId, ctx.club.id))
    .orderBy(asc(s.memberships.memberNo), asc(s.users.fullName));
}

export async function feeCategories(ctx: Ctx) {
  return db()
    .select({ id: s.feeCategories.id, name: s.feeCategories.name, amount: s.seasonFeeRates.amount })
    .from(s.feeCategories)
    .leftJoin(
      s.seasonFeeRates,
      and(eq(s.seasonFeeRates.feeCategoryId, s.feeCategories.id), eq(s.seasonFeeRates.seasonId, ctx.season.id)),
    )
    .where(eq(s.feeCategories.clubId, ctx.club.id));
}

const inSeason = (clubId: PgColumn, seasonId: PgColumn, ctx: Ctx) =>
  and(eq(clubId, ctx.club.id), eq(seasonId, ctx.season.id));

export async function money(ctx: Ctx) {
  const [list, charges, payments] = await Promise.all([
    members(ctx),
    db().select().from(s.charges).where(inSeason(s.charges.clubId, s.charges.seasonId, ctx)).orderBy(desc(s.charges.createdAt)),
    db().select().from(s.payments).where(inSeason(s.payments.clubId, s.payments.seasonId, ctx)).orderBy(desc(s.payments.paidOn)),
  ]);
  const balances = memberBalances(charges, payments);
  const names = new Map(list.map((m) => [m.id, m.fullName]));
  return { members: list, charges, payments, balances, names };
}

export async function expenses(ctx: Ctx) {
  return db()
    .select({ expense: s.expenses, budgetItem: s.budgetItems.name, event: s.events.title })
    .from(s.expenses)
    .leftJoin(s.budgetItems, eq(s.expenses.budgetItemId, s.budgetItems.id))
    .leftJoin(s.events, eq(s.expenses.eventId, s.events.id))
    .where(inSeason(s.expenses.clubId, s.expenses.seasonId, ctx))
    .orderBy(desc(s.expenses.spentOn));
}

export async function budgetItems(ctx: Ctx) {
  return db().select().from(s.budgetItems).where(inSeason(s.budgetItems.clubId, s.budgetItems.seasonId, ctx)).orderBy(asc(s.budgetItems.name));
}

export async function events(ctx: Ctx) {
  return db()
    .select()
    .from(s.events)
    .where(and(inSeason(s.events.clubId, s.events.seasonId, ctx), ne(s.events.status, "cancelled")))
    .orderBy(asc(s.events.startsOn));
}

export async function eventDetail(ctx: Ctx, eventId: string) {
  const [event] = await db()
    .select()
    .from(s.events)
    .where(and(eq(s.events.id, eventId), eq(s.events.clubId, ctx.club.id)));
  if (!event) return null;
  const participants = await db()
    .select({ p: s.eventParticipants, fullName: s.users.fullName })
    .from(s.eventParticipants)
    .innerJoin(s.memberships, eq(s.eventParticipants.membershipId, s.memberships.id))
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .where(eq(s.eventParticipants.eventId, event.id));
  const names = new Map(participants.map((x) => [x.p.membershipId, x.fullName]));
  const allocation = allocateSeats(
    participants.map((x) => x.p),
    event.capacity,
  );
  const eventExpenses = await db()
    .select()
    .from(s.expenses)
    .where(and(eq(s.expenses.eventId, event.id), inArray(s.expenses.status, ["draft", "confirmed"])));
  return { event, participants, names, allocation, expenses: eventExpenses };
}

export async function report(ctx: Ctx) {
  const [{ payments }, list] = await Promise.all([money(ctx), expenses(ctx)]);
  return seasonReport({
    openingBalance: ctx.season.openingBalance,
    payments,
    expenses: list.map((e) => ({ amount: e.expense.amount, status: e.expense.status, budgetItemName: e.budgetItem })),
  });
}
