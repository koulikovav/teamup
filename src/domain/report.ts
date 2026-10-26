// Годовой отчёт сезона: приход по видам начислений, расход по статьям, остаток.
// Повторяет лист «ОтчетГодовой» из исходного Excel.

export type ReportPayment = { amount: number; status: "draft" | "confirmed" | "rejected" };
export type ReportExpense = {
  amount: number;
  status: "draft" | "confirmed" | "rejected";
  budgetItemName: string | null;
};

export type SeasonReport = {
  openingBalance: number;
  income: number;
  expensesByItem: { name: string; amount: number }[];
  expenseTotal: number;
  closingBalance: number;
};

export function seasonReport(args: {
  openingBalance: number;
  payments: ReportPayment[];
  expenses: ReportExpense[];
}): SeasonReport {
  const income = args.payments.filter((p) => p.status === "confirmed").reduce((s, p) => s + p.amount, 0);

  const byItem = new Map<string, number>();
  for (const e of args.expenses) {
    if (e.status !== "confirmed") continue;
    const name = e.budgetItemName ?? "Прочие расходы";
    byItem.set(name, (byItem.get(name) ?? 0) + e.amount);
  }
  const expensesByItem = [...byItem].map(([name, amount]) => ({ name, amount }));
  const expenseTotal = expensesByItem.reduce((s, e) => s + e.amount, 0);

  return {
    openingBalance: args.openingBalance,
    income,
    expensesByItem,
    expenseTotal,
    closingBalance: args.openingBalance + income - expenseTotal,
  };
}
