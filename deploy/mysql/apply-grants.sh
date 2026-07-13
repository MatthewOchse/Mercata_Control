#!/usr/bin/env bash
# Make audit_log append-only for the app user (SELECT + INSERT only).
# MySQL DB-level ALL cannot be partially revoked per table — re-grant per table.
set -euo pipefail

ROOT_PW="${MYSQL_ROOT_PASSWORD:?}"
APP_USER="${MYSQL_USER:-mercata_admin}"
DB="${MYSQL_DATABASE:-mercata_control}"

mysql_root() {
  mysql -uroot -p"$ROOT_PW" "$@"
}

mysql_root -e "REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${APP_USER}'@'%';" || true

# Global: none. Database usage + per-table DML.
mysql_root -e "GRANT USAGE ON *.* TO '${APP_USER}'@'%';"

TABLES="$(mysql_root -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='${DB}' AND table_type='BASE TABLE' ORDER BY table_name;")"

for t in $TABLES; do
  if [[ "$t" == "audit_log" ]]; then
    mysql_root -e "GRANT SELECT, INSERT ON \`${DB}\`.\`${t}\` TO '${APP_USER}'@'%';"
    echo "  audit_log → SELECT, INSERT"
  else
    mysql_root -e "GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB}\`.\`${t}\` TO '${APP_USER}'@'%';"
  fi
done

mysql_root -e "FLUSH PRIVILEGES; SHOW GRANTS FOR '${APP_USER}'@'%';"
echo "OK — audit_log append-only for ${APP_USER}"
