// Общий язык ботов. Max и Телеграм устроены по-разному, но для TeamUp одинаково:
// человек пишет текст, нажимает кнопку или открывает бота по ссылке, а бот отвечает

import type * as s from "@/db/schema";

export type Button =
  | { type: "callback"; text: string; payload: string }
  | { type: "link"; text: string; url: string }
  | { type: "request_contact"; text: string };

export type OutMessage = { text: string; buttons?: Button[][] };

export type MessengerKind = "max" | "telegram";

// Ссылка на нажатую кнопку: по ней бот отвечает всплывающим уведомлением и правит сообщение
export type CallbackRef = { id: string; chatId?: string; messageId?: string };

export type Incoming =
  // Человек открыл бота, возможно по ссылке с токеном привязки
  | { type: "start"; from: string; payload: string | null }
  // Текст или карточка контакта. Телефон заполнен, только если человек поделился своим номером
  | { type: "text"; from: string; text: string | null; ownPhone: string | null; sharedContact: boolean }
  | { type: "button"; from: string; payload: string | null; callback: CallbackRef };

export type Messenger = {
  kind: MessengerKind;
  // Название для людей в нужном падеже: «для Телеграма», «в Телеграме»
  forTitle: string;
  inTitle: string;
  // Колонка в таблице users, где хранится id человека в этом мессенджере
  column: "maxUserId" | "telegramUserId";
  send(userId: string, m: OutMessage): Promise<unknown>;
  answer(callback: CallbackRef, notification: string, replace?: OutMessage): Promise<unknown>;
};

export type LinkedUser = typeof s.users.$inferSelect;
