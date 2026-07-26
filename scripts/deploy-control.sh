#!/usr/bin/env bash
# Deploy / refresh Mercata Control on caesar.
# Run from ~/caesar/control after rsync.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing — copy deploy/.env.production.example and fill secrets" >&2
  exit 1
fi

docker compose build
docker compose up -d mercata_control_db
echo "Waiting for MySQL…"
sleep 8

# Migrations need DDL. The app user is DML-only day-to-day, so grant
# CREATE/ALTER for the migrate step only, then re-lock below.
MYSQL_ROOT_PASSWORD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -1 | cut -d= -f2- | sed 's/\r$//;s/^["'\'']//;s/["'\'']$//')"
MYSQL_USER="$(grep -E '^MYSQL_USER=' .env | head -1 | cut -d= -f2- | sed 's/\r$//;s/^["'\'']//;s/["'\'']$//' || true)"
MYSQL_DATABASE="$(grep -E '^MYSQL_DATABASE=' .env | head -1 | cut -d= -f2- | sed 's/\r$//;s/^["'\'']//;s/["'\'']$//' || true)"
APP_USER="${MYSQL_USER:-mercata_admin}"
DB="${MYSQL_DATABASE:-mercata_control}"
docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mercata_control_db \
  mysql -uroot -e "GRANT ALL PRIVILEGES ON \`${DB}\`.* TO '${APP_USER}'@'%'; FLUSH PRIVILEGES;"
docker compose --profile tools run --rm migrate
# Re-lock app user to per-table DML (audit_log = SELECT+INSERT only).
# Do not `source .env` — JSON secrets (e.g. GOOGLE_SERVICE_ACCOUNT_JSON) break bash.
bash scripts/regrant-control-db.sh

docker compose up -d --force-recreate mercata_admin
docker compose ps
echo "Deploy complete — https://admin.mercata.co.za (after DNS + Caddy)"
