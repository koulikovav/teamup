// Штрафы за пропуск обязательного мероприятия (подсчёт, отработка).
// Начисляются активным членам, которых нет среди присутствовавших.

export function penaltiesForEvent(args: {
  eventId: string;
  activeMembershipIds: string[];
  attendedMembershipIds: string[];
  amount: number;
}) {
  const attended = new Set(args.attendedMembershipIds);
  return args.activeMembershipIds
    .filter((id) => !attended.has(id))
    .map((membershipId) => ({
      membershipId,
      kind: "penalty" as const,
      amount: args.amount,
      eventId: args.eventId,
    }));
}
