// Суммы в базе — в копейках, на экране — в рублях

export function rub(kop: number) {
  return (kop / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
}

// «3 000», «3000,50» → копейки; пустое или неверное — null
export function parseRub(input: FormDataEntryValue | null): number | null {
  if (typeof input !== "string") return null;
  const n = Number(input.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function day(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export const today = () => new Date().toISOString().slice(0, 10);
