// Сюда Телеграм присылает сообщения боту (вебхук). Подключается командой npm run bot:webhook
import { handleIncoming } from "@/bot/handler";
import { sameSecret } from "@/bot/secret";
import { fromTelegram, TELEGRAM_SECRET_HEADER, telegramApi, telegramMessenger, type TgUpdate } from "@/bot/telegram-api";

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !sameSecret(req.headers.get(TELEGRAM_SECRET_HEADER), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json()) as TgUpdate;
  try {
    await handleIncoming(telegramMessenger(telegramApi(token)), fromTelegram(update));
  } catch (e) {
    // Телеграм повторяет недоставленные события; ошибку пишем в журнал и отвечаем 200, чтобы не зациклиться
    console.error("Telegram update failed:", update.update_id, e);
  }
  return Response.json({ ok: true });
}
