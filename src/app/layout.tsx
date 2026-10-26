import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "TeamUp",
  description: "Взносы, бюджет и мероприятия клуба по интересам",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
