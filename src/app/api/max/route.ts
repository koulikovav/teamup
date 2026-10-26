// Сюда Max присылает сообщения боту (вебхук). Подключается командой npm run bot:webhook
import { handleIncoming } from "@/bot/handler";
import { fromMax, MAX_SECRET_HEADER, maxApi, maxMessenger, type MaxUpdate } from "@/bot/max-api";
import { sameSecret } from "@/bot/secret";

export async function POST(req: Request) {
  const token = process.env.MAX_BOT_TOKEN;
  if (!token || !sameSecret(req.headers.get(MAX_SECRET_HEADER), process.env.MAX_WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json()) as MaxUpdate;
  try {
    await handleIncoming(maxMessenger(maxApi(token)), fromMax(update));
  } catch (e) {
    // Max повторяет недоставленные события; ошибку пишем в журнал и отвечаем 200, чтобы не зациклиться
    console.error("Max update failed:", update.update_type, e);
  }
  return Response.json({ ok: true });
}
