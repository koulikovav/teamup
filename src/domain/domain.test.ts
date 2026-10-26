import { describe, expect, it } from "vitest";
import { carryoverCharges, memberBalances } from "./balance";
import { penaltiesForEvent } from "./penalties";
import { seasonReport } from "./report";
import { allocateSeats, type Rsvp } from "./seats";

const rub = (n: number) => n * 100;

describe("memberBalances", () => {
  it("считает долг по частичным оплатам и не учитывает черновики", () => {
    const b = memberBalances(
      [{ membershipId: "a", amount: rub(22000) }],
      [
        { membershipId: "a", amount: rub(10000), status: "confirmed" },
        { membershipId: "a", amount: rub(2000), status: "confirmed" },
        { membershipId: "a", amount: rub(3000), status: "draft" },
        { membershipId: "a", amount: rub(500), status: "rejected" },
      ],
    ).get("a")!;
    expect(b.charged).toBe(rub(22000));
    expect(b.paid).toBe(rub(12000));
    expect(b.pending).toBe(rub(3000));
    expect(b.balance).toBe(rub(10000));
  });

  it("не учитывает отменённые начисления", () => {
    const b = memberBalances(
      [
        { membershipId: "a", amount: rub(3000), cancelledAt: new Date() },
        { membershipId: "a", amount: rub(3000) },
      ],
      [],
    ).get("a")!;
    expect(b.balance).toBe(rub(3000));
  });

  it("переносит долг и переплату в следующий сезон", () => {
    const balances = memberBalances(
      [
        { membershipId: "debtor", amount: rub(22000) },
        { membershipId: "even", amount: rub(22000) },
        { membershipId: "deposit", amount: rub(22000) },
      ],
      [
        { membershipId: "debtor", amount: rub(20000), status: "confirmed" },
        { membershipId: "even", amount: rub(22000), status: "confirmed" },
        { membershipId: "deposit", amount: rub(28000), status: "confirmed" },
      ],
    );
    expect(carryoverCharges(balances.values())).toEqual([
      { membershipId: "debtor", kind: "carryover", amount: rub(2000) },
      { membershipId: "deposit", kind: "carryover", amount: -rub(6000) },
    ]);
  });
});

describe("allocateSeats", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, min));
  const r = (id: string, min: number, extra: Partial<Rsvp> = {}): Rsvp => ({
    membershipId: id,
    response: "going",
    respondedAt: at(min),
    guests: 0,
    overCapacity: false,
    ...extra,
  });

  it("сажает по очереди отклика, остальных — в лист ожидания", () => {
    const a = allocateSeats([r("c", 3), r("a", 1), r("b", 2), r("no", 0, { response: "not_going" })], 2);
    expect(a.confirmed.map((x) => x.membershipId)).toEqual(["a", "b"]);
    expect(a.waitlist.map((x) => x.membershipId)).toEqual(["c"]);
    expect(a.seatsLeft).toBe(0);
  });

  it("учитывает гостей и тех, кого админ взял сверх лимита", () => {
    const a = allocateSeats([r("a", 1, { guests: 1 }), r("b", 2), r("cot", 3, { overCapacity: true })], 2);
    expect(a.confirmed.map((x) => x.membershipId)).toEqual(["cot", "a"]);
    expect(a.waitlist.map((x) => x.membershipId)).toEqual(["b"]);
    expect(a.seatsTaken).toBe(3);
  });

  it("без лимита берёт всех", () => {
    expect(allocateSeats([r("a", 1), r("b", 2)], null).waitlist).toEqual([]);
  });
});

describe("penaltiesForEvent", () => {
  it("штрафует активных, которых не было", () => {
    const p = penaltiesForEvent({
      eventId: "e1",
      activeMembershipIds: ["a", "b", "c"],
      attendedMembershipIds: ["b"],
      amount: rub(3000),
    });
    expect(p.map((x) => x.membershipId)).toEqual(["a", "c"]);
    expect(p[0]).toMatchObject({ kind: "penalty", amount: rub(3000), eventId: "e1" });
  });
});

describe("seasonReport", () => {
  it("считает остаток как в листе «ОтчетГодовой»", () => {
    const report = seasonReport({
      openingBalance: -rub(4995),
      payments: [
        { amount: rub(488000), status: "confirmed" },
        { amount: rub(21000), status: "confirmed" },
        { amount: rub(3000), status: "draft" },
      ],
      expenses: [
        { amount: rub(131000), status: "confirmed", budgetItemName: "Лицензии" },
        { amount: rub(51800), status: "confirmed", budgetItemName: "Гостиница" },
        { amount: rub(26800), status: "confirmed", budgetItemName: "Отработка" },
        { amount: rub(10000), status: "confirmed", budgetItemName: null },
        { amount: rub(999), status: "draft", budgetItemName: "Гостиница" },
      ],
    });
    expect(report.income).toBe(rub(509000));
    expect(report.expenseTotal).toBe(rub(219600));
    expect(report.closingBalance).toBe(rub(284405));
  });
});
