// Что бот отвечает на сообщения и нажатия кнопок. Человека узнаём по привязанному
// аккаунту Max и каждый раз заново проверяем, что он состоит в нужном клубе

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { rub } from "@/lib/format";
import { can } from "@/server/permissions";
import { audit, declarePayment, latestSeason, memberBalance, membershipsOf, respondToEvent, reviewPayment } from "@/server/ops";
import { consumeToken, loginUrl } from "@/server/tokens";
import { decodeAction, encodeAction, parseText, phoneFromVcf } from "./commands";
import type { MaxApi, MaxUpdate, MaxUser, OutMessage } from "./max-api";
import { notifyFinanceOfDraft, notifyPayer } from "./notify";

const HELP = [
  "Что я умею:",
  "«вход» — пришлю ссылку на сайт клуба",
  "«долг» — сколько вы должны или переплатили",
  "«я оплатил 3000» — отмечу оплату, начфин проверит поступление",
  "Ещё я присылаю мероприятия с кнопками «еду / не еду» и напоминаю о взносах.",
].join("\n");

const NOT_LINKED: OutMessage = {
  text:
    "Я вас пока не знаю. Нажмите «Поделиться номером»: если этот номер есть в списке клуба, я вас узнаю. " +
    "Или попросите у админа клуба ссылку для Max.",
  buttons: [[{ type: "request_contact", text: "Поделиться номером" }]],
};

const userByMax = async (maxUser: MaxUser) => {
  const [u] = await db().select().from(s.users).where(eq(s.users.maxUserId, String(maxUser.user_id)));
  return u ?? null;
};

// Один аккаунт Max — один человек: если аккаунт был привязан к другому, отвязываем
async function link(userId: string, maxUser: MaxUser) {
  const maxUserId = String(maxUser.user_id);
  await db().update(s.users).set({ maxUserId: null }).where(and(eq(s.users.maxUserId, maxUserId), ne(s.users.id, userId)));
  const [u] = await db().update(s.users).set({ maxUserId }).where(eq(s.users.id, userId)).returning();
  for (const { club } of await membershipsOf(userId)) await audit(club.id, userId, "user.max_link", "user", userId);
  return u;
}

async function welcome(userId: string, fullName: string): Promise<OutMessage> {
  return {
    text: `Здравствуйте, ${fullName}! Теперь я буду присылать сюда мероприятия и напоминания.\n\n${HELP}`,
    buttons: [[{ type: "link", text: "Открыть сайт клуба", url: await loginUrl(userId) }]],
  };
}

