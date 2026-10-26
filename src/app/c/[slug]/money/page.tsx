import { day, rub, today } from "@/lib/format";
import { clubContext, requireSeason } from "@/server/club";
import * as q from "@/server/queries";
import { addCharge, cancelCharge, chargeSeasonFees, declarePayment, reviewPayment } from "../actions";

const kindName = {
  membership_fee: "Взнос",
  penalty: "Штраф",
  event_fee: "Допвзнос",
  carryover: "Перенос с прошлого сезона",
  other: "Прочее",
} as const;
const methodName = { cash: "наличные", transfer: "перевод", online: "онлайн", other: "—" } as const;

export default async function MoneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);
  const season = requireSeason(ctx);
  const m = await q.money({ ...ctx, season });
  const finance = ctx.can("manageMoney");
  const drafts = m.payments.filter((p) => p.status === "draft");
  const totalDebt = [...m.balances.values()].reduce((s, b) => s + Math.max(0, b.balance), 0);

  return (
    <>
      <h1>Взносы и оплаты</h1>

      <form action={declarePayment} className="card grid">
        <input type="hidden" name="slug" value={slug} />
        {finance && (
          <label>
            Кто оплатил
            <select name="membershipId" defaultValue={ctx.membership.id}>
              {m.members.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Сумма, ₽
          <input name="amount" inputMode="decimal" required />
        </label>
        <label>
          Дата
          <input type="date" name="paidOn" defaultValue={today()} />
        </label>
        <label>
          Как
          <select name="method" defaultValue="transfer">
            <option value="transfer">Перевод на карту</option>
            <option value="cash">Наличными</option>
          </select>
        </label>
        <label>
          Комментарий
          <input name="note" />
        </label>
        <button>Я оплатил</button>
      </form>
      <p className="muted">Оплата попадает в учёт, когда начфин подтвердит, что деньги пришли.</p>

      {drafts.length > 0 && (
        <>
          <h2 className="draft">Ждут подтверждения</h2>
          <div className="card scroll">
            <table>
              <tbody>
                {drafts.map((p) => (
                  <tr key={p.id}>
                    <td>{m.names.get(p.membershipId)}</td>
                    <td className="num">{rub(p.amount)}</td>
                    <td>
                      {day(p.paidOn)}, {methodName[p.method]}
                      {p.note ? `, ${p.note}` : ""}
                    </td>
                    <td>
                      {finance && (
                        <form action={reviewPayment} className="row">
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="paymentId" value={p.id} />
                          <button name="decision" value="confirm">
                            Подтвердить
                          </button>
                          <button name="decision" value="reject" className="secondary">
                            Отклонить
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Кто сколько должен</h2>
      <p className="muted">
        Всего долгов: {rub(totalDebt)}. Срок уплаты взноса: {season.feeDueOn ? day(season.feeDueOn) : "не задан"}.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th>Член</th>
              <th className="num">Начислено</th>
              <th className="num">Оплачено</th>
              <th className="num">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {m.members
              .filter((x) => x.status !== "left")
              .map((x) => {
                const b = m.balances.get(x.id);
                const bal = b?.balance ?? 0;
                return (
                  <tr key={x.id}>
                    <td>
                      {x.fullName}
                      {x.status === "inactive" && <span className="muted"> (не участвует)</span>}
                    </td>
                    <td className="num">{rub(b?.charged ?? 0)}</td>
                    <td className="num">
                      {rub(b?.paid ?? 0)}
                      {b?.pending ? <div className="draft">+{rub(b.pending)} ждёт</div> : null}
                    </td>
                    <td className={`num ${bal > 0 ? "debt" : bal < 0 ? "ok" : ""}`}>
                      {bal < 0 ? `переплата ${rub(-bal)}` : rub(bal)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {finance && (
        <>
          <h2>Начисления</h2>
          <form action={chargeSeasonFees} className="row">
            <input type="hidden" name="slug" value={slug} />
            <button>Начислить годовой взнос всем активным</button>
            <span className="muted">Тем, кому уже начислен, повторно не начислится.</span>
          </form>
          <form action={addCharge} className="card grid">
            <input type="hidden" name="slug" value={slug} />
            <label>
              Кому
              <select name="membershipId">
                {m.members.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Что
              <select name="kind" defaultValue="penalty">
                <option value="penalty">Штраф</option>
                <option value="event_fee">Допвзнос</option>
                <option value="other">Прочее</option>
              </select>
            </label>
            <label>
              Сумма, ₽
              <input name="amount" inputMode="decimal" required />
            </label>
            <label>
              За что
              <input name="note" required />
            </label>
            <button>Начислить</button>
          </form>
        </>
      )}

      <h2>История</h2>
      <div className="card scroll">
        <table>
          <tbody>
            {m.charges.map((c) => (
              <tr key={c.id} className={c.cancelledAt ? "muted" : ""}>
                <td>{m.names.get(c.membershipId)}</td>
                <td>
                  {kindName[c.kind]}
                  {c.note ? `: ${c.note}` : ""}
                  {c.cancelledAt && ` — отменено (${c.cancelReason})`}
                </td>
                <td className="num">{rub(c.amount)}</td>
                <td>
                  {finance && !c.cancelledAt && (
                    <form action={cancelCharge} className="row">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="chargeId" value={c.id} />
                      <input name="reason" placeholder="Причина отмены" required />
                      <button className="secondary">Отменить</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {m.payments
              .filter((p) => p.status === "confirmed")
              .map((p) => (
                <tr key={p.id}>
                  <td>{m.names.get(p.membershipId)}</td>
                  <td className="ok">
                    Оплата {day(p.paidOn)}, {methodName[p.method]}
                    {p.note ? `, ${p.note}` : ""}
                  </td>
                  <td className="num">{rub(p.amount)}</td>
                  <td />
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
