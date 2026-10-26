import { day, rub, today } from "@/lib/format";
import { clubContext, requireSeason } from "@/server/club";
import * as q from "@/server/queries";
import { addExpense, reviewExpense } from "../actions";

export default async function ExpensesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);
  const season = requireSeason(ctx);
  const full = { ...ctx, season };
  const [list, items, events] = await Promise.all([q.expenses(full), q.budgetItems(full), q.events(full)]);
  const finance = ctx.can("manageMoney");

  return (
    <>
      <h1>Расходы</h1>
      {ctx.can("addExpense") && (
        <form action={addExpense} className="card grid">
          <input type="hidden" name="slug" value={slug} />
          <label>Что<input name="description" required /></label>
          <label>Сумма, ₽<input name="amount" inputMode="decimal" required /></label>
          <label>Дата<input type="date" name="spentOn" defaultValue={today()} /></label>
          <label>Кому заплачено<input name="payee" /></label>
          <label>
            Статья
            <select name="budgetItemId">
              <option value="">Прочие расходы</option>
              {items.filter((i) => i.direction === "expense").map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>
          <label>
            Мероприятие
            <select name="eventId">
              <option value="">—</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
          </label>
          <button>Добавить расход</button>
        </form>
      )}
      {!finance && ctx.can("addExpense") && <p className="muted">Расход попадёт в отчёт после подтверждения начфином.</p>}

      <div className="card scroll">
        <table>
          <tbody>
            {list.map(({ expense: e, budgetItem, event }) => (
              <tr key={e.id} className={e.status === "rejected" ? "muted" : ""}>
                <td>{day(e.spentOn)}</td>
                <td>
                  {e.description}
                  {e.payee ? `, ${e.payee}` : ""}
                  <div className="muted">
                    {budgetItem ?? "Прочие расходы"}
                    {event ? ` · ${event}` : ""}
                  </div>
                </td>
                <td className="num">{rub(e.amount)}</td>
                <td>
                  {e.status === "draft" &&
                    (finance ? (
                      <form action={reviewExpense} className="row">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="expenseId" value={e.id} />
                        <button name="decision" value="confirm">Подтвердить</button>
                        <button name="decision" value="reject" className="secondary">Отклонить</button>
                      </form>
                    ) : (
                      <span className="draft">ждёт подтверждения</span>
                    ))}
                  {e.status === "rejected" && "отклонён"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
