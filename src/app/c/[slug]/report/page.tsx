import { rub } from "@/lib/format";
import { clubContext, requireSeason } from "@/server/club";
import * as q from "@/server/queries";

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);
  const season = requireSeason(ctx);
  const full = { ...ctx, season };
  const [report, items, money] = await Promise.all([q.report(full), q.budgetItems(full), q.money(full)]);
  const fact = new Map(report.expensesByItem.map((e) => [e.name, e.amount]));
  const debtors = [...money.balances.values()].filter((b) => b.balance > 0).sort((a, b) => b.balance - a.balance);

  return (
    <>
      <h1>Отчёт: {season.title}</h1>
      <div className="card">
        <table>
          <tbody>
            <tr><td>Входящий остаток</td><td className="num">{rub(report.openingBalance)}</td></tr>
            <tr><td>Приход (подтверждённые оплаты)</td><td className="num">{rub(report.income)}</td></tr>
            <tr><td>Расход</td><td className="num">{rub(report.expenseTotal)}</td></tr>
            <tr><th>Остаток в кассе</th><th className="num">{rub(report.closingBalance)}</th></tr>
          </tbody>
        </table>
      </div>

      <h2>Расходы: план и факт</h2>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Статья</th><th className="num">План</th><th className="num">Факт</th></tr>
          </thead>
          <tbody>
            {items.filter((i) => i.direction === "expense").map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="num">{rub(i.plannedAmount)}</td>
                <td className="num">{rub(fact.get(i.name) ?? 0)}</td>
              </tr>
            ))}
            {fact.has("Прочие расходы") && (
              <tr><td>Прочие расходы</td><td className="num">—</td><td className="num">{rub(fact.get("Прочие расходы")!)}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Должники</h2>
      <div className="card">
        {debtors.length === 0 ? (
          <p className="ok">Долгов нет</p>
        ) : (
          <table>
            <tbody>
              {debtors.map((d) => (
                <tr key={d.membershipId}>
                  <td>{money.names.get(d.membershipId)}</td>
                  <td className="num debt">{rub(d.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
