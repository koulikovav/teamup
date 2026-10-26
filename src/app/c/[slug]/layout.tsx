import Link from "next/link";
import type { ReactNode } from "react";
import { clubContext } from "@/server/club";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClubLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await clubContext(slug);
  const base = `/c/${slug}`;
  return (
    <>
      <nav className="club">
        <strong>{ctx.club.name}</strong>
        <Link href={base}>Главная</Link>
        <Link href={`${base}/events`}>Мероприятия</Link>
        <Link href={`${base}/money`}>Взносы</Link>
        <Link href={`${base}/expenses`}>Расходы</Link>
        <Link href={`${base}/report`}>Отчёт</Link>
        <Link href={`${base}/members`}>Состав</Link>
        {ctx.can("manageMoney") && <Link href={`${base}/settings`}>Настройки</Link>}
        <form action={logout} className="inline">
          <button className="secondary">Выйти</button>
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
