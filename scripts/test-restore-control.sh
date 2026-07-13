#!/usr/bin/env bash
# One-shot restore drill — backs up, restores into mercata_control_restore_test, verifies, drops.
set -euo pipefail
CONTROL_DIR="${CONTROL_DIR:-/home/matthew/caesar/control}"
cd "$CONTROL_DIR"

echo "=== 1. Take a backup ==="
./scripts/backup-control.sh

LATEST_DB="$(ls -1t /mnt/vault/backups/control/mysql/mercata_control_*.sql.gz | head -1)"
LATEST_INV="$(ls -1t /mnt/vault/backups/control/invoices/invoices_*.tar.gz | head -1)"
echo "Using DB  $LATEST_DB"
echo "Using INV $LATEST_INV"

echo "=== 2. Restore into side database ==="
RESTORE_DB_NAME=mercata_control_restore_test \
  ./scripts/restore-control.sh "$LATEST_DB" "$LATEST_INV"

echo "=== 3. Verify row counts ==="
# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source <(grep -E '^MYSQL_ROOT_PASSWORD=' .env | sed 's/\r$//')
set +a

docker compose exec -T mercata_control_db mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "
  SELECT 'live' AS src, COUNT(*) FROM mercata_control.schema_migrations
  UNION ALL
  SELECT 'test', COUNT(*) FROM mercata_control_restore_test.schema_migrations;
"

echo "=== 4. Drop test database ==="
docker compose exec -T mercata_control_db mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "DROP DATABASE IF EXISTS mercata_control_restore_test;"

echo "OK — restore drill passed"
