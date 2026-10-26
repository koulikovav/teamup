// Сообщения, которые бот рассылает сам: начфину о заявленной оплате,
// членам о новом мероприятии, должникам о долге. Уходят в каждый подключённый
// мессенджер человека. Без токенов ботов ничего не отправляется

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { day, rub } from "@/lib/format";
import { clubBalances, latestSeason } from "@/server/ops";
import { appUrl } from "@/server/tokens";
import { encodeAction } from "./commands";
import { maxApi, maxMessenger } from "./max-api";
import { telegramApi, telegramMessenger } from "./telegram-api";
import type { Messenger, OutMessage } from "./types";

// Мессенджеры, для которых заданы токены ботов
export function messengers(): Messenger[] {
  const list: Messenger[] = [];
  if (process.env.MAX_BOT_TOKEN) list.push(maxMessenger(maxApi(process.env.MAX_BOT_TOKEN)));
  if (process.env.TELEGRAM_BOT_TOKEN) list.push(telegramMessenger(telegramApi(process.env.TELEGRAM_BOT_TOKEN)));
  return list;
}

export type Sent = { sent: number; notLinked: string[]; failed: number };

type Person = { fullName: string; maxUserId: string | null; telegramUserId: string | null };

// Человек получает сообщение в каждом подключённом мессенджере; считаем людей, а не сообщения
async function sendAll(bots: Messenger[], people: Person[], make: (i: number) => OutMessage) {
  const result: Sent = { sent: 0, notLinked: [], failed: 0 };
  for (const [i, p] of people.entries()) {
    const targets = bots.filter((b) => p[b.column]);
    if (!targets.length) {
      result.notLinked.push(p.fullName);
      continue;
    }
    let ok = false;
    for (const b of targets) {
      try {
        await b.send(p[b.column]!, make(i));
        ok = true;
      } catch (e) {
        console.error(`Не отправлено ${b.inTitle}: ${p.fullName}:`, e);
      }
    }
    if (ok) result.sent++;
    else result.failed++;
  }
  return result;
}

function people(clubId: string, filter?: { roles?: ("finance_admin" | "admin" | "member")[]; membershipIds?: string[] }) {
  return db()
    .select({
      membershipId: s.memberships.id,
      fullName: s.users.fullName,
      maxUserId: s.users.maxUserId,
      telegramUserId: s.users.telegramUserId,
    })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .where(
      and(
        eq(s.memberships.clubId, clubId),
        eq(s.memberships.status, "active"),
        filter?.roles ? inArray(s.memberships.role, filter.roles) : undefined,
        filter?.membershipIds ? inArray(s.memberships.id, filter.membershipIds) : undefined,
      ),
    );
}

// Начфин получает заявленную оплату с кнопками «Подтвердить» и «Отклонить»
export async function notifyFinanceOfDraft(paymentId: string) {
  const bots = messengers();
  if (!bots.length) return;
  const [row] = await db()
    .select({ payment: s.payments, fullName: s.users.fullName, club: s.clubs })
    .from(s.payments)
    .innerJoin(s.memberships, eq(s.payments.membershipId, s.memberships.id))
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .innerJoin(s.clubs, eq(s.payments.clubId, s.clubs.id))
    .where(eq(s.payments.id, paymentId));
  if (!row) return;
  const finance = await people(row.club.id, { roles: ["finance_admin"] });
  await sendAll(bots, finance, () => ({
    text: `${row.club.name}: ${row.fullName} отметил оплату ${rub(row.payment.amount)} от ${day(row.payment.paidOn)}. Деньги пришли?`,
    buttons: [
      [
        { type: "callback", text: "Подтвердить", payload: encodeAction({ kind: "review", paymentId, decision: "confirm" }) },
        { type: "callback", text: "Отклонить", payload: encodeAction({ kind: "review", paymentId, decision: "reject" }) },
      ],
    ],
  }));
}

