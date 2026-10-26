#!/usr/bin/env bash
# Первая установка TeamUp на чистый сервер Ubuntu. Запускать от root:
#
#   curl -fsSL https://raw.githubusercontent.com/koulikovav/teamup/main/deploy/setup.sh | bash -s -- ok178.1.2.3.4.sslip.io
#
# Аргумент — адрес сайта. Скрипт можно запускать повторно: уже сделанное он пропускает.
set -euo pipefail

DOMAIN="${1:?укажите адрес сайта, например ok178.1.2.3.4.sslip.io}"
DIR=/srv/teamup

echo "== Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "== Подкачка: при 1 ГБ памяти база и сайт без неё могут не поместиться"
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Код"
if [[ ! -d $DIR/.git ]]; then
  git clone https://github.com/koulikovav/teamup.git "$DIR"
fi
cd "$DIR"

echo "== Настройки (.env)"
if [[ ! -f .env ]]; then
  secret() { openssl rand -hex 24; }
  cat > .env <<ENV
DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
POSTGRES_PASSWORD=$(secret)

# Боты: впишите токены и имена, потом выполните deploy/update.sh и npm run bot:webhook (см. docs/deploy.md)
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_NAME=
TELEGRAM_WEBHOOK_SECRET=$(secret)
MAX_BOT_TOKEN=
MAX_BOT_NAME=
MAX_WEBHOOK_SECRET=$(secret)

# Если порты 80 или 443 заняты другой программой (например, VPN)
# HTTP_PORT=80
# HTTPS_PORT=8443
ENV
  chmod 600 .env
fi

echo "== Запуск"
docker compose -f docker-compose.prod.yml pull db caddy app || docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d

echo "== Расписание: копия базы каждую ночь, обновление каждые 10 минут, напоминания о долгах по понедельникам"
cat > /etc/cron.d/teamup <<CRON
SHELL=/bin/bash
30 3 * * * root $DIR/deploy/backup.sh >> /var/log/teamup-backup.log 2>&1
*/10 * * * * root $DIR/deploy/update.sh >> /var/log/teamup-update.log 2>&1
0 10 * * 1 root cd $DIR && docker compose -f docker-compose.prod.yml exec -T app npx tsx scripts/remind-debts.ts ok178 >> /var/log/teamup-remind.log 2>&1
CRON

echo
echo "Готово. Через минуту сайт откроется по адресу https://$DOMAIN"
echo "Проверка: curl https://$DOMAIN/api/health"
