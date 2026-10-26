// Формат файла начальной загрузки клуба: состав, сезон, бюджет, оплаты, расходы, мероприятия.
// Суммы в файле — в рублях (как люди их видят), при загрузке переводятся в копейки.
// Реальные файлы клубов хранятся вне репозитория; пример — examples/demo-club.json.

export type SeedFile = {
  club: { name: string; slug: string; kind: string };
  feeCategories: { name: string; amount: number }[];
  season: {
    title: string;
    startsOn: string; // YYYY-MM-DD
    endsOn: string;
    feeDueOn?: string;
    openingBalance: number;
  };
  budget: { direction: "income" | "expense"; name: string; planned: number; note?: string }[];
  members: SeedMember[];
  expenses: {
    budgetItem?: string;
    event?: string; // название мероприятия из events
    amount: number;
    spentOn: string;
    description: string;
    payee?: string;
  }[];
  events: {
    title: string;
    kind: "trip" | "count" | "work" | "meeting" | "other";
    startsOn: string;
    endsOn?: string;
    capacity?: number;
    mandatory?: boolean;
    missPenalty?: number;
    status?: "planned" | "done" | "cancelled";
  }[];
};

export type SeedMember = {
  fullName: string;
  memberNo?: number;
  role?: "finance_admin" | "admin" | "member";
  status: "active" | "inactive" | "left";
  feeCategory?: string; // имя из feeCategories; пусто — взнос не начисляется
  feeAmount?: number; // если взнос члена отличается от ставки категории
  paid?: number; // сколько уже внесено за сезон
  penalties?: { amount: number; note: string; paid?: number }[];
};

export function validateSeed(seed: SeedFile): string[] {
  const errors: string[] = [];
  const categories = new Set(seed.feeCategories.map((c) => c.name));
  const items = new Set(seed.budget.map((b) => b.name));
  const events = new Set(seed.events.map((e) => e.title));
  const isDate = (s: string | undefined) => s === undefined || /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (!/^[a-z0-9-]+$/.test(seed.club.slug)) errors.push(`club.slug: только латиница, цифры и дефис: ${seed.club.slug}`);
  for (const d of [seed.season.startsOn, seed.season.endsOn, seed.season.feeDueOn]) {
    if (!isDate(d)) errors.push(`season: дата не в формате ГГГГ-ММ-ДД: ${d}`);
  }
  for (const m of seed.members) {
    if (m.feeCategory && !categories.has(m.feeCategory)) errors.push(`${m.fullName}: нет категории «${m.feeCategory}»`);
  }
  for (const e of seed.expenses) {
    if (e.budgetItem && !items.has(e.budgetItem)) errors.push(`расход «${e.description}»: нет статьи «${e.budgetItem}»`);
    if (e.event && !events.has(e.event)) errors.push(`расход «${e.description}»: нет мероприятия «${e.event}»`);
    if (!isDate(e.spentOn)) errors.push(`расход «${e.description}»: дата ${e.spentOn}`);
  }
  return errors;
}
