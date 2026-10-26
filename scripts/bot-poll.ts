// Боты без вебхука: сами забирают сообщения из Max и Телеграма. Удобно на своём
// компьютере и на сервере без домена. Работают те, для кого задан токен в .env.
//
//   npm run bot:poll

import { handleIncoming } from "../src/bot/handler";
import { fromMax, maxApi, maxMessenger } from "../src/bot/max-api";
import { fromTelegram, telegramApi, telegramMessenger } from "../src/bot/telegram-api";

const pause = () => new Promise((r) => setTimeout(r, 5000));

async function pollMax(token: string) {
  const api = maxApi(token);
  const bot = maxMessenger(api);
  const me = await api.me();
  console.log(`Max: бот @${me.username ?? me.first_name} слушает сообщения`);
  let marker: number | undefined;
  for (;;) {
    try {
      const res = await api.updates(marker);
      marker = res.marker ?? marker;
      for (const u of res.updates) {
        await handleIncoming(bot, fromMax(u)).catch((e) => console.error("Max: ошибка обработки", u.update_type, e));
      }
    } catch (e) {
      console.error("Нет связи с Max, повтор через 5 секунд:", e instanceof Error ? e.message : e);
      await pause();
    }
  }
}

async function pollTelegram(token: string) {
  const api = telegramApi(token);
  const bot = telegramMessenger(api);
  // Пока подключён вебхук, Телеграм не отдаёт сообщения опросом
  await api.deleteWebhook();
  const me = await api.me();
  console.log(`Телеграм: бот @${me.username} слушает сообщения`);
  let offset: number | undefined;
  for (;;) {
    try {
      for (const u of await api.updates(offset)) {
        offset = u.update_id + 1;
        await handleIncoming(bot, fromTelegram(u)).catch((e) => console.error("Телеграм: ошибка обработки", u.update_id, e));
      }
    } catch (e) {
      console.error("Нет связи с Телеграмом, повтор через 5 секунд:", e instanceof Error ? e.message : e);
      await pause();
    }
  }
}

async function main() {
  const loops = [];
  if (process.env.MAX_BOT_TOKEN) loops.push(pollMax(process.env.MAX_BOT_TOKEN));
  if (process.env.TELEGRAM_BOT_TOKEN) loops.push(pollTelegram(process.env.TELEGRAM_BOT_TOKEN));
  if (!loops.length) throw new Error("Не задан ни MAX_BOT_TOKEN, ни TELEGRAM_BOT_TOKEN, см. .env.example");
  console.log("Остановить: Ctrl+C");
  await Promise.all(loops);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
