// Подключает вебхук: Max будет присылать сообщения боту на сайт, адрес APP_URL/api/max.
// Нужен домен с HTTPS.
//
//   npm run bot:webhook

import { bot } from "../src/bot/notify";

async function main() {
  const api = bot();
  const secret = process.env.MAX_WEBHOOK_SECRET;
  const app = process.env.APP_URL;
  if (!api || !secret || !app?.startsWith("https://")) {
    throw new Error("Нужны MAX_BOT_TOKEN, MAX_WEBHOOK_SECRET и APP_URL с https://, см. .env.example");
  }
  await api.subscribe(`${app}/api/max`, secret);
  console.log(`Вебхук подключён: ${app}/api/max`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
