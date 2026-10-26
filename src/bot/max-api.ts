// Тонкий клиент Bot API мессенджера Max: только то, что нужно TeamUp.
// Описание API: https://dev.max.ru/docs-api, официальный клиент — @maxhub/max-bot-api

import { phoneFromVcf } from "./commands";
import type { Incoming, Messenger, OutMessage } from "./types";

export type MaxUser = { user_id: number; first_name: string; last_name?: string; is_bot?: boolean };

export type MaxAttachment =
  | { type: "contact"; payload: { vcf_info: string; max_info?: MaxUser | null } }
  | { type: string; payload?: unknown };

export type MaxMessage = {
  sender?: MaxUser | null;
  recipient: { chat_id: number | null; chat_type?: string; user_id: number | null };
  body: { mid: string; text: string | null; attachments?: MaxAttachment[] | null };
};

export type MaxUpdate =
  | { update_type: "bot_started"; timestamp: number; chat_id: number; user: MaxUser; payload?: string | null }
  | { update_type: "message_created"; timestamp: number; message: MaxMessage }
  | {
      update_type: "message_callback";
      timestamp: number;
      callback: { callback_id: string; payload?: string; user: MaxUser };
      message?: MaxMessage | null;
    }
  | { update_type: string; timestamp: number };

const body = (m: OutMessage) => ({
  text: m.text,
  attachments: m.buttons?.length ? [{ type: "inline_keyboard", payload: { buttons: m.buttons } }] : [],
});

export function maxApi(token: string, baseUrl = process.env.MAX_API_URL ?? "https://platform-api2.max.ru") {
  async function call<T>(method: "GET" | "POST", path: string, query: Record<string, string | number> = {}, payload?: unknown) {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method,
      headers: { Authorization: token, ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Max ${method} /${path}: ${res.status} ${JSON.stringify(data)}`);
    return data as T;
  }

  return {
    // Личное сообщение человеку по его user_id в Max
    send: (userId: number | string, m: OutMessage) => call("POST", "messages", { user_id: userId }, body(m)),
    // Ответ на нажатие кнопки: всплывающее уведомление и, по желанию, новый текст сообщения
    answer: (callbackId: string, notification: string, message?: OutMessage) =>
      call("POST", "answers", { callback_id: callbackId }, { notification, ...(message ? { message: body(message) } : {}) }),
    updates: (marker?: number) =>
      call<{ updates: MaxUpdate[]; marker: number }>("GET", "updates", {
        timeout: 30,
        ...(marker ? { marker } : {}),
        types: "bot_started,message_created,message_callback",
      }),
    subscribe: (url: string, secret: string) =>
      call("POST", "subscriptions", {}, { url, secret, update_types: ["bot_started", "message_created", "message_callback"] }),
    me: () => call<{ user_id: number; username: string | null; first_name: string }>("GET", "me"),
  };
}

export type MaxApi = ReturnType<typeof maxApi>;

export const MAX_SECRET_HEADER = "X-Max-Bot-Api-Secret";

export function maxMessenger(api: MaxApi): Messenger {
  return {
    kind: "max",
    forTitle: "для Max",
    inTitle: "в Max",
    column: "maxUserId",
    send: (userId, m) => api.send(userId, m),
    answer: (callback, notification, replace) => api.answer(callback.id, notification, replace),
  };
}

// Событие Max → общий вид. Групповые чаты и сообщения ботов пропускаем
export function fromMax(update: MaxUpdate): Incoming | null {
  if (update.update_type === "bot_started" && "user" in update) {
    return { type: "start", from: String(update.user.user_id), payload: update.payload ?? null };
  }
  if (update.update_type === "message_created" && "message" in update) {
    const { message } = update;
    const sender = message.sender;
    if (!sender || sender.is_bot || (message.recipient.chat_type && message.recipient.chat_type !== "dialog")) return null;
    const contact = message.body.attachments?.find((a) => a.type === "contact");
    const card = contact?.payload as { vcf_info: string; max_info?: MaxUser | null } | undefined;
    // Номер принимаем только свой: карточка контакта должна принадлежать отправителю
    const ownPhone = card && card.max_info?.user_id === sender.user_id ? phoneFromVcf(card.vcf_info) : null;
    return { type: "text", from: String(sender.user_id), text: message.body.text, ownPhone, sharedContact: !!card };
  }
  if (update.update_type === "message_callback" && "callback" in update) {
    const { callback } = update;
    return { type: "button", from: String(callback.user.user_id), payload: callback.payload ?? null, callback: { id: callback.callback_id } };
  }
  return null;
}
