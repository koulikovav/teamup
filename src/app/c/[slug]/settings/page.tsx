import { rub } from "@/lib/format";
import { notFound } from "next/navigation";
import { clubContext, requireSeason } from "@/server/club";
import * as q from "@/server/queries";
import { addBudgetItem, addFeeCategory } from "../actions";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);
  if (!ctx.can("manageMoney")) notFound();
  const season = requireSeason(ctx);
  const full = { ...ctx, season };
  const [categories, items] = await Promise.all([q.feeCategories(full), q.budgetItems(full)]);

  return (
    <>
      <h1>Настройки сезона</h1>

      <h2>Категории взноса</h2>
      <div className="card">
        <table>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="num">{c.amount === null ? "не задан" : rub(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addFeeCategory} className="grid">
          <input type="hidden" name="slug" value={slug} />
          <label>Название<input name="name" placeholder="Пенсионный" required /></label>
          <label>Взнос за сезон, ₽<input name="amount" inputMode="decimal" required /></label>
          <button>Добавить</button>
        </form>
      </div>

      <h2>Бюджет сезона</h2>
      <div className="card">
        <table>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.direction === "income" ? "Доход" : "Расход"}</td>
                <td>{i.name}</td>
                <td className="num">{rub(i.plannedAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addBudgetItem} className="grid">
          <input type="hidden" name="slug" value={slug} />
          <label>
            Тип
            <select name="direction" defaultValue="expense">
              <option value="expense">Расход</option>
              <option value="income">Доход</option>
            </select>
          </label>
          <label>Статья<input name="name" required /></label>
          <label>План, ₽<input name="planned" inputMode="decimal" /></label>
          <button>Добавить</button>
        </form>
      </div>
    </>
  );
}
