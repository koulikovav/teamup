// Операции, которые делают и сайт, и бот в Max. Права проверяет вызывающий:
// сайт — через clubContext, бот — по привязанному аккаунту Max

import { and, desc, eq, ne } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { memberBalances } from "@/domain/balance";
import { allocateSeats } from "@/domain/seats";
import { today } from "@/lib/format";

export async function audit(clubId: string, userId: string, action: string, entity: string, entityId: string | null, data?: unknown) {
  await db().insert(s.auditLog).values({ clubId, userId, action, entity, entityId, data: data ?? null });
}

export async function latestSeason(clubId: string) {
  const [season] = await db().select().from(s.seasons).where(eq(s.seasons.clubId, clubId)).orderBy(desc(s.seasons.startsOn)).limit(1);
  return season ?? null;
}

// Клубы, где человек состоит (кроме выбывших), с его ролью
export async function membershipsOf(userId: string) {
  return db()
    .select({ membership: s.memberships, club: s.clubs })
    .from(s.memberships)
    .innerJoin(s.clubs, eq(s.memberships.clubId, s.clubs.id))
    .where(and(eq(s.memberships.userId, userId), ne(s.memberships.status, "left")));
}

// ---------------------------------------------------------------- отклик на мероприятие

export type Seat = { status: "going"; place: null } | { status: "waitlist"; place: number } | { status: "other"; place: null };

// Время в очереди сбрасывается, только когда человек заново нажимает «еду»
export async function respondToEvent(input: {
  clubId: string;
  eventId: string;
  membershipId: string;
  response: "going" | "not_going" | "maybe";
  guests?: number;
}): Promise<Seat> {
  const [existing] = await db()
    .select()
    .from(s.eventParticipants)
    .where(and(eq(s.eventParticipants.eventId, input.eventId), eq(s.eventParticipants.membershipId, input.membershipId)));
  const guests = Math.max(0, Math.min(10, input.guests ?? existing?.guests ?? 0));
  if (existing) {
    const requeue = input.response === "going" && existing.response !== "going";
    await db()
      .update(s.eventParticipants)
      .set({ response: input.response, guests, ...(requeue ? { respondedAt: new Date() } : {}) })
      .where(eq(s.eventParticipants.id, existing.id));
  } else {
    await db().insert(s.eventParticipants).values({
      clubId: input.clubId,
      eventId: input.eventId,
      membershipId: input.membershipId,
      response: input.response,
      guests,
    });
  }
  if (input.response !== "going") return { status: "other", place: null };

  const [event] = await db().select().from(s.events).where(eq(s.events.id, input.eventId));
  const rows = await db().select().from(s.eventParticipants).where(eq(s.eventParticipants.eventId, input.eventId));
  const { waitlist } = allocateSeats(rows, event.capacity);
  const place = waitlist.findIndex((r) => r.membershipId === input.membershipId);
  return place >= 0 ? { status: "waitlist", place: place + 1 } : { status: "going", place: null };
}

// ---------------------------------------------------------------- оплаты

// «Я оплатил»: всегда черновик, деньги учитываются после подтверждения начфином
export async function declarePayment(input: {
  clubId: string;
  seasonId: string;
  membershipId: string;
  amount: number;
  createdBy: string;
  paidOn?: string | null;
  method?: "cash" | "transfer";
  note?: string | null;
}) {
  const [p] = await db()
    .insert(s.payments)
    .values({
      clubId: input.clubId,
      seasonId: input.seasonId,
      membershipId: input.membershipId,
      amount: input.amount,
      paidOn: input.paidOn ?? today(),
      method: input.method ?? "transfer",
      note: input.note ?? null,
      status: "draft",
      createdBy: input.createdBy,
    })
    .returning();
  await audit(input.clubId, input.createdBy, "payment.declare", "payment", p.id, { amount: p.amount });
  return p;
}

// Подтверждает или отклоняет черновик. Уже рассмотренный платёж не трогает и возвращает null
export async function reviewPayment(input: { clubId: string; paymentId: string; decision: "confirm" | "reject"; by: string }) {
  const status = input.decision === "confirm" ? "confirmed" : "rejected";
  const [p] = await db()
    .update(s.payments)
    .set({ status, confirmedBy: input.by, confirmedAt: new Date() })
    .where(and(eq(s.payments.id, input.paymentId), eq(s.payments.clubId, input.clubId), eq(s.payments.status, "draft")))
    .returning();
  if (p) await audit(input.clubId, input.by, `payment.${status}`, "payment", p.id, { amount: p.amount });
  return p ?? null;
}

// Баланс одного члена за сезон: плюс — долг, минус — переплата
export async function memberBalance(clubId: string, seasonId: string, membershipId: string) {
  const where = (club: PgColumn, season: PgColumn, member: PgColumn) =>
    and(eq(club, clubId), eq(season, seasonId), eq(member, membershipId));
  const [charges, payments] = await Promise.all([
    db().select().from(s.charges).where(where(s.charges.clubId, s.charges.seasonId, s.charges.membershipId)),
    db().select().from(s.payments).where(where(s.payments.clubId, s.payments.seasonId, s.payments.membershipId)),
  ]);
  return memberBalances(charges, payments).get(membershipId) ?? { membershipId, charged: 0, paid: 0, pending: 0, balance: 0 };
}

// Балансы всех членов клуба за сезон
export async function clubBalances(clubId: string, seasonId: string) {
  const [charges, payments] = await Promise.all([
    db().select().from(s.charges).where(and(eq(s.charges.clubId, clubId), eq(s.charges.seasonId, seasonId))),
    db().select().from(s.payments).where(and(eq(s.payments.clubId, clubId), eq(s.payments.seasonId, seasonId))),
  ]);
  return memberBalances(charges, payments);
}
