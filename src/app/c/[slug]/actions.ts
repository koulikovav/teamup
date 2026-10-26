"use server";

// Действия на страницах клуба. Каждое проверяет права заново: форму можно отправить
// в обход интерфейса, поэтому доверять скрытым кнопкам нельзя.

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { penaltiesForEvent } from "@/domain/penalties";
import { parseRub, today } from "@/lib/format";
import { announceEvent, notifyFinanceOfDraft, notifyPayer, remindDebtors, type Sent } from "@/bot/notify";
import { signOut } from "@/server/auth";
import { audit, clubContext, requirePermission, requireSeason } from "@/server/club";
import * as ops from "@/server/ops";
import { loginUrl, maxLinkUrl } from "@/server/tokens";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const need = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!v) throw new Error(`Не заполнено поле ${k}`);
  return v;
};
const amount = (f: FormData, k = "amount") => {
  const v = parseRub(f.get(k));
  if (v === null) throw new Error("Сумма должна быть больше нуля");
  return v;
};
const isoDate = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Неверная дата");
  return v;
};
const done = (slug: string, path = "") => revalidatePath(`/c/${slug}${path}`);

// Сбой Max не должен ломать действие на сайте: оплата уже записана
const quietly = (p: Promise<unknown>) => p.catch((e) => console.error("Max:", e));

function sentText(res: Sent | null) {
  if (!res) return "Бот в Max ещё не подключён";
  const parts = [`Отправлено в Max: ${res.sent}`];
  if (res.failed) parts.push(`не дошло: ${res.failed}`);
  if (res.notLinked.length) parts.push(`без Max: ${res.notLinked.join(", ")}`);
  return parts.join(". ");
}

async function ownMembership(clubId: string, membershipId: string) {
  const [m] = await db()
    .select()
    .from(s.memberships)
    .where(and(eq(s.memberships.id, membershipId), eq(s.memberships.clubId, clubId)));
  if (!m) throw new Error("Член клуба не найден");
  return m;
}

// ---------------------------------------------------------------- оплаты

// «Я оплатил»: всегда черновик, деньги учитываются после подтверждения начфином.
// Начфин может завести черновик за другого члена
export async function declarePayment(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await clubContext(slug);
  const season = requireSeason(ctx);
  const target = str(f, "membershipId");
  const membershipId = target && ctx.can("manageMoney") ? target : ctx.membership.id;
  await ownMembership(ctx.club.id, membershipId);

  const p = await ops.declarePayment({
    clubId: ctx.club.id,
    seasonId: season.id,
    membershipId,
    amount: amount(f),
    paidOn: isoDate(f, "paidOn"),
    method: str(f, "method") === "cash" ? "cash" : "transfer",
    note: str(f, "note"),
    createdBy: ctx.user.id,
  });
  // Свой черновик начфин и так видит на странице, сообщение в Max нужно, когда отмечает другой
  if (!ctx.can("manageMoney")) await quietly(notifyFinanceOfDraft(p.id));
  done(slug, "/money");
}

export async function reviewPayment(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const p = await ops.reviewPayment({
    clubId: ctx.club.id,
    paymentId: need(f, "paymentId"),
    decision: need(f, "decision") === "confirm" ? "confirm" : "reject",
    by: ctx.user.id,
  });
  if (p) await quietly(notifyPayer(p.id));
  done(slug, "/money");
}

// Напоминание должникам в Max. Возвращает строку для показа на странице
export async function remindDebtorsNow(_prev: string | null, f: FormData): Promise<string | null> {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const res = await remindDebtors(ctx.club.id);
  await audit(ctx, "bot.remind_debts", "club", ctx.club.id, res);
  return sentText(res);
}

// ---------------------------------------------------------------- начисления