export async function notifyPayer(paymentId: string) {
  const bots = messengers();
  if (!bots.length) return;
  const [row] = await db()
    .select({
      payment: s.payments,
      fullName: s.users.fullName,
      maxUserId: s.users.maxUserId,
      telegramUserId: s.users.telegramUserId,
      club: s.clubs.name,
    })
    .from(s.payments)
    .innerJoin(s.memberships, eq(s.payments.membershipId, s.memberships.id))
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .innerJoin(s.clubs, eq(s.payments.clubId, s.clubs.id))
    .where(eq(s.payments.id, paymentId));
  if (!row || row.payment.status === "draft") return;
  const text =
    row.payment.status === "confirmed"
      ? `${row.club}: начфин подтвердил вашу оплату ${rub(row.payment.amount)}. Спасибо!`
      : `${row.club}: начфин не нашёл вашу оплату ${rub(row.payment.amount)}. Свяжитесь с ним, пожалуйста.`;
  await sendAll(bots, [row], () => ({ text }));
}

// Рассылка о мероприятии всем активным членам с кнопками ответа
export async function announceEvent(eventId: string): Promise<Sent | null> {
  const bots = messengers();
  if (!bots.length) return null;
  const [row] = await db()
    .select({ event: s.events, club: s.clubs })
    .from(s.events)
    .innerJoin(s.clubs, eq(s.events.clubId, s.clubs.id))
    .where(eq(s.events.id, eventId));
  if (!row) return null;
  const { event, club } = row;
  const when = event.endsOn && event.endsOn !== event.startsOn ? `${day(event.startsOn)} – ${day(event.endsOn)}` : day(event.startsOn);
  const lines = [
    `${club.name}: ${event.title}`,
    `Когда: ${when}`,
    event.location && `Где: ${event.location}`,
    event.capacity && `Мест: ${event.capacity}, кто первый ответит «еду», тот едет`,
    event.mandatory && `Обязательное${event.missPenalty ? `, штраф за пропуск ${rub(event.missPenalty)}` : ""}`,
  ].filter(Boolean);
  const answer = (text: string, response: "going" | "not_going" | "maybe") => ({
    type: "callback" as const,
    text,
    payload: encodeAction({ kind: "rsvp", eventId, response }),
  });
  return sendAll(bots, await people(club.id), () => ({
    text: lines.join("\n"),
    buttons: [
      [answer("Еду", "going"), answer("Не знаю", "maybe"), answer("Не еду", "not_going")],
      [{ type: "link", text: "Подробнее на сайте", url: `${appUrl()}/c/${club.slug}/events/${eventId}` }],
    ],
  }));
}

// Мягкое напоминание тем, у кого долг. Кнопка сразу заводит черновик оплаты на всю сумму
export async function remindDebtors(clubId: string): Promise<Sent | null> {
  const bots = messengers();
  if (!bots.length) return null;
  const [club] = await db().select().from(s.clubs).where(eq(s.clubs.id, clubId));
  const season = await latestSeason(clubId);
  if (!club || !season) return null;
  const balances = await clubBalances(clubId, season.id);
  // Кто уже заявил оплату на весь долг, ждёт проверки — ему не напоминаем
  const debt = new Map([...balances.values()].filter((b) => b.balance - b.pending > 0).map((b) => [b.membershipId, b.balance - b.pending]));
  if (debt.size === 0) return { sent: 0, notLinked: [], failed: 0 };
  const list = await people(clubId, { membershipIds: [...debt.keys()] });
  return sendAll(bots, list, (i) => {
    const amount = debt.get(list[i].membershipId)!;
    return {
      text:
        `${club.name}: напоминание о взносах за «${season.title}». За вами ${rub(amount)}.` +
        (season.feeDueOn ? ` Срок был до ${day(season.feeDueOn)}.` : "") +
        ` Если уже перевели, нажмите кнопку ниже, начфин проверит.`,
      buttons: [
        [
          {
            type: "callback",
            text: `Я оплатил ${rub(amount)}`,
            payload: encodeAction({ kind: "declare", membershipId: list[i].membershipId, amount }),
          },
        ],
      ],
    };
  });
}
