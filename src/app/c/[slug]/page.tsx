import Link from "next/link";
import { day, rub } from "@/lib/format";
import { clubContext } from "@/server/club";
import * as q from "@/server/queries";
import { createSeason } from "./actions";

export default async function ClubHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);

  if (!ctx.season) {
    return (
      <>
        <h1>Сезон ещё не создан</h1>
        {ctx.can("manageMoney") ? (
          <form action={createSeason} className="card grid">
            <input type="hidden" name="slug" value={slug} />
            <label>Название<input name="title" defaultValue={`Сезон ${new Date().getFullYear()}`} required /></label>
            <label>Начало<input type="date" name="startsOn" required /></label>
            <label>Конец<input type="date" name="endsOn" required /></label>
            <label>Срок уплаты взноса<input type="date" name="feeDueOn" /></label>
            <label>Входящий остаток, ₽<input name="openingBalance" defaultValue="0" /></label>
            <button>Создать сезон</button>
          </form>
        ) : (
          <p className="muted">Сезон заводит начфин.</p>
        )}
      </>
    );
  }

  const season = ctx.season;
  const full = { ...ctx, season };
  const [money, events, report] = await Promise.all([q.money(full), q.events(full), q.report(full)]);
  const mine = money.balances.get(ctx.membership.id);
  const drafts = money.payments.filter((p) => p.status === "draft");
  const upcoming = events.filter((e) => e.status === "planned").slice(0, 3);

  return (
    <>
      <h1>{season.title}</h1>
      <div className="card">
        <h2>Мой баланс</h2>
        {!mine || mine.balance === 0 ? (
          <p className="ok">Долгов нет</p>
        ) : mine.balance > 0 ? (
          <p className="debt">Долг {rub(mine.balance)}</p>
        ) : (
          <p className="ok">Переплата {rub(-mine.balance)}, перейдёт на следующий сезон</p>
        )}
        {mine && mine.pending > 0 && <p className="draft">Ждёт подтверждения: {rub(mine.pending)}</p>}
        <Link href={`/c/${slug}/money`}>Я оплатил →</Link>
      </div>
      {ctx.can("manageMoney") && drafts.length > 0 && (
        <div className="card">
          <p className="draft">
            Оплат ждут подтверждения: {drafts.length}. <Link href={`/c/${slug}/money`}>Проверить →</Link>
          </p>
        </div>
      )}
      <div className="card">
        <h2>Ближайшие мероприятия</h2>
        {upcoming.length === 0 && <p className="muted">Нет запланированных</p>}
        <ul>
          {upcoming.map((e) => (
            <li key={e.id}>
              <Link href={`/c/${slug}/events/${e.id}`}>{e.title}</Link> <span className="muted">{day(e.startsOn)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>Касса</h2>
        <p>
          Остаток: <strong>{rub(report.closingBalance)}</strong>{" "}
          <span className="muted">
            (приход {rub(report.income)}, расход {rub(report.expenseTotal)})
          </span>
        </p>
      </div>
    </>
  );
}