// Начисляет годовой взнос всем активным членам с категорией, кому он ещё не начислен
export async function chargeSeasonFees(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const season = requireSeason(ctx);

  const rates = await db().select().from(s.seasonFeeRates).where(eq(s.seasonFeeRates.seasonId, season.id));
  const rate = new Map(rates.map((r) => [r.feeCategoryId, r.amount]));
  const active = await db()
    .select()
    .from(s.memberships)
    .where(and(eq(s.memberships.clubId, ctx.club.id), eq(s.memberships.status, "active")));
  const already = await db()
    .select({ membershipId: s.charges.membershipId })
    .from(s.charges)
    .where(
      and(eq(s.charges.seasonId, season.id), eq(s.charges.kind, "membership_fee"), isNull(s.charges.cancelledAt)),
    );
  const charged = new Set(already.map((c) => c.membershipId));

  const rows = active
    .filter((m) => m.feeCategoryId && rate.get(m.feeCategoryId) && !charged.has(m.id))
    .map((m) => ({
      clubId: ctx.club.id,
      seasonId: season.id,
      membershipId: m.id,
      kind: "membership_fee" as const,
      amount: rate.get(m.feeCategoryId!)!,
      createdBy: ctx.user.id,
    }));
  if (rows.length) await db().insert(s.charges).values(rows);
  await audit(ctx, "charge.season_fees", "season", season.id, { count: rows.length });
  done(slug, "/money");
}

export async function addCharge(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const season = requireSeason(ctx);
  const membershipId = need(f, "membershipId");
  await ownMembership(ctx.club.id, membershipId);
  const kind = str(f, "kind");
  const [c] = await db()
    .insert(s.charges)
    .values({
      clubId: ctx.club.id,
      seasonId: season.id,
      membershipId,
      kind: kind === "penalty" || kind === "event_fee" ? kind : "other",
      amount: amount(f),
      note: str(f, "note"),
      createdBy: ctx.user.id,
    })
    .returning();
  await audit(ctx, "charge.add", "charge", c.id, { amount: c.amount, kind: c.kind });
  done(slug, "/money");
}

export async function cancelCharge(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const [c] = await db()
    .update(s.charges)
    .set({ cancelledAt: new Date(), cancelledBy: ctx.user.id, cancelReason: need(f, "reason") })
    .where(and(eq(s.charges.id, need(f, "chargeId")), eq(s.charges.clubId, ctx.club.id), isNull(s.charges.cancelledAt)))
    .returning();
  if (c) await audit(ctx, "charge.cancel", "charge", c.id, { reason: c.cancelReason });
  done(slug, "/money");
}

// ---------------------------------------------------------------- расходы

export async function addExpense(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "addExpense");
  const season = requireSeason(ctx);
  // Расход начфина сразу подтверждён, расход председателя ждёт подтверждения
  const finance = ctx.can("manageMoney");
  const [e] = await db()
    .insert(s.expenses)
    .values({
      clubId: ctx.club.id,
      seasonId: season.id,
      budgetItemId: str(f, "budgetItemId"),
      eventId: str(f, "eventId"),
      amount: amount(f),
      spentOn: isoDate(f, "spentOn") ?? today(),
      payee: str(f, "payee"),
      description: need(f, "description"),
      status: finance ? "confirmed" : "draft",
      createdBy: ctx.user.id,
      confirmedBy: finance ? ctx.user.id : null,
      confirmedAt: finance ? new Date() : null,
    })
    .returning();
  await audit(ctx, "expense.add", "expense", e.id, { amount: e.amount });
  done(slug, "/expenses");
}

export async function reviewExpense(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const status = need(f, "decision") === "confirm" ? "confirmed" : "rejected";
  const [e] = await db()
    .update(s.expenses)
    .set({ status, confirmedBy: ctx.user.id, confirmedAt: new Date() })
    .where(and(eq(s.expenses.id, need(f, "expenseId")), eq(s.expenses.clubId, ctx.club.id), eq(s.expenses.status, "draft")))
    .returning();
  if (e) await audit(ctx, `expense.${status}`, "expense", e.id, { amount: e.amount });
  done(slug, "/expenses");
}

// ---------------------------------------------------------------- состав

export async function addMember(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMembers");
  const [user] = await db()
    .insert(s.users)
    .values({ fullName: need(f, "fullName"), phone: str(f, "phone") })
    .returning();
  const [m] = await db()
    .insert(s.memberships)
    .values({
      clubId: ctx.club.id,
      userId: user.id,
      feeCategoryId: str(f, "feeCategoryId"),
      memberNo: Number(str(f, "memberNo")) || null,
      joinedOn: today(),
    })
    .returning();
  await audit(ctx, "member.add", "membership", m.id, { fullName: user.fullName });
  done(slug, "/members");
}

