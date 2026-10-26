// Что бот отвечает на сообщения и нажатия кнопок, одинаково в Max и в Телеграме.
// Человека узнаём по привязанному аккаунту мессенджера и каждый раз заново проверяем,
// что он состоит в нужном клубе

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { rub } from "@/lib/format";
import { can } from "@/server/permissions";
import { audit, declarePayment, latestSeason, memberBalance, membershipsOf, respondToEvent, reviewPayment } from "@/server/ops";
import { consumeToken, linkPurpose, loginUrl } from "@/server/tokens";
import { decodeAction, encodeAction, parseText } from "./commands";
import { notifyFinanceOfDraft, notifyPayer } from "./notify";
import type { CallbackRef, Incoming, Messenger, OutMessage } from "./types";

const HELP = [
  "Что я умею:",
  "«вход» — пришлю ссылку на сайт клуба",
  "«долг» — сколько вы должны или переплатили",
  "«я оплатил 3000» — отмечу оплату, начфин проверит поступление",
  "Ещё я присылаю мероприятия с кнопками «еду / не еду» и напоминаю о взносах.",
].join("\n");

const notLinked = (bot: Messenger, prefix = ""): OutMessage => ({
  text:
    prefix +
    "Я вас пока не знаю. Нажмите «Поделиться номером»: если этот номер есть в списке клуба, я вас узнаю. " +
    `Или попросите у админа клуба ссылку ${bot.forTitle}.`,
  buttons: [[{ type: "request_contact", text: "Поделиться номером" }]],
});

const userOf = async (bot: Messenger, from: string) => {
  const [u] = await db().select().from(s.users).where(eq(s.users[bot.column], from));
  return u ?? null;
};

// Один аккаунт мессенджера — один человек: если аккаунт был привязан к другому, отвязываем
async function link(bot: Messenger, userId: string, from: string) {
  const col = s.users[bot.column];
  await db().update(s.users).set({ [bot.column]: null }).where(and(eq(col, from), ne(s.users.id, userId)));
  const [u] = await db().update(s.users).set({ [bot.column]: from }).where(eq(s.users.id, userId)).returning();
  for (const { club } of await membershipsOf(userId)) await audit(club.id, userId, `user.${bot.kind}_link`, "user", userId);
  return u;
}

async function welcome(userId: string, fullName: string): Promise<OutMessage> {
  return {
    text: `Здравствуйте, ${fullName}! Теперь я буду присылать сюда мероприятия и напоминания.\n\n${HELP}`,
    buttons: [[{ type: "link", text: "Открыть сайт клуба", url: await loginUrl(userId) }]],
  };
}

async function onStart(bot: Messenger, from: string, payload: string | null) {
  // Ссылка со страницы «Состав» открывает бота с токеном привязки
  const userId = payload ? await consumeToken(payload, linkPurpose(bot.kind)) : null;
  if (userId) {
    const u = await link(bot, userId, from);
    return bot.send(from, await welcome(u.id, u.fullName));
  }
  if (await userOf(bot, from)) return bot.send(from, { text: HELP });
  return bot.send(from, notLinked(bot, payload ? "Ссылка устарела. " : ""));
}

