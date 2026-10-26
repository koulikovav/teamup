// Бот без вебхука: сам забирает сообщения из Max. Удобно на своём компьютере
// и на сервере без домена.
//
//   npm run bot:poll

import { handleUpdate } from "../src/bot/handler";
import { bot } from "../src/bot/notify";

async function main() {
  const api = bot();
  if (!api) throw new Error("Не задан MAX_BOT_TOKEN, см. .env.example");
  const me = await api.me();
  console.log(`Бот @${me.username ?? me.first_name} слушает сообщения. Остановить: Ctrl+C`);
  let marker: number | undefined;
  for (;;) {
    try {
      const res = await api.updates(marker);
      marker = res.marker ?? marker;
      for (const u of res.updates) {
        await handleUpdate(api, u).catch((e) => console.error("Ошибка обработки:", u.update_type, e));
      }
    } catch (e) {
      console.error("Нет связи с Max, повтор через 5 секунд:", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
