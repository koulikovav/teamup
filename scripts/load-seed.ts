// Загрузка клуба из файла начальной загрузки (формат — src/seed/format.ts).
//
//   DATABASE_URL=... npx tsx scripts/load-seed.ts examples/demo-club.json
//
// Всё загружается одной транзакцией: при любой ошибке база остаётся как была.
// Уже внесённые суммы заводятся подтверждёнными оплатами с датой загрузки.

import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { validateSeed, type SeedFile } from "../src/seed/format";

const kop = (rub: number) => Math.round(rub * 100);

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Укажите файл: npx tsx scripts/load-seed.ts <файл.json>");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан, см. .env.example");

  const seed: SeedFile = JSON.parse(readFileSync(path, "utf8"));
  const errors = validateSeed(seed);
  if (errors.length) throw new Error("Файл с ошибками:\n" + errors.join("\n"));

  const sql = postgres(url);
  const db = drizzle(sql);
  const today = new Date().toISOString().slice(0, 10);
  const importNote = "Перенесено из Excel";

  await db.transaction(async (tx) => {
    const [club] = await tx.insert(s.clubs).values(seed.club).returning();

    const [season] = await tx
      .insert(s.seasons)
      .values({ clubId: club.id, ...seed.season, openingBalance: kop(seed.season.openingBalance) })
      .returning();

    const categoryIds = new Map<string, string>();
    const categoryAmounts = new Map<string, number>();
    for (const c of seed.feeCategories) {
      const [row] = await tx.insert(s.feeCategories).values({ clubId: club.id, name: c.name }).returning();
      await tx
        .insert(s.seasonFeeRates)
        .values({ clubId: club.id, seasonId: season.id, feeCategoryId: row.id, amount: kop(c.amount) });
      categoryIds.set(c.name, row.id);
      categoryAmounts.set(c.name, c.amount);
    }

    const budgetIds = new Map<string, string>();
    for (const b of seed.budget) {
      const [row] = await tx
        .insert(s.budgetItems)
        .values({
          clubId: club.id,
          seasonId: season.id,
          direction: b.direction,
          name: b.name,
          plannedAmount: kop(b.planned),
          note: b.note,
        })
        .returning();
      budgetIds.set(b.name, row.id);
    }

    const eventIds = new Map<string, string>();
    for (const e of seed.events) {
      const [row] = await tx
        .insert(s.events)
        .values({
          clubId: club.id,
          seasonId: season.id,
          kind: e.kind,
          title: e.title,
          startsOn: e.startsOn,
          endsOn: e.endsOn,
          capacity: e.capacity,
          mandatory: e.mandatory ?? false,
          missPenalty: e.missPenalty === undefined ? undefined : kop(e.missPenalty),
          status: e.status ?? "planned",
        })
        .returning();
      eventIds.set(e.title, row.id);
    }

    for (const m of seed.members) {
      const [user] = await tx.insert(s.users).values({ fullName: m.fullName }).returning();
      const [membership] = await tx
        .insert(s.memberships)
        .values({
          clubId: club.id,
          userId: user.id,
          role: m.role ?? "member",
          status: m.status,
          feeCategoryId: m.feeCategory ? categoryIds.get(m.feeCategory) : undefined,
          memberNo: m.memberNo,
        })
        .returning();
      const base = { clubId: club.id, seasonId: season.id, membershipId: membership.id };

      const fee = m.feeAmount ?? (m.feeCategory ? categoryAmounts.get(m.feeCategory) : undefined);
      if (fee) await tx.insert(s.charges).values({ ...base, kind: "membership_fee", amount: kop(fee) });

      for (const p of m.penalties ?? []) {
        await tx.insert(s.charges).values({ ...base, kind: "penalty", amount: kop(p.amount), note: p.note });
      }

      const paid = (m.paid ?? 0) + (m.penalties ?? []).reduce((sum, p) => sum + (p.paid ?? 0), 0);
      if (paid > 0) {
        await tx.insert(s.payments).values({
          ...base,
          amount: kop(paid),
          paidOn: today,
          method: "other",
          status: "confirmed",
          note: importNote,
          confirmedAt: new Date(),
        });
      }
    }

    for (const e of seed.expenses) {
      await tx.insert(s.expenses).values({
        clubId: club.id,
        seasonId: season.id,
        budgetItemId: e.budgetItem ? budgetIds.get(e.budgetItem) : undefined,
        eventId: e.event ? eventIds.get(e.event) : undefined,
        amount: kop(e.amount),
        spentOn: e.spentOn,
        payee: e.payee,
        description: e.description,
        status: "confirmed",
        confirmedAt: new Date(),
      });
    }

    await tx.insert(s.auditLog).values({
      clubId: club.id,
      action: "club.import",
      entity: "club",
      entityId: club.id,
      data: { source: path, members: seed.members.length },
    });
    console.log(`Загружен клуб «${club.name}»: ${seed.members.length} членов, ${seed.expenses.length} расходов`);
  });

  await sql.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
