// Кто что может в клубе. Описание ролей — в docs/plan.md, раздел «Роли и права»

export type Role = "finance_admin" | "admin" | "member";

const rules = {
  // Подтверждать и отклонять оплаты и расходы, начислять взносы и штрафы, отменять начисления
  manageMoney: ["finance_admin"],
  // Вносить расходы (у председателя — черновиком на подтверждение начфину)
  addExpense: ["finance_admin", "admin"],
  // Состав, роли, ссылки для входа
  manageMembers: ["finance_admin", "admin"],
  // Мероприятия, отметка присутствия, места сверх лимита
  manageEvents: ["finance_admin", "admin"],
} satisfies Record<string, Role[]>;

export type Permission = keyof typeof rules;

export function can(role: Role, permission: Permission) {
  return (rules[permission] as Role[]).includes(role);
}
