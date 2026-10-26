#!/usr/bin/env bash
# Первая установка TeamUp на сервер Ubuntu. Запускать от root:
#
#   curl -fsSL https://raw.githubusercontent.com/koulikovav/teamup/main/deploy/setup.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/koulikovav/teamup/main/deploy/setup.sh | bash -s -- teamup.ru
#
# Без аргумента сайт получает бесплатный адрес teamup.<адрес-сервера>.sslip.io, свой домен можно подключить потом.
# Уже работающие на сервере программы (например, VPN Amnezia) скрипт не трогает: если порт 443 занят,
# сайт встаёт на 8443. Запускать можно повторно: уже сделанное скрипт пропускает.
set -euo pipefail

DIR=/srv/teamup
busy() { ss -Hltn "sport = :$1" | grep -q .; }

echo "== Программы"
command -v git >/dev/null || { apt-get update -q && apt-get install -yq git; }
command -v ss >/dev/null || { apt-get update -q && apt-get install -yq iproute2; }
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
# Docker мог поставить кто-то другой (например, Amnezia) без docker compose — добавляем только его
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -q && { apt-get install -yq docker-compose-v2 || apt-get install -yq docker-compose-plugin; }
fi

echo "== Адрес и порты"
if [[ -f $DIR/.env ]]; then
  echo "Уже настроено, см. $DIR/.env"
else
  IP=$(curl -4fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN="${1:-teamup.$IP.sslip.io}"
  HTTPS_PORT=443
  if busy 443; then
    for p in 8443 88; do busy $p || { HTTPS_PORT=$p; break; }; done
    [[ $HTTPS_PORT == 443 ]] && { echo "Порты 443, 8443 и 88 заняты, освободите один из них"; exit 1; }
    echo "Порт 443 занят другой программой, сайт будет на порту $HTTPS_PORT"
  fi
  if busy 80; then
    echo "Порт 80 занят: без него не получить сертификат HTTPS. Освободите порт 80 и запустите скрипт ещё раз"
    exit 1
  fi
  SITE="https://$DOMAIN"
  [[ $HTTPS_PORT == 443 ]] || SITE="$SITE:$HTTPS_PORT"
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
APP_URL=$SITE
HTTPS_PORT=$HTTPS_PORT
POSTGRES_PASSWORD=$(secret)

# Боты: впишите токены и имена, потом выполните deploy/update.sh и npm run bot:webhook (см. docs/deploy.md)
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_NAME=
TELEGRAM_WEBHOOK_SECRET=$(secret)
MAX_BOT_TOKEN=
MAX_BOT_NAME=
MAX_WEBHOOK_SECRET=$(secret)
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
set -a; source .env; set +a
echo "Готово. Через минуту сайт откроется по адресу $APP_URL"
echo "Проверка: curl $APP_URL/api/health"
