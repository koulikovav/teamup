// Сюда Max присылает сообщения боту (вебхук). Подключается командой npm run bot:webhook
import { timingSafeEqual } from "node:crypto";
import { handleUpdate } from "@/bot/handler";
import { SECRET_HEADER, type MaxUpdate } from "@/bot/max-api";
import { bot } from "@/bot/notify";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  const api = bot();
  const secret = process.env.MAX_WEBHOOK_SECRET;
  if (!api || !secret || !same(req.headers.get(SECRET_HEADER) ?? "", secret)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json()) as MaxUpdate;
  try {
    await handleUpdate(api, update);
  } catch (e) {
    // Max повторяет недоставленные события; ошибку пишем в журнал и отвечаем 200, чтобы не зациклиться
    console.error("Max update failed:", update.update_type, e);
  }
  return Response.json({ ok: true });
}
