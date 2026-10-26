import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let instance: PostgresJsDatabase<typeof schema> | undefined;

// Подключение создаётся при первом обращении, чтобы сборка сайта не требовала базы
export function db() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL не задан, см. .env.example");
    instance = drizzle(postgres(url), { schema });
  }
  return instance;
}
