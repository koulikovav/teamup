import { clubContext, requireSeason } from "@/server/club";
import * as q from "@/server/queries";
import { addMember, updateMember } from "../actions";
import { LoginLink } from "./login-link";

const roleName = { finance_admin: "Начфин", admin: "Админ", member: "Член" } as const;
const statusName = { active: "Участвует", inactive: "Не участвует в сезоне", left: "Выбыл" } as const;

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);
  const season = requireSeason(ctx);
  const [list, categories] = await Promise.all([q.members(ctx), q.feeCategories({ ...ctx, season })]);
  const manage = ctx.can("manageMembers");
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <>
      <h1>Состав</h1>
      <p className="muted">
        Участвуют в сезоне: {list.filter((m) => m.status === "active").length} из {list.filter((m) => m.status !== "left").length}
      </p>
      <div className="card scroll">
        <table>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className={m.status === "left" ? "muted" : ""}>
                <td>{m.memberNo ?? ""}</td>
                <td>
                  {m.fullName}
                  {m.role !== "member" && <div className="ok">{roleName[m.role]}</div>}
                </td>
                <td>
                  {manage ? (
                    <form action={updateMember} className="row">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="membershipId" value={m.id} />
                      <select name="status" defaultValue={m.status}>
                        {Object.entries(statusName).map(([v, n]) => (
                          <option key={v} value={v}>{n}</option>
                        ))}
                      </select>
                      <select name="feeCategoryId" defaultValue={m.feeCategoryId ?? ""}>
                        <option value="">Без взноса</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <select name="role" defaultValue={m.role}>
                        {Object.entries(roleName).map(([v, n]) => (
                          <option key={v} value={v}>{n}</option>
                        ))}
                      </select>
                      <button className="secondary">Сохранить</button>
                    </form>
                  ) : (
                    <span className="muted">
                      {statusName[m.status]}
                      {m.feeCategoryId ? `, ${categoryName.get(m.feeCategoryId)}` : ""}
                    </span>
                  )}
                </td>
                <td>{manage && m.status !== "left" && <LoginLink slug={slug} membershipId={m.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {manage && (
        <>
          <h2>Добавить члена</h2>
          <form action={addMember} className="card grid">
            <input type="hidden" name="slug" value={slug} />
            <label>ФИО<input name="fullName" required /></label>
            <label>Телефон<input name="phone" type="tel" /></label>
            <label>№<input name="memberNo" inputMode="numeric" /></label>
            <label>
              Взнос
              <select name="feeCategoryId">
                <option value="">Без взноса</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <button>Добавить</button>
          </form>
        </>
      )}
    </>
  );
}
