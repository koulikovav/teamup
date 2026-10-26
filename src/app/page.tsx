import { eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { clubs, memberships } from "@/db/schema";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const { login } = await searchParams;
  const user = await currentUser();

  if (!user) {
    return (
      <main>
        <h1>TeamUp</h1>
        <p>Взносы, бюджет и мероприятия клуба по интересам.</p>
        {login === "expired" && <p className="debt">Ссылка для входа устарела или уже использована. Попросите новую.</p>}
        <p className="muted">Чтобы войти, откройте ссылку, которую прислал админ клуба или бот в Max.</p>
      </main>
    );
  }

  const mine = await db()
    .select({ name: clubs.name, slug: clubs.slug })
    .from(memberships)
    .innerJoin(clubs, eq(memberships.clubId, clubs.id))
    .where(eq(memberships.userId, user.id));

  return (
    <main>
      <h1>Здравствуйте, {user.fullName}</h1>
      <h2>Ваши клубы</h2>
      <ul>
        {mine.map((c) => (
          <li key={c.slug}>
            <Link href={`/c/${c.slug}`}>{c.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
