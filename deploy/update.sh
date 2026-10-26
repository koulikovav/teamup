#!/usr/bin/env bash
# Обновление сайта до последней версии из GitHub. Запускается по расписанию каждые 10 минут
# (см. deploy/setup.sh) и вручную. Если нового ничего нет, ничего не перезапускается.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull -q --ff-only
docker compose -f docker-compose.prod.yml pull -q app
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f >/dev/null
