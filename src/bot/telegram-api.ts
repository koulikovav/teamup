// Тонкий клиент Telegram Bot API: только то, что нужно TeamUp.
// Описание API: https://core.telegram.org/bots/api

import { phoneKey } from "./commands";
import type { Button, Incoming, Messenger, OutMessage } from "./types";

type TgUser = { id: number; is_bot: boolean; first_name: string };
type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  contact?: { phone_number: string; user_id?: number };
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
};

// Кнопка «Поделиться номером» в Телеграме бывает только в клавиатуре под полем ввода,
// остальные кнопки — под сообщением
export function telegramMarkup(buttons: Button[][] | undefined) {
  if (!buttons?.length) return { remove_keyboard: true };
  if (buttons.flat().some((b) => b.type === "request_contact")) {
    return {
      keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, request_contact: b.type === "request_contact" }))),
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  }
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => (b.type === "link" ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.type === "callback" ? b.payload : "" })),
    ),
  };
}

export function telegramApi(token: string, baseUrl = process.env.TELEGRAM_API_URL ?? "https://api.telegram.org") {
  async function call<T>(method: string, payload: unknown = {}) {
    const res = await fetch(`${baseUrl}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method}: ${res.status} ${data.description ?? ""}`);
    return data.result as T;
  }

  return {
    send: (chatId: string, m: OutMessage) => call("sendMessage", { chat_id: chatId, text: m.text, reply_markup: telegramMarkup(m.buttons) }),
    answer: (callbackId: string, text: string) => call("answerCallbackQuery", { callback_query_id: callbackId, text }),
    edit: (chatId: string, messageId: string, m: OutMessage) =>
      call("editMessageText", {
        chat_id: chatId,
        message_id: Number(messageId),
        text: m.text,
        ...(m.buttons?.length ? { reply_markup: telegramMarkup(m.buttons) } : {}),
      }),
    updates: (offset?: number) =>
      call<TgUpdate[]>("getUpdates", { timeout: 30, ...(offset ? { offset } : {}), allowed_updates: ["message", "callback_query"] }),
    setWebhook: (url: string, secret: string) =>
      call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] }),
    deleteWebhook: () => call("deleteWebhook"),
    me: () => call<{ id: number; username: string }>("getMe"),
  };
}

export type TelegramApi = ReturnType<typeof telegramApi>;

export const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

export function telegramMessenger(api: TelegramApi): Messenger {
  return {
    kind: "telegram",
    forTitle: "для Телеграма",
    inTitle: "в Телеграме",
    column: "telegramUserId",
    send: (userId, m) => api.send(userId, m),
    async answer(callback, notification, replace) {
      await api.answer(callback.id, notification);
      if (replace && callback.chatId && callback.messageId) await api.edit(callback.chatId, callback.messageId, replace);
    },
  };
}

// Событие Телеграма → общий вид. Отвечаем только в личной переписке с ботом
export function fromTelegram(update: TgUpdate): Incoming | null {
  const cq = update.callback_query;
  if (cq) {
    return {
      type: "button",
      from: String(cq.from.id),
      payload: cq.data ?? null,
      callback: {
        id: cq.id,
        chatId: cq.message ? String(cq.message.chat.id) : undefined,
        messageId: cq.message ? String(cq.message.message_id) : undefined,
      },
    };
  }
  const m = update.message;
  if (!m?.from || m.from.is_bot || m.chat.type !== "private") return null;
  const from = String(m.from.id);
  // Ссылка https://t.me/бот?start=токен приходит сообщением «/start токен»
  const start = m.text?.match(/^\/start(?:\s+(\S+))?$/);
  if (start) return { type: "start", from, payload: start[1] ?? null };
  // Номер принимаем только свой: карточка контакта должна принадлежать отправителю
  const ownPhone = m.contact && m.contact.user_id === m.from.id ? phoneKey(m.contact.phone_number) : null;
  return { type: "text", from, text: m.text ?? null, ownPhone, sharedContact: !!m.contact };
}
