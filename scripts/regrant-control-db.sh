#!/usr/bin/env bash
# Re-grant per-table DML for the Control app user (after migrate REVOKE).
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT_PW=$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | head -1 | cut -d= -f2- | sed 's/\r$//;s/^["'\'']//;s/["'\'']$//')
APP_PW=$(grep -E '^MYSQL_PASSWORD=' .env | head -1 | cut -d= -f2- | sed 's/\r$//;s/^["'\'']//;s/["'\'']$//')
APP_USER=$(grep -E '^MYSQL_USER=' .env | head -1 | cut -d= -f2- | sed 's/\r$//;s/^["'\'']//;s/["'\'']$//' || true)
DB=$(grep -E '^MYSQL_DATABASE=' .env | head -1 | cut -d= -f2- | sed 's/\r$//;s/^["'\'']//;s/["'\'']$//' || true)
APP_USER="${APP_USER:-mercata_admin}"
DB="${DB:-mercata_control}"

mysql_root() {
  docker compose exec -T -e MYSQL_PWD="$ROOT_PW" mercata_control_db mysql -uroot "$@"
}

echo "Listing tables…"
TABLES=$(mysql_root -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='${DB}' AND table_type='BASE TABLE' ORDER BY table_name;" | tr -d '\r')
COUNT=$(printf '%s\n' "$TABLES" | grep -c . || true)
echo "Found ${COUNT} tables"

{
  echo "REVOKE ALL PRIVILEGES, GRANT OPTION FROM \`${APP_USER}\`@\`%\`;"
  echo "GRANT USAGE ON *.* TO \`${APP_USER}\`@\`%\`;"
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    if [[ "$t" == "audit_log" ]]; then
      echo "GRANT SELECT, INSERT ON \`${DB}\`.\`${t}\` TO \`${APP_USER}\`@\`%\`;"
    else
      echo "GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB}\`.\`${t}\` TO \`${APP_USER}\`@\`%\`;"
    fi
  done <<< "$TABLES"
  echo "FLUSH PRIVILEGES;"
} | mysql_root

GRANT_COUNT=$(mysql_root -N -e "SHOW GRANTS FOR \`${APP_USER}\`@\`%\`;" | tr -d '\r' | grep -c . || true)
echo "Grant lines: ${GRANT_COUNT}"

docker compose exec -T -e MYSQL_PWD="$APP_PW" mercata_control_db \
  mysql -u"$APP_USER" -N "$DB" -e "SELECT COUNT(*) AS login_attempts FROM login_attempts; SELECT COUNT(*) AS sessions FROM sessions; SELECT COUNT(*) AS tenants FROM tenants;"

if [[ "$GRANT_COUNT" -lt 2 ]]; then
  echo "ERROR: grants look incomplete" >&2
  exit 1
fi
echo "GRANTS_OK"