async function onText(api: MaxApi, maxUser: MaxUser, text: string | null) {
  const user = await userByMax(maxUser);
  if (!user) return api.send(maxUser.user_id, NOT_LINKED);
  const cmd = parseText(text);
  const clubs = await membershipsOf(user.id);

  if (cmd.kind === "login") {
    return api.send(maxUser.user_id, {
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
    return api.send(maxUser.user_id, { text: lines.join("\n") || "Сезонов пока нет." });
  }
  if (cmd.kind === "paid") {
    // Спрашиваем подтверждение: так случайная цифра в сообщении не станет оплатой
    return api.send(maxUser.user_id, {
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
  return api.send(maxUser.user_id, { text: HELP });
}

async function onCallback(api: MaxApi, callbackId: string, maxUser: MaxUser, payload: string | undefined) {
  const user = await userByMax(maxUser);
  const action = decodeAction(payload);
  if (!user || !action) return api.answer(callbackId, "Не получилось. Напишите «вход» и сделайте это на сайте.");
  const clubs = await membershipsOf(user.id);

  if (action.kind === "rsvp") {
    const [event] = await db().select().from(s.events).where(eq(s.events.id, action.eventId));
    const mine = clubs.find((c) => c.club.id === event?.clubId);
    if (!event || !mine) return api.answer(callbackId, "Мероприятие не найдено");
    if (event.status !== "planned") return api.answer(callbackId, "Мероприятие уже прошло или отменено");
    const seat = await respondToEvent({ clubId: event.clubId, eventId: event.id, membershipId: mine.membership.id, response: action.response });
    const note =
      seat.status === "waitlist"
        ? `Мест нет, вы в листе ожидания: ${seat.place}-й`
        : action.response === "going"
          ? "Записал: еду"
          : action.response === "maybe"
            ? "Записал: пока не знаю"
            : "Записал: не еду";
    return api.answer(callbackId, note);
  }

  if (action.kind === "declare") {
    const mine = clubs.find((c) => c.membership.id === action.membershipId);
    const season = mine && (await latestSeason(mine.club.id));
    if (!mine || !season) return api.answer(callbackId, "Не нашёл вас в клубе");
    const p = await declarePayment({
      clubId: mine.club.id,
      seasonId: season.id,
      membershipId: mine.membership.id,
      amount: action.amount,
      createdBy: user.id,
      note: "Отмечено в Max",
    });
    await notifyFinanceOfDraft(p.id);
    return api.answer(callbackId, "Отметил", { text: `Отмечена оплата ${rub(p.amount)}. Начфин проверит поступление и подтвердит.` });
  }

  // Подтвердить или отклонить оплату может только начфин этого клуба
  const [payment] = await db().select().from(s.payments).where(eq(s.payments.id, action.paymentId));
  const mine = clubs.find((c) => c.club.id === payment?.clubId);
  if (!payment || !mine || !can(mine.membership.role, "manageMoney")) return api.answer(callbackId, "Недостаточно прав");
  const done = await reviewPayment({ clubId: payment.clubId, paymentId: payment.id, decision: action.decision, by: user.id });
  if (!done) return api.answer(callbackId, "Эта оплата уже рассмотрена");
  await notifyPayer(done.id);
  const verdict = done.status === "confirmed" ? "Подтверждено" : "Отклонено";
  return api.answer(callbackId, verdict, { text: `${verdict}: оплата ${rub(done.amount)}.` });
}

export async function handleUpdate(api: MaxApi, update: MaxUpdate) {
  if (update.update_type === "bot_started" && "user" in update) {
    // Ссылка из раздела «Состав» открывает бота с токеном привязки
    const userId = update.payload ? await consumeToken(update.payload, "max_link") : null;
    if (userId) {
      const u = await link(userId, update.user);
      return api.send(update.user.user_id, await welcome(u.id, u.fullName));
    }
    const known = await userByMax(update.user);
    if (known) return api.send(update.user.user_id, { text: HELP });
    return api.send(update.user.user_id, update.payload ? { ...NOT_LINKED, text: "Ссылка устарела. " + NOT_LINKED.text } : NOT_LINKED);
  }

  if (update.update_type === "message_created" && "message" in update) {
    const { message } = update;
    const sender = message.sender;
    // Отвечаем только в личной переписке с ботом, групповые чаты не трогаем
    if (!sender || sender.is_bot || (message.recipient.chat_type && message.recipient.chat_type !== "dialog")) return;
    // Номер принимаем только свой: карточка контакта должна принадлежать отправителю
    const contact = message.body.attachments?.find((a) => a.type === "contact");
    if (contact && contact.type === "contact") {
      const c = contact.payload as { vcf_info: string; max_info?: MaxUser | null };
      const phone = c.max_info?.user_id === sender.user_id ? phoneFromVcf(c.vcf_info) : null;
      const found = phone
        ? await db().select().from(s.users).where(sql`right(regexp_replace(${s.users.phone}, '[^0-9]', '', 'g'), 10) = ${phone}`)
        : [];
      if (found.length !== 1) {
        return api.send(sender.user_id, { text: "Этого номера нет в списке клуба. Попросите у админа клуба ссылку для Max." });
      }
      const u = await link(found[0].id, sender);
      return api.send(sender.user_id, await welcome(u.id, u.fullName));
    }
    return onText(api, sender, message.body.text);
  }

  if (update.update_type === "message_callback" && "callback" in update) {
    const { callback } = update;
    return onCallback(api, callback.callback_id, callback.user, callback.payload);
  }
}
