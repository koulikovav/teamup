// Печатает годовой отчёт и список должников клуба за открытый сезон.
//
//   DATABASE_URL=... npx tsx scripts/season-report.ts ok178

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { memberBalances } from "../src/domain/balance";
import { seasonReport } from "../src/domain/report";

const rub = (kop: number) => (kop / 100).toLocaleString("ru-RU");

async function main() {
  const slug = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!slug || !url) throw new Error("Нужны DATABASE_URL и адрес клуба: npx tsx scripts/season-report.ts <slug>");

  const sql = postgres(url);
  const db = drizzle(sql);

  const [club] = await db.select().from(s.clubs).where(eq(s.clubs.slug, slug));
  if (!club) throw new Error(`Клуб ${slug} не найден`);
  const [season] = await db
    .select()
    .from(s.seasons)
    .where(and(eq(s.seasons.clubId, club.id), eq(s.seasons.status, "open")));
  if (!season) throw new Error("Нет открытого сезона");

  const bySeason = { club: club.id, season: season.id };
  const charges = await db
    .select()
    .from(s.charges)
    .where(and(eq(s.charges.clubId, bySeason.club), eq(s.charges.seasonId, bySeason.season)));
  const payments = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.clubId, bySeason.club), eq(s.payments.seasonId, bySeason.season)));
  const expenses = await db
    .select({ amount: s.expenses.amount, status: s.expenses.status, budgetItemName: s.budgetItems.name })
    .from(s.expenses)
    .leftJoin(s.budgetItems, eq(s.expenses.budgetItemId, s.budgetItems.id))
    .where(and(eq(s.expenses.clubId, bySeason.club), eq(s.expenses.seasonId, bySeason.season)));
  const members = await db
    .select({ id: s.memberships.id, name: s.users.fullName })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.memberships.userId, s.users.id))
    .where(eq(s.memberships.clubId, club.id));

  const report = seasonReport({ openingBalance: season.openingBalance, payments, expenses });
  console.log(`${club.name}, ${season.title}`);
  console.log(`Входящий остаток: ${rub(report.openingBalance)}`);
  console.log(`Приход:           ${rub(report.income)}`);
  for (const e of report.expensesByItem) console.log(`  ${e.name}: ${rub(e.amount)}`);
  console.log(`Расход:           ${rub(report.expenseTotal)}`);
  console.log(`Остаток:          ${rub(report.closingBalance)}`);

  const names = new Map(members.map((m) => [m.id, m.name]));
  const debtors = [...memberBalances(charges, payments).values()].filter((b) => b.balance > 0);
  console.log(`\nДолжники (${debtors.length}):`);
  for (const d of debtors.sort((a, b) => b.balance - a.balance)) {
    console.log(`  ${names.get(d.membershipId)}: ${rub(d.balance)}`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