async function onText(bot: Messenger, from: string, text: string | null, ownPhone: string | null, sharedContact: boolean) {
  if (sharedContact) {
    const found = ownPhone
      ? await db().select().from(s.users).where(sql`right(regexp_replace(${s.users.phone}, '[^0-9]', '', 'g'), 10) = ${ownPhone}`)
      : [];
    if (found.length !== 1) {
      return bot.send(from, { text: `Этого номера нет в списке клуба. Попросите у админа клуба ссылку ${bot.forTitle}.` });
    }
    const u = await link(bot, found[0].id, from);
    return bot.send(from, await welcome(u.id, u.fullName));
  }

  const user = await userOf(bot, from);
  if (!user) return bot.send(from, notLinked(bot));
  const cmd = parseText(text);
  const clubs = await membershipsOf(user.id);

  if (cmd.kind === "login") {
    return bot.send(from, {
      text: "Ссылка для входа действует 7 дней и срабатывает один раз.",
      buttons: [[{ type: "link", text: "Открыть сайт клуба", url: await loginUrl(user.id) }]],
    });
  }
  if (cmd.kind === "balance") {
    const lines = [];
    for (const { club, membership } of clubs) {
      const season = await latestSeason(club.id);
      if (!season) continue;
      const b = await memberBalance(club.id, season.id, membership.id);
      const state = b.balance > 0 ? `долг ${rub(b.balance)}` : b.balance < 0 ? `переплата ${rub(-b.balance)}` : "долгов нет";
      lines.push(`${club.name}, ${season.title}: ${state}` + (b.pending ? ` (ждёт проверки ${rub(b.pending)})` : ""));
    }
    return bot.send(from, { text: lines.join("\n") || "Сезонов пока нет." });
  }
  if (cmd.kind === "paid") {
    // Спрашиваем подтверждение: так случайная цифра в сообщении не станет оплатой
    return bot.send(from, {
      text: `Отметить оплату ${rub(cmd.amount)}? Начфин подтвердит, когда увидит деньги.`,
      buttons: clubs.map(({ club, membership }) => [
        {
          type: "callback" as const,
          text: clubs.length > 1 ? `Да, в ${club.name}` : "Да, отметить",
          payload: encodeAction({ kind: "declare", membershipId: membership.id, amount: cmd.amount }),
        },
      ]),
    });
  }
  return bot.send(from, { text: HELP });
}

async function onButton(bot: Messenger, from: string, payload: string | null, cb: CallbackRef) {
  const user = await userOf(bot, from);
  const action = decodeAction(payload);
  if (!user || !action) return bot.answer(cb, "Не получилось. Напишите «вход» и сделайте это на сайте.");
  const clubs = await membershipsOf(user.id);

  if (action.kind === "rsvp") {
    const [event] = await db().select().from(s.events).where(eq(s.events.id, action.eventId));
    const mine = clubs.find((c) => c.club.id === event?.clubId);
    if (!event || !mine) return bot.answer(cb, "Мероприятие не найдено");
    if (event.status !== "planned") return bot.answer(cb, "Мероприятие уже прошло или отменено");
    const seat = await respondToEvent({ clubId: event.clubId, eventId: event.id, membershipId: mine.membership.id, response: action.response });
    const note =
      seat.status === "waitlist"
        ? `Мест нет, вы в листе ожидания: ${seat.place}-й`
        : action.response === "going"
          ? "Записал: еду"
          : action.response === "maybe"
            ? "Записал: пока не знаю"
            : "Записал: не еду";
    return bot.answer(cb, note);
  }

  if (action.kind === "declare") {
    const mine = clubs.find((c) => c.membership.id === action.membershipId);
    const season = mine && (await latestSeason(mine.club.id));
    if (!mine || !season) return bot.answer(cb, "Не нашёл вас в клубе");
    const p = await declarePayment({
      clubId: mine.club.id,
      seasonId: season.id,
      membershipId: mine.membership.id,
      amount: action.amount,
      createdBy: user.id,
      note: `Отмечено ${bot.inTitle}`,
    });
    await notifyFinanceOfDraft(p.id);
    return bot.answer(cb, "Отметил", { text: `Отмечена оплата ${rub(p.amount)}. Начфин проверит поступление и подтвердит.` });
  }

  // Подтвердить или отклонить оплату может только начфин этого клуба
  const [payment] = await db().select().from(s.payments).where(eq(s.payments.id, action.paymentId));
  const mine = clubs.find((c) => c.club.id === payment?.clubId);
  if (!payment || !mine || !can(mine.membership.role, "manageMoney")) return bot.answer(cb, "Недостаточно прав");
  const done = await reviewPayment({ clubId: payment.clubId, paymentId: payment.id, decision: action.decision, by: user.id });
  if (!done) return bot.answer(cb, "Эта оплата уже рассмотрена");
  await notifyPayer(done.id);
  const verdict = done.status === "confirmed" ? "Подтверждено" : "Отклонено";
  return bot.answer(cb, verdict, { text: `${verdict}: оплата ${rub(done.amount)}.` });
}

export async function handleIncoming(bot: Messenger, e: Incoming | null) {
  if (!e) return;
  if (e.type === "start") return onStart(bot, e.from, e.payload);
  if (e.type === "text") return onText(bot, e.from, e.text, e.ownPhone, e.sharedContact);
  return onButton(bot, e.from, e.payload, e.callback);
}
