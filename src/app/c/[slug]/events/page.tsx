import Link from "next/link";
import { day, today } from "@/lib/format";
import { clubContext, requireSeason } from "@/server/club";
import * as q from "@/server/queries";
import { createEvent } from "../actions";

const kindName = { trip: "Выезд", count: "Подсчёт", work: "Отработка", meeting: "Собрание", other: "Другое" } as const;

export default async function EventsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);
  const season = requireSeason(ctx);
  const list = await q.events({ ...ctx, season });

  return (
    <>
      <h1>Мероприятия</h1>
      <div className="card">
        <table>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className={e.status === "done" ? "muted" : ""}>
                <td>{day(e.startsOn)}</td>
                <td>
                  <Link href={`/c/${slug}/events/${e.id}`}>{e.title}</Link>
                </td>
                <td>
                  {kindName[e.kind]}
                  {e.mandatory && ", обязательное"}
                  {e.status === "done" && ", прошло"}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="muted">Пока нет мероприятий</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ctx.can("manageEvents") && (
        <>
          <h2>Новое мероприятие</h2>
          <form action={createEvent} className="card grid">
            <input type="hidden" name="slug" value={slug} />
            <label>Название<input name="title" required /></label>
            <label>
              Вид
              <select name="kind" defaultValue="trip">
                {Object.entries(kindName).map(([v, n]) => (
                  <option key={v} value={v}>{n}</option>
                ))}
              </select>
            </label>
            <label>С<input type="date" name="startsOn" defaultValue={today()} required /></label>
            <label>По<input type="date" name="endsOn" /></label>
            <label>Место<input name="location" /></label>
            <label>Мест (пусто — без лимита)<input name="capacity" inputMode="numeric" /></label>
            <label className="row">
              <input type="checkbox" name="mandatory" /> Обязательное
            </label>
            <label>Штраф за пропуск, ₽<input name="missPenalty" inputMode="decimal" /></label>
            <button>Создать</button>
          </form>
        </>
      )}
    </>
  );
}
