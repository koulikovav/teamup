#!/usr/bin/env bash
# Восстановление базы из копии. Текущие данные заменяются данными из копии!
#   deploy/restore.sh backups/teamup-2026-11-01-0300.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?укажите файл копии}"
read -r -p "Заменить данные сайта копией $file? Введите да: " answer
[[ "$answer" == "да" ]] || exit 1
gunzip -c "$file" | docker compose -f docker-compose.prod.yml exec -T db psql -q -U teamup teamup
echo "Готово"