export async function updateMember(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMembers");
  const m = await ownMembership(ctx.club.id, need(f, "membershipId"));
  const status = str(f, "status");
  const role = str(f, "role");
  const changes: Partial<typeof s.memberships.$inferInsert> = {};
  if (status === "active" || status === "inactive" || status === "left") changes.status = status;
  if (role === "finance_admin" || role === "admin" || role === "member") changes.role = role;
  if (f.has("feeCategoryId")) changes.feeCategoryId = str(f, "feeCategoryId");
  // Себя нельзя лишить прав админа, иначе клуб может остаться без управления
  if (m.id === ctx.membership.id && changes.role && changes.role !== ctx.membership.role) {
    throw new Error("Свою роль меняет другой админ");
  }
  await db().update(s.memberships).set(changes).where(eq(s.memberships.id, m.id));
  await audit(ctx, "member.update", "membership", m.id, changes);
  done(slug, "/members");
}

export async function makeLoginLink(_prev: string | null, f: FormData): Promise<string | null> {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMembers");
  const m = await ownMembership(ctx.club.id, need(f, "membershipId"));
  const url = await loginUrl(m.userId);
  await audit(ctx, "member.login_link", "membership", m.id);
  return url;
}

// Ссылка открывает бота в Max и привязывает аккаунт к этому человеку
export async function makeMaxLink(_prev: string | null, f: FormData): Promise<string | null> {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMembers");
  const m = await ownMembership(ctx.club.id, need(f, "membershipId"));
  const url = await maxLinkUrl(m.userId);
  if (!url) return "Бот в Max ещё не подключён";
  await audit(ctx, "member.max_link", "membership", m.id);
  return url;
}

// ---------------------------------------------------------------- мероприятия

export async function createEvent(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageEvents");
  const season = requireSeason(ctx);
  const kind = need(f, "kind") as (typeof s.eventKindEnum.enumValues)[number];
  if (!s.eventKindEnum.enumValues.includes(kind)) throw new Error("Неизвестный вид мероприятия");
  const [e] = await db()
    .insert(s.events)
    .values({
      clubId: ctx.club.id,
      seasonId: season.id,
      kind,
      title: need(f, "title"),
      startsOn: isoDate(f, "startsOn") ?? today(),
      endsOn: isoDate(f, "endsOn"),
      location: str(f, "location"),
      capacity: Number(str(f, "capacity")) || null,
      mandatory: f.get("mandatory") === "on",
      missPenalty: parseRub(f.get("missPenalty")),
      createdBy: ctx.user.id,
    })
    .returning();
  await audit(ctx, "event.create", "event", e.id, { title: e.title });
  redirect(`/c/${slug}/events/${e.id}`);
}

async function clubEvent(clubId: string, eventId: string) {
  const [e] = await db()
    .select()
    .from(s.events)
    .where(and(eq(s.events.id, eventId), eq(s.events.clubId, clubId)));
  if (!e) throw new Error("Мероприятие не найдено");
  return e;
}

// Отклик члена на мероприятие
export async function rsvp(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await clubContext(slug);
  const event = await clubEvent(ctx.club.id, need(f, "eventId"));
  const response = need(f, "response") as "going" | "not_going" | "maybe";
  if (!["going", "not_going", "maybe"].includes(response)) throw new Error("Неверный ответ");
  await ops.respondToEvent({
    clubId: ctx.club.id,
    eventId: event.id,
    membershipId: ctx.membership.id,
    response,
    guests: Number(str(f, "guests")) || 0,
  });
  done(slug, `/events/${event.id}`);
}

export async function announceEventNow(_prev: string | null, f: FormData): Promise<string | null> {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageEvents");
  const event = await clubEvent(ctx.club.id, need(f, "eventId"));
  const res = await announceEvent(event.id);
  await audit(ctx, "bot.announce_event", "event", event.id, res);
  return sentText(res);
}

export async function setOverCapacity(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageEvents");
  const event = await clubEvent(ctx.club.id, need(f, "eventId"));
  await db()
    .update(s.eventParticipants)
    .set({ overCapacity: f.get("value") === "on" })
    .where(and(eq(s.eventParticipants.eventId, event.id), eq(s.eventParticipants.membershipId, need(f, "membershipId"))));
  done(slug, `/events/${event.id}`);
}

