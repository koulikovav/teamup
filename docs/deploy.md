# Запуск на сервере

Сайт, база и HTTPS работают в Docker на одном сервере с Ubuntu. Хватает 1 процессора и 1 ГБ памяти:
сайт собирает GitHub (`.github/workflows/image.yml`), а сервер только скачивает готовый образ.

| Что | Где |
| --- | --- |
| сайт | контейнер `app`, образ `ghcr.io/koulikovav/teamup` |
| база | контейнер `db` (PostgreSQL 16), данные в томе `db-data` |
| HTTPS | контейнер `caddy`, сертификат получает и продлевает сам |
| настройки и секреты | `/srv/teamup/.env`, только на сервере |
| копии базы | `/srv/teamup/backups`, 30 дней |

## Первая установка

1. Нужен адрес сайта. Бесплатный вариант без покупки домена: `ok178.<адрес-сервера>.sslip.io`, например
   `ok178.203.0.113.7.sslip.io`. Свой домен тоже подойдёт: в его настройках DNS сделайте запись A на адрес сервера.
2. Откройте консоль сервера (в панели хостинга или по SSH) и выполните от root одну команду, подставив адрес:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/koulikovav/teamup/main/deploy/setup.sh | bash -s -- ok178.203.0.113.7.sslip.io
   ```

   Скрипт ставит Docker, включает подкачку, скачивает код в `/srv/teamup`, создаёт `.env` со случайными паролями,
   запускает сайт и ставит расписание: копия базы в 3:30, проверка обновлений каждые 10 минут,
   напоминания должникам по понедельникам в 10:00 (до срока оплаты взносов они не отправляются).
3. Проверьте: `curl https://<адрес>/api/health` отвечает `{"ok":true}`.

### Если порты 80 или 443 заняты

Их может занимать VPN. Посмотреть: `ss -ltnp | grep -E ':(80|443) '`. Тогда в `.env` задайте свободные порты,
например `HTTPS_PORT=8443`, добавьте порт в адрес (`APP_URL=https://<адрес>:8443`) и выполните `deploy/update.sh`.
Телеграм принимает вебхуки только на портах 443, 80, 88 и 8443.

## Данные клуба и первый вход

```bash
cd /srv/teamup
# файл клуба (формат — src/seed/format.ts) положите рядом, например ok178.json
docker compose -f docker-compose.prod.yml run --rm -v "$PWD/ok178.json:/app/ok178.json:ro" app npx tsx scripts/load-seed.ts ok178.json
rm ok178.json
docker compose -f docker-compose.prod.yml exec app npx tsx scripts/login-link.ts ok178 "Куликов Алексей"
```

Последняя команда печатает ссылку для входа. Дальше ссылки членам выдаются на странице «Состав».

## Боты

1. Впишите в `/srv/teamup/.env` токены и имена ботов (как их получить — `docs/bots.md`).
   Секреты вебхуков `setup.sh` уже заполнил.
2. Примените и подключите вебхуки:

   ```bash
   cd /srv/teamup && deploy/update.sh
   docker compose -f docker-compose.prod.yml exec app npx tsx scripts/bot-webhook.ts
   ```

## Обновление

Ничего делать не нужно: после принятия PR GitHub собирает новый образ, а сервер в течение 10 минут его скачивает,
обновляет таблицы базы и перезапускает сайт. Вручную: `/srv/teamup/deploy/update.sh`.
Журналы: `/var/log/teamup-*.log`, сайт — `docker compose -f docker-compose.prod.yml logs app`.

## Копии базы

- Каждую ночь `deploy/backup.sh` кладёт копию в `/srv/teamup/backups`.
- Чтобы копии хранились ещё и вне сервера, впишите в `.env` облачное хранилище S3:
  `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (и при необходимости `S3_REGION`).
- Восстановить: `deploy/restore.sh backups/teamup-<дата>.sql.gz`. Данные сайта заменяются данными из копии.

## Переезд на другой сервер

1. На старом: `deploy/backup.sh`, скопируйте свежий файл из `backups/` и `.env`.
2. На новом: `deploy/setup.sh <адрес>`, замените `.env` старым (поправьте `DOMAIN` и `APP_URL`, если адрес меняется),
   `deploy/update.sh`, затем `deploy/restore.sh <файл копии>`.
3. Если адрес изменился, заново выполните `scripts/bot-webhook.ts` (раздел «Боты»).
