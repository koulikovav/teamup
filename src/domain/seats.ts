// Распределение мест на выезде: кто первый откликнулся «еду», тот едет.
// Остальные — в листе ожидания. Взятые админом сверх лимита едут всегда.

export type Rsvp = {
  membershipId: string;
  response: "going" | "not_going" | "maybe";
  respondedAt: Date;
  guests: number;
  overCapacity: boolean;
};

export type SeatAllocation = {
  confirmed: Rsvp[];
  waitlist: Rsvp[];
  seatsTaken: number; // включая гостей
  seatsLeft: number | null; // null — без лимита
};

export function allocateSeats(rsvps: Rsvp[], capacity: number | null): SeatAllocation {
  const going = rsvps
    .filter((r) => r.response === "going")
    .sort((a, b) => a.respondedAt.getTime() - b.respondedAt.getTime());

  const confirmed: Rsvp[] = [];
  const waitlist: Rsvp[] = [];
  let taken = 0;

  // Сверх лимита — сначала, они места из лимита не занимают
  for (const r of going.filter((r) => r.overCapacity)) confirmed.push(r);

  for (const r of going.filter((r) => !r.overCapacity)) {
    const need = 1 + r.guests;
    if (capacity === null || taken + need <= capacity) {
      confirmed.push(r);
      taken += need;
    } else {
      waitlist.push(r);
    }
  }

  const extra = confirmed.filter((r) => r.overCapacity).reduce((s, r) => s + 1 + r.guests, 0);
  return {
    confirmed,
    waitlist,
    seatsTaken: taken + extra,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - taken),
  };
}
