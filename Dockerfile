# Образ сайта TeamUp. В нём же можно запускать скрипты: миграции, загрузку клуба, бота
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
# Сборка standalone не копирует статические файлы сама
RUN cp -r .next/static .next/standalone/.next/

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
# При запуске сначала обновляем таблицы базы, потом стартуем сайт
CMD ["sh", "-c", "npx drizzle-kit migrate && node .next/standalone/server.js"]
