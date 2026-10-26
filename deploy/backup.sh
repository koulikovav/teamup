#!/usr/bin/env bash
# Ночная копия базы. Ставится в расписание (cron) на сервере, см. docs/deploy.md.
# Копии лежат в backups/ 30 дней. Если в .env заданы S3_*, копия уходит ещё и в облачное хранилище,
# чтобы данные пережили даже потерю сервера.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

mkdir -p backups
file="backups/teamup-$(date +%F-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U teamup --clean --if-exists teamup | gzip > "$file"
find backups -name 'teamup-*.sql.gz' -mtime +30 -delete

if [[ -n "${S3_BUCKET:-}" ]]; then
  docker run --rm -v "$PWD/backups:/backups:ro" \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" -e AWS_DEFAULT_REGION="${S3_REGION:-ru-1}" \
    amazon/aws-cli:2.31.0 s3 cp "/backups/$(basename "$file")" "s3://$S3_BUCKET/" --endpoint-url "$S3_ENDPOINT"
fi
echo "Копия: $file"
