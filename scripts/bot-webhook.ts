// Подключает вебхуки: Max и Телеграм будут присылать сообщения ботам на сайт,
// по адресам APP_URL/api/max и APP_URL/api/telegram. Нужен домен с HTTPS.
//
//   npm run bot:webhook

import { maxApi } from "../src/bot/max-api";
import { telegramApi } from "../src/bot/telegram-api";

async function main() {
  const app = process.env.APP_URL;
  if (!app?.startsWith("https://")) throw new Error("APP_URL должен начинаться с https://, см. .env.example");
  const { MAX_BOT_TOKEN, MAX_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
  let done = 0;
  if (MAX_BOT_TOKEN) {
    if (!MAX_WEBHOOK_SECRET) throw new Error("Задайте MAX_WEBHOOK_SECRET");
    await maxApi(MAX_BOT_TOKEN).subscribe(`${app}/api/max`, MAX_WEBHOOK_SECRET);
    console.log(`Max: вебхук ${app}/api/max`);
    done++;
  }
  if (TELEGRAM_BOT_TOKEN) {
    if (!TELEGRAM_WEBHOOK_SECRET || !/^[A-Za-z0-9_-]{1,256}$/.test(TELEGRAM_WEBHOOK_SECRET)) {
      throw new Error("Задайте TELEGRAM_WEBHOOK_SECRET: латинские буквы, цифры, _ и -");
    }
    await telegramApi(TELEGRAM_BOT_TOKEN).setWebhook(`${app}/api/telegram`, TELEGRAM_WEBHOOK_SECRET);
    console.log(`Телеграм: вебхук ${app}/api/telegram`);
    done++;
  }
  if (!done) throw new Error("Не задан ни MAX_BOT_TOKEN, ни TELEGRAM_BOT_TOKEN");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
