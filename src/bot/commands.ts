// Разбор того, что человек пишет боту, и данных в кнопках. Без базы и сети, поэтому легко проверить тестами

import { parseRub } from "@/lib/format";

export type Command =
  | { kind: "login" }
  | { kind: "balance" }
  | { kind: "paid"; amount: number }
  | { kind: "help" };

// «вход», «/login» → ссылка на сайт; «долг», «баланс» → сколько должен;
// «я оплатил 3 000», «оплатил 3000 р», «перевёл 2500,50» → черновик оплаты
export function parseText(text: string | null | undefined): Command {
  const t = (text ?? "").trim().toLowerCase().replace(/ё/g, "е");
  if (/^\/?(вход|войти|сайт|ссылка|login|start)$/.test(t)) return { kind: "login" };
  if (/^\/?(долг|баланс|сколько|balance)(\s|\?|$)/.test(t)) return { kind: "balance" };
  const paid = t.match(/(?:оплатил|оплатила|заплатил|заплатила|перевел|перевела|сдал|сдала|paid)\D*?(\d[\d\s]*(?:[.,]\d{1,2})?)/);
  if (paid) {
    const amount = parseRub(paid[1]);
    if (amount !== null) return { kind: "paid", amount };
  }
  return { kind: "help" };
}

export type Action =
  | { kind: "rsvp"; eventId: string; response: "going" | "not_going" | "maybe" }
  | { kind: "declare"; membershipId: string; amount: number }
  | { kind: "review"; paymentId: string; decision: "confirm" | "reject" };

const rsvpCode = { going: "g", not_going: "n", maybe: "m" } as const;
const rsvpByCode = { g: "going", n: "not_going", m: "maybe" } as const;
const uuid = /^[0-9a-f-]{36}$/;

export function encodeAction(a: Action): string {
  switch (a.kind) {
    case "rsvp":
      return `r:${a.eventId}:${rsvpCode[a.response]}`;
    case "declare":
      return `d:${a.membershipId}:${a.amount}`;
    case "review":
      return `p:${a.paymentId}:${a.decision === "confirm" ? "ok" : "no"}`;
  }
}

// Данные кнопки приходят от клиента Max, поэтому проверяем каждую часть
export function decodeAction(payload: string | null | undefined): Action | null {
  const [code, id, arg] = (payload ?? "").split(":");
  if (!id || !uuid.test(id)) return null;
  if (code === "r" && arg in rsvpByCode) return { kind: "rsvp", eventId: id, response: rsvpByCode[arg as keyof typeof rsvpByCode] };
  if (code === "d" && /^\d{1,12}$/.test(arg) && Number(arg) > 0) return { kind: "declare", membershipId: id, amount: Number(arg) };
  if (code === "p" && (arg === "ok" || arg === "no")) return { kind: "review", paymentId: id, decision: arg === "ok" ? "confirm" : "reject" };
  return null;
}

// Телефон из карточки контакта (vCard): берём последние 10 цифр, чтобы +7, 8 и 7 совпадали
export function phoneKey(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function phoneFromVcf(vcf: string) {
  const line = vcf.split(/\r?\n/).find((l) => /^TEL/i.test(l));
  return line ? phoneKey(line.slice(line.indexOf(":") + 1)) : null;
}