// Отметка присутствия: галочки по всем активным членам
export async function markAttendance(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageEvents");
  const event = await clubEvent(ctx.club.id, need(f, "eventId"));
  const present = new Set(f.getAll("present").map(String));
  const active = await db()
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(and(eq(s.memberships.clubId, ctx.club.id), eq(s.memberships.status, "active")));
  const rows = await db().select().from(s.eventParticipants).where(eq(s.eventParticipants.eventId, event.id));
  const byMember = new Map(rows.map((r) => [r.membershipId, r]));

  for (const m of active) {
    const attended = present.has(m.id);
    const row = byMember.get(m.id);
    if (row) {
      await db().update(s.eventParticipants).set({ attended }).where(eq(s.eventParticipants.id, row.id));
    } else {
      await db().insert(s.eventParticipants).values({
        clubId: ctx.club.id,
        eventId: event.id,
        membershipId: m.id,
        response: attended ? "going" : "not_going",
        attended,
      });
    }
  }
  await db().update(s.events).set({ status: "done" }).where(eq(s.events.id, event.id));
  await audit(ctx, "event.attendance", "event", event.id, { present: present.size });
  done(slug, `/events/${event.id}`);
}

// Штрафы пропустившим обязательное мероприятие. Повторное нажатие ничего не задвоит
export async function applyPenalties(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const season = requireSeason(ctx);
  const event = await clubEvent(ctx.club.id, need(f, "eventId"));
  if (!event.mandatory || !event.missPenalty) throw new Error("У мероприятия нет штрафа за пропуск");

  const active = await db()
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(and(eq(s.memberships.clubId, ctx.club.id), eq(s.memberships.status, "active")));
  const attended = await db()
    .select({ id: s.eventParticipants.membershipId })
    .from(s.eventParticipants)
    .where(and(eq(s.eventParticipants.eventId, event.id), eq(s.eventParticipants.attended, true)));
  const fined = await db()
    .select({ id: s.charges.membershipId })
    .from(s.charges)
    .where(and(eq(s.charges.eventId, event.id), eq(s.charges.kind, "penalty"), isNull(s.charges.cancelledAt)));
  const finedIds = new Set(fined.map((x) => x.id));

  const penalties = penaltiesForEvent({
    eventId: event.id,
    activeMembershipIds: active.map((m) => m.id),
    attendedMembershipIds: attended.map((m) => m.id),
    amount: event.missPenalty,
  }).filter((p) => !finedIds.has(p.membershipId));

  if (penalties.length) {
    await db()
      .insert(s.charges)
      .values(
        penalties.map((p) => ({
          ...p,
          clubId: ctx.club.id,
          seasonId: season.id,
          note: `Пропуск: ${event.title}`,
          createdBy: ctx.user.id,
        })),
      );
  }
  await audit(ctx, "event.penalties", "event", event.id, { count: penalties.length });
  done(slug, `/events/${event.id}`);
}

// ---------------------------------------------------------------- сезон

export async function createSeason(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const [season] = await db()
    .insert(s.seasons)
    .values({
      clubId: ctx.club.id,
      title: need(f, "title"),
      startsOn: isoDate(f, "startsOn") ?? today(),
      endsOn: need(f, "endsOn"),
      feeDueOn: isoDate(f, "feeDueOn"),
      openingBalance: Math.round(Number((str(f, "openingBalance") ?? "0").replace(/\s/g, "").replace(",", ".")) * 100) || 0,
    })
    .returning();
  await audit(ctx, "season.create", "season", season.id, { title: season.title });
  done(slug);
}

export async function addFeeCategory(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const season = requireSeason(ctx);
  const [cat] = await db().insert(s.feeCategories).values({ clubId: ctx.club.id, name: need(f, "name") }).returning();
  await db()
    .insert(s.seasonFeeRates)
    .values({ clubId: ctx.club.id, seasonId: season.id, feeCategoryId: cat.id, amount: amount(f) });
  await audit(ctx, "fee_category.add", "fee_category", cat.id, { name: cat.name });
  done(slug, "/settings");
}

export async function addBudgetItem(f: FormData) {
  const slug = need(f, "slug");
  const ctx = await requirePermission(slug, "manageMoney");
  const season = requireSeason(ctx);
  const [item] = await db()
    .insert(s.budgetItems)
    .values({
      clubId: ctx.club.id,
      seasonId: season.id,
      direction: str(f, "direction") === "income" ? "income" : "expense",
      name: need(f, "name"),
      plannedAmount: parseRub(f.get("planned")) ?? 0,
    })
    .returning();
  await audit(ctx, "budget_item.add", "budget_item", item.id, { name: item.name });
  done(slug, "/settings");
}

export async function logout() {
  await signOut();
  redirect("/");
}

