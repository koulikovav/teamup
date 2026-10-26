// Схема базы данных TeamUp.
//
// Каждая таблица с данными клуба несёт club_id: по нему база разделяет клубы
// (Row Level Security включим отдельной миграцией). Деньги хранятся в копейках
// целыми числами, чтобы не терять точность на дробях.

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" });

// ---------------------------------------------------------------- клуб и люди

export const clubs = pgTable("clubs", {
  id: id(),
  name: text("name").notNull(),
  // Короткий адрес клуба в приложении: teamup.club/ok178
  slug: text("slug").notNull().unique(),
  // Шаблон клуба: hunting, fishing, hockey, other… Определяет виды мероприятий и статьи по умолчанию
  kind: text("kind").notNull().default("other"),
  currency: text("currency").notNull().default("RUB"),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  fullName: text("full_name").notNull(),
  phone: text("phone").unique(),
  maxUserId: text("max_user_id").unique(),
  telegramUserId: text("telegram_user_id").unique(),
  createdAt: createdAt(),
});

export const roleEnum = pgEnum("role", ["finance_admin", "admin", "member"]);
// active — участвует в сезоне; inactive — в клубе, но в этом сезоне не участвует; left — выбыл
export const membershipStatusEnum = pgEnum("membership_status", ["active", "inactive", "left"]);

export const feeCategories = pgTable("fee_categories", {
  id: id(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  name: text("name").notNull(), // «Стандартный», «Пенсионный»
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: roleEnum("role").notNull().default("member"),
    status: membershipStatusEnum("status").notNull().default("active"),
    feeCategoryId: uuid("fee_category_id").references(() => feeCategories.id),
    memberNo: integer("member_no"),
    // Номера билетов для охотничьих клубов; у других клубов пустые
    federalTicketNo: text("federal_ticket_no"),
    clubTicketNo: text("club_ticket_no"),
    joinedOn: date("joined_on"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_club_user").on(t.clubId, t.userId)],
);

// ---------------------------------------------------------------- сезон и бюджет

export const seasonStatusEnum = pgEnum("season_status", ["open", "closed"]);

export const seasons = pgTable(
  "seasons",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    title: text("title").notNull(), // «Сезон 2026»
    startsOn: date("starts_on").notNull(), // 2026-01-11
    endsOn: date("ends_on").notNull(), // 2027-01-10
    feeDueOn: date("fee_due_on"), // 2026-09-01
    openingBalance: money("opening_balance").notNull().default(0),
    status: seasonStatusEnum("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [index("seasons_club").on(t.clubId)],
);

export const seasonFeeRates = pgTable(
  "season_fee_rates",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    feeCategoryId: uuid("fee_category_id").notNull().references(() => feeCategories.id),
    amount: money("amount").notNull(),
  },
  (t) => [uniqueIndex("season_fee_rates_unique").on(t.seasonId, t.feeCategoryId)],
);

export const budgetDirectionEnum = pgEnum("budget_direction", ["income", "expense"]);

export const budgetItems = pgTable("budget_items", {
  id: id(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  direction: budgetDirectionEnum("direction").notNull(),
  name: text("name").notNull(), // «Лицензии», «Гостиница», «Взносы стандарт»
  plannedAmount: money("planned_amount").notNull().default(0),
  note: text("note"),
});

// ---------------------------------------------------------------- мероприятия

export const eventKindEnum = pgEnum("event_kind", ["trip", "count", "work", "meeting", "other"]);
export const eventStatusEnum = pgEnum("event_status", ["planned", "done", "cancelled"]);

export const events = pgTable(
  "events",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    kind: eventKindEnum("kind").notNull(),
    title: text("title").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    location: text("location"),
    // Лимит мест (например, в гостинице). Пусто — без лимита
    capacity: integer("capacity"),
    rsvpDeadline: timestamp("rsvp_deadline", { withTimezone: true }),
    // Обязательное мероприятие: пропустившим активным членам начисляется штраф
    mandatory: boolean("mandatory").notNull().default(false),
    missPenalty: money("miss_penalty"),
    status: eventStatusEnum("status").notNull().default("planned"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("events_club_season").on(t.clubId, t.seasonId)],
);

export const rsvpEnum = pgEnum("rsvp", ["going", "not_going", "maybe"]);

export const eventParticipants = pgTable(
  "event_participants",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    eventId: uuid("event_id").notNull().references(() => events.id),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id),
    response: rsvpEnum("response").notNull(),
    // Время последнего отклика «еду»: по нему идёт очередь на места
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
    guests: integer("guests").notNull().default(0),
    // Админ взял сверх лимита («с раскладушкой»)
    overCapacity: boolean("over_capacity").notNull().default(false),
    // Факт присутствия, отмечается после мероприятия
    attended: boolean("attended"),
  },
  (t) => [uniqueIndex("event_participants_unique").on(t.eventId, t.membershipId)],
);

export const workItems = pgTable("work_items", {
  id: id(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  description: text("description").notNull(), // «Изготовление солонцов»
  quantity: numeric("quantity"),
  unit: text("unit"), // «шт.», «км»
});

// ---------------------------------------------------------------- деньги

// membership_fee — годовой взнос; penalty — штраф; event_fee — допвзнос за мероприятие;
// carryover — перенос с прошлого сезона (плюс — долг, минус — депозит)
export const chargeKindEnum = pgEnum("charge_kind", [
  "membership_fee",
  "penalty",
  "event_fee",
  "carryover",
  "other",
]);

export const charges = pgTable(
  "charges",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id),
    kind: chargeKindEnum("kind").notNull(),
    amount: money("amount").notNull(),
    eventId: uuid("event_id").references(() => events.id),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    // Начисления не удаляются, а отменяются с причиной
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
  },
  (t) => [index("charges_club_season_member").on(t.clubId, t.seasonId, t.membershipId)],
);

export const paymentMethodEnum = pgEnum("payment_method", ["cash", "transfer", "online", "other"]);
// draft — заявлено («я оплатил»), ждёт проверки начфином; confirmed — деньги получены
export const paymentStatusEnum = pgEnum("payment_status", ["draft", "confirmed", "rejected"]);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id),
    amount: money("amount").notNull(),
    paidOn: date("paid_on").notNull(),
    method: paymentMethodEnum("method").notNull().default("transfer"),
    status: paymentStatusEnum("status").notNull().default("draft"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [index("payments_club_season_member").on(t.clubId, t.seasonId, t.membershipId)],
);

export const expenseStatusEnum = pgEnum("expense_status", ["draft", "confirmed", "rejected"]);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    clubId: uuid("club_id").notNull().references(() => clubs.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),
    budgetItemId: uuid("budget_item_id").references(() => budgetItems.id),
    eventId: uuid("event_id").references(() => events.id),
    amount: money("amount").notNull(),
    spentOn: date("spent_on").notNull(),
    payee: text("payee"),
    description: text("description").notNull(),
    receiptUrl: text("receipt_url"),
    // Расход, внесённый председателем, подтверждает начфин
    status: expenseStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [index("expenses_club_season").on(t.clubId, t.seasonId)],
);

// ---------------------------------------------------------------- журнал

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    clubId: uuid("club_id").references(() => clubs.id),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(), // payment.confirm, charge.cancel…
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_club_created").on(t.clubId, t.createdAt)],
);

// ---------------------------------------------------------------- вход

// Одноразовая ссылка для входа: её выдаёт админ или присылает бот. В базе только хэш
export const loginTokens = pgTable("login_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
