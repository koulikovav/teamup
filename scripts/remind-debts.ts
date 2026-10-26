// Напоминание должникам в Max. Для запуска по расписанию на сервере (например, раз в неделю):
// до срока оплаты взносов ничего не шлёт, после — напоминает мягко, с кнопкой «Я оплатил».
//
//   npm run remind-debts -- ok178
//   npm run remind-debts -- ok178 --force   (напомнить и до срока)

import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { clubs } from "../src/db/schema";
import { today } from "../src/lib/format";
import { remindDebtors } from "../src/bot/notify";
import { latestSeason } from "../src/server/ops";

async function main() {
  const [slug, flag] = process.argv.slice(2);
  if (!slug) throw new Error("Укажите адрес клуба: npm run remind-debts -- ok178");
  const [club] = await db().select().from(clubs).where(eq(clubs.slug, slug));
  if (!club) throw new Error(`Клуб ${slug} не найден`);
  const season = await latestSeason(club.id);
  if (season?.feeDueOn && today() <= season.feeDueOn && flag !== "--force") {
    console.log(`Срок оплаты ${season.feeDueOn} ещё не прошёл, напоминаний нет`);
    process.exit(0);
  }
  const res = await remindDebtors(club.id);
  if (!res) throw new Error("Бот не настроен: нужен MAX_BOT_TOKEN");
  console.log(`Отправлено: ${res.sent}, ошибок: ${res.failed}`);
  if (res.notLinked.length) console.log(`Без Max: ${res.notLinked.join(", ")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
