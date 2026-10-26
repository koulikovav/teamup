import { notFound } from "next/navigation";
import { day, rub } from "@/lib/format";
import { clubContext, requireSeason } from "@/server/club";
import * as q from "@/server/queries";
import { announceEventNow, applyPenalties, markAttendance, rsvp, setOverCapacity } from "../../actions";
import { ResultButton } from "../../result-button";

const responseName = { going: "Еду", not_going: "Не еду", maybe: "Не знаю" } as const;

export default async function EventPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await clubContext(slug);
  const season = requireSeason(ctx);
  const detail = await q.eventDetail({ ...ctx, season }, id);
  if (!detail) notFound();
  const { event, participants, names, allocation } = detail;
  const manage = ctx.can("manageEvents");
  const mine = participants.find((x) => x.p.membershipId === ctx.membership.id)?.p;
  const myPlace = allocation.waitlist.findIndex((r) => r.membershipId === ctx.membership.id);
  const activeMembers = manage ? (await q.members(ctx)).filter((m) => m.status === "active") : [];
  const attended = new Set(participants.filter((x) => x.p.attended).map((x) => x.p.membershipId));
  const notGoing = participants.filter((x) => x.p.response !== "going");

  return (
    <>
      <h1>{event.title}</h1>
      <p className="muted">
        {day(event.startsOn)}
        {event.endsOn && event.endsOn !== event.startsOn ? ` – ${day(event.endsOn)}` : ""}
        {event.location ? `, ${event.location}` : ""}
        {event.mandatory && `. Обязательное${event.missPenalty ? `, штраф за пропуск ${rub(event.missPenalty)}` : ""}`}
      </p>

      {manage && event.status === "planned" && (
        <ResultButton action={announceEventNow} label="Разослать в мессенджеры с кнопками «еду / не еду»" fields={{ slug, eventId: event.id }} />
      )}

      {event.status === "planned" && (
        <form action={rsvp} className="card row">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="eventId" value={event.id} />
          <span>Ваш ответ: <strong>{mine ? responseName[mine.response] : "ещё нет"}</strong></span>
          <label className="row">
            Гостей <input name="guests" inputMode="numeric" defaultValue={mine?.guests ?? 0} size={2} />
          </label>
          <button name="response" value="going">Еду</button>
          <button name="response" value="maybe" className="secondary">Не знаю</button>
          <button name="response" value="not_going" className="secondary">Не еду</button>
          {myPlace >= 0 && <span className="draft">Вы в листе ожидания, место {myPlace + 1}</span>}
        </form>
      )}

      <h2>
        Едут: {allocation.seatsTaken}
        {event.capacity ? ` из ${event.capacity} мест` : ""}
      </h2>
      <div className="card">
        <ol>
          {allocation.confirmed.map((r) => (
            <li key={r.membershipId}>
              {names.get(r.membershipId)}
              {r.guests > 0 && ` + ${r.guests}`}
              {r.overCapacity && <span className="draft"> сверх лимита</span>}
            </li>
          ))}
        </ol>
        {allocation.waitlist.length > 0 && (
          <>
            <h2 className="draft">Лист ожидания</h2>
            <ol>
              {allocation.waitlist.map((r) => (
                <li key={r.membershipId} className="row">
                  {names.get(r.membershipId)}
                  {r.guests > 0 && ` + ${r.guests}`}
                  {manage && (
                    <form action={setOverCapacity} className="inline">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="membershipId" value={r.membershipId} />
                      <input type="hidden" name="value" value="on" />
                      <button className="secondary">Взять сверх лимита</button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
        {notGoing.length > 0 && (
          <p className="muted">
            Ответили «не еду» или «не знаю»: {notGoing.map((x) => `${x.fullName} (${responseName[x.p.response].toLowerCase()})`).join(", ")}
          </p>
        )}
      </div>

      {manage && (
        <>
          <h2>Кто был</h2>
          <form action={markAttendance} className="card">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="eventId" value={event.id} />
            {activeMembers.map((m) => (
              <label key={m.id} className="row">
                <input type="checkbox" name="present" value={m.id} defaultChecked={attended.has(m.id)} />
                {m.fullName}
              </label>
            ))}
            <button>Сохранить присутствие</button>
          </form>
          {event.mandatory && event.missPenalty && ctx.can("manageMoney") && event.status === "done" && (
            <form action={applyPenalties} className="row">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="eventId" value={event.id} />
              <button>Начислить штрафы пропустившим</button>
              <span className="muted">Повторное нажатие не задвоит штрафы.</span>
            </form>
          )}
        </>
      )}

      {detail.expenses.length > 0 && (
        <>
          <h2>Расходы мероприятия</h2>
          <div className="card">
            <table>
              <tbody>
                {detail.expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.description}</td>
                    <td className="num">{rub(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
