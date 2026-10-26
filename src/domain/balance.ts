// Расчёт долгов и переплат члена клуба за сезон.
// Суммы — в копейках.

export type ChargeLike = { membershipId: string; amount: number; cancelledAt?: Date | null };
export type PaymentLike = {
  membershipId: string;
  amount: number;
  status: "draft" | "confirmed" | "rejected";
};

export type MemberBalance = {
  membershipId: string;
  charged: number; // начислено (без отменённых)
  paid: number; // подтверждённые оплаты
  pending: number; // заявленные, но ещё не подтверждённые оплаты
  // Положительное — долг, отрицательное — переплата (депозит)
  balance: number;
};

export function memberBalances(charges: ChargeLike[], payments: PaymentLike[]): Map<string, MemberBalance> {
  const result = new Map<string, MemberBalance>();
  const get = (membershipId: string) => {
    let b = result.get(membershipId);
    if (!b) {
      b = { membershipId, charged: 0, paid: 0, pending: 0, balance: 0 };
      result.set(membershipId, b);
    }
    return b;
  };

  for (const c of charges) {
    if (c.cancelledAt) continue;
    get(c.membershipId).charged += c.amount;
  }
  for (const p of payments) {
    const b = get(p.membershipId);
    if (p.status === "confirmed") b.paid += p.amount;
    else if (p.status === "draft") b.pending += p.amount;
  }
  for (const b of result.values()) b.balance = b.charged - b.paid;
  return result;
}

// При закрытии сезона остаток каждого члена переносится в следующий сезон
// начислением вида carryover: долг — плюсом, депозит — минусом.
export function carryoverCharges(balances: Iterable<MemberBalance>) {
  const out: { membershipId: string; kind: "carryover"; amount: number }[] = [];
  for (const b of balances) {
    if (b.balance !== 0) out.push({ membershipId: b.membershipId, kind: "carryover", amount: b.balance });
  }
  return out;
}
