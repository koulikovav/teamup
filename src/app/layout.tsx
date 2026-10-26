import type { ReactNode } from "react";

export const metadata = {
  title: "TeamUp",
  description: "Взносы, бюджет и мероприятия клуба по интересам",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 16 }}>{children}</body>
    </html>
  );
}
