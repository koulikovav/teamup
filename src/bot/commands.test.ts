import { describe, expect, it } from "vitest";
import { decodeAction, encodeAction, parseText, phoneFromVcf, phoneKey } from "./commands";

const id = "3f2a6c1e-8b7d-4e0a-9c55-0d1e2f3a4b5c";

describe("parseText", () => {
  it("понимает «я оплатил» в разных написаниях", () => {
    expect(parseText("Я оплатил 3000")).toEqual({ kind: "paid", amount: 300000 });
    expect(parseText("оплатила 3 000 р")).toEqual({ kind: "paid", amount: 300000 });
    expect(parseText("перевёл 2500,50")).toEqual({ kind: "paid", amount: 250050 });
  });

  it("вход, долг и всё остальное", () => {
    expect(parseText("Вход")).toEqual({ kind: "login" });
    expect(parseText("/start")).toEqual({ kind: "login" });
    expect(parseText("долг")).toEqual({ kind: "balance" });
    expect(parseText("оплатил")).toEqual({ kind: "help" });
    expect(parseText("привет")).toEqual({ kind: "help" });
    expect(parseText(null)).toEqual({ kind: "help" });
  });
});

describe("кнопки", () => {
  it("данные кнопки читаются обратно", () => {
    for (const a of [
      { kind: "rsvp", eventId: id, response: "not_going" },
      { kind: "declare", membershipId: id, amount: 200000 },
      { kind: "review", paymentId: id, decision: "reject" },
    ] as const) {
      expect(decodeAction(encodeAction(a))).toEqual(a);
    }
  });

  it("подделанные данные отбрасываются", () => {
    expect(decodeAction("d:" + id + ":-5")).toBeNull();
    expect(decodeAction("d:" + id + ":0")).toBeNull();
    expect(decodeAction("r:not-a-uuid:g")).toBeNull();
    expect(decodeAction("p:" + id + ":maybe")).toBeNull();
    expect(decodeAction(undefined)).toBeNull();
  });
});

describe("телефон", () => {
  it("+7, 8 и пробелы дают один ключ", () => {
    expect(phoneKey("+7 (912) 345-67-89")).toBe("9123456789");
    expect(phoneKey("89123456789")).toBe("9123456789");
    expect(phoneKey("123")).toBeNull();
    expect(phoneFromVcf("BEGIN:VCARD\r\nVERSION:3.0\r\nTEL;TYPE=cell:79123456789\r\nEND:VCARD")).toBe("9123456789");
  });
});
