import { describe, expect, it } from "vitest";
import { fromMax } from "./max-api";
import { fromTelegram, telegramMarkup } from "./telegram-api";

const tgUser = { id: 42, is_bot: false, first_name: "Иван" };
const privateChat = { id: 42, type: "private" as const };

describe("Телеграм", () => {
  it("ссылка с токеном приходит как /start", () => {
    expect(fromTelegram({ update_id: 1, message: { message_id: 1, from: tgUser, chat: privateChat, text: "/start abc_DEF-1" } })).toEqual({
      type: "start",
      from: "42",
      payload: "abc_DEF-1",
    });
    expect(fromTelegram({ update_id: 1, message: { message_id: 1, from: tgUser, chat: privateChat, text: "/start" } })).toEqual({
      type: "start",
      from: "42",
      payload: null,
    });
  });

  it("свой номер принимается, чужой — нет", () => {
    const own = fromTelegram({
      update_id: 1,
      message: { message_id: 1, from: tgUser, chat: privateChat, contact: { phone_number: "+79123456789", user_id: 42 } },
    });
    expect(own).toMatchObject({ type: "text", ownPhone: "9123456789", sharedContact: true });
    const foreign = fromTelegram({
      update_id: 1,
      message: { message_id: 1, from: tgUser, chat: privateChat, contact: { phone_number: "+79123456789", user_id: 7 } },
    });
    expect(foreign).toMatchObject({ type: "text", ownPhone: null, sharedContact: true });
  });

  it("групповые чаты и боты пропускаются", () => {
    expect(fromTelegram({ update_id: 1, message: { message_id: 1, from: tgUser, chat: { id: -5, type: "group" }, text: "долг" } })).toBeNull();
    expect(fromTelegram({ update_id: 1, message: { message_id: 1, from: { ...tgUser, is_bot: true }, chat: privateChat, text: "x" } })).toBeNull();
  });

  it("нажатие кнопки помнит, какое сообщение править", () => {
    expect(
      fromTelegram({
        update_id: 1,
        callback_query: { id: "cb1", from: tgUser, data: "r:x:g", message: { message_id: 9, chat: privateChat } },
      }),
    ).toEqual({ type: "button", from: "42", payload: "r:x:g", callback: { id: "cb1", chatId: "42", messageId: "9" } });
  });

  it("кнопка номера уходит в клавиатуру под полем ввода, остальные — под сообщение", () => {
    expect(telegramMarkup([[{ type: "request_contact", text: "Поделиться номером" }]])).toEqual({
      keyboard: [[{ text: "Поделиться номером", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    expect(
      telegramMarkup([
        [
          { type: "callback", text: "Еду", payload: "r:x:g" },
          { type: "link", text: "Сайт", url: "https://example.org" },
        ],
      ]),
    ).toEqual({ inline_keyboard: [[{ text: "Еду", callback_data: "r:x:g" }, { text: "Сайт", url: "https://example.org" }]] });
    expect(telegramMarkup(undefined)).toEqual({ remove_keyboard: true });
  });
});

describe("Max", () => {
  const user = { user_id: 5, first_name: "Иван" };
  it("свой контакт принимается, чужой — нет", () => {
    const msg = (owner: number) => ({
      update_type: "message_created" as const,
      timestamp: 0,
      message: {
        sender: user,
        recipient: { chat_id: 1, chat_type: "dialog", user_id: 1 },
        body: { mid: "m", text: null, attachments: [{ type: "contact", payload: { vcf_info: "TEL:89123456789", max_info: { user_id: owner, first_name: "" } } }] },
      },
    });
    expect(fromMax(msg(5))).toMatchObject({ ownPhone: "9123456789", sharedContact: true });
    expect(fromMax(msg(6))).toMatchObject({ ownPhone: null, sharedContact: true });
  });

  it("групповые чаты пропускаются", () => {
    expect(
      fromMax({
        update_type: "message_created",
        timestamp: 0,
        message: { sender: user, recipient: { chat_id: 1, chat_type: "chat", user_id: null }, body: { mid: "m", text: "долг" } },
      }),
    ).toBeNull();
  });
});
