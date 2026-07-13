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
docker compose --profile tools run --rm migrate
# Append-only audit_log grants
# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source <(grep -E '^(MYSQL_ROOT_PASSWORD|MYSQL_USER)=' .env | sed 's/\r$//')
set +a
docker compose exec -T mercata_control_db mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
REVOKE ALL PRIVILEGES ON mercata_control.audit_log FROM '${MYSQL_USER:-mercata_admin}'@'%';
GRANT SELECT, INSERT ON mercata_control.audit_log TO '${MYSQL_USER:-mercata_admin}'@'%';
FLUSH PRIVILEGES;
SQL

docker compose up -d mercata_admin
docker compose ps
echo "Deploy complete — https://admin.mercata.co.za (after DNS + Caddy)"
